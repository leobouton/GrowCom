/**
 * seed-demo-esn.ts — Données de démonstration Venatis.
 *
 * Simule un flux Odoo (source ODOO + odooId) SANS insertion brute : on passe par les
 * VRAIS repositories + le moteur de commission + le job de récurrence, exactement comme
 * le fait odooService.sync après avoir lu le CRM.
 *
 * Démo « PLANS DE COMMISSION » : 3 plans modèles par profil (Junior / Senior /
 * Responsable de secteur) construits sur les règles typées (Recrutement, Formation,
 * Portage), assignés à Floriant / Thibault / Matteo. Thibault et Matteo illustrent la
 * personnalisation PAR PERSONNE (portage 6% + 150€/consultant via overrides), ajustable
 * dans Équipes → fiche membre → Ajuster.
 *
 * Idempotent : upserts par odooId, règles/assignations find-or-create. Réexécutable.
 *
 * Lancer : npx tsx scripts/seed-demo-esn.ts
 */
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/config/prisma';
import { dealRepository } from '../src/repositories/deal.repository';
import { dealAssignmentRepository } from '../src/repositories/dealAssignment.repository';
import { missionRepository } from '../src/repositories/mission.repository';
import { ruleAssignmentRepository } from '../src/repositories/ruleAssignment.repository';
import { commissionRuleRepository } from '../src/repositories/commissionRule.repository';
import { commissionService } from '../src/services/commission.service';
import { generateRecurringMissionCommissions } from '../src/services/missionRecurrence.service';
import { AssigneeType, RuleScope, CommissionRuleType } from '../src/../../shared/types';
import type { CommissionRuleConfig } from '../src/../../shared/types';

const TENANT = 'cmo0g40z300018hp0rknkca32';
const CREATED_BY = 'cmo0g412d00038hp0c9seblu7'; // Léo (manager)

const U = {
  floriant: 'cmo1e9unw0009t9iifclxp07u',
  thibault: 'cmo19zhas00032ei1jp3hxep2',
  matteo: 'cmo7ljcer00073fcjuxdxmodp',
};

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function monthsFromNow(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
}

async function findOrCreateRule(name: string, type: CommissionRuleType, dealType: string | null, config: CommissionRuleConfig): Promise<string> {
  const existing = await prisma.commissionRule.findFirst({ where: { tenantId: TENANT, name } });
  if (existing) {
    // Resynchronise ENTIÈREMENT la règle sur l'état voulu par la démo :
    // barème (config), type, dealType, et désarchivage si besoin. Rend le seed
    // insensible aux modifications manuelles faites en testant l'UI.
    await prisma.commissionRule.update({
      where: { id: existing.id },
      data: {
        type,
        dealType,
        config: config as unknown as object,
        description: config.description,
        isArchived: false,
        isActive: true,
      },
    });
    console.log(`  règle resynchronisée: ${name} (dealType=${dealType ?? 'aucun'})`);
    return existing.id;
  }
  const rule = await commissionRuleRepository.create({
    tenantId: TENANT,
    name,
    description: config.description,
    type,
    config,
    createdBy: CREATED_BY,
    dealType,
    scope: RuleScope.GLOBAL,
    paymentDelayDays: null,
  });
  console.log(`  règle créée: ${name} (dealType=${dealType ?? 'aucun'})`);
  return rule.id;
}

async function ensureAssignment(userId: string, ruleId: string, overrides?: Record<string, unknown>): Promise<void> {
  const existing = await prisma.ruleAssignment.findFirst({
    where: { tenantId: TENANT, ruleId, userId, isActive: true },
  });
  if (existing) {
    // Aligne les overrides sur l'état voulu par la démo (réexécution)
    const wanted = overrides ?? null;
    if (JSON.stringify(existing.overrides ?? null) !== JSON.stringify(wanted)) {
      await prisma.ruleAssignment.update({
        where: { id: existing.id },
        data: { overrides: wanted === null ? Prisma.DbNull : (wanted as Prisma.InputJsonValue) },
      });
      console.log(`  overrides mis à jour (assignation ${ruleId.slice(-6)} de ${userId.slice(-6)})`);
    }
    return;
  }
  await ruleAssignmentRepository.assign({
    tenantId: TENANT,
    ruleId,
    assignedToType: AssigneeType.INDIVIDUAL,
    userId,
    overrides: overrides ?? null,
  });
}

/**
 * Retire une règle d'un membre (UNE COMMISSION PAR PRODUIT) : désactive
 * l'assignation et purge les commissions de mission PENDING/VALIDATED de ce
 * couple (jamais les PAID). Rend le seed auto-réparateur si une démo
 * précédente avait empilé deux règles portage sur la même mission.
 */
async function removeAssignment(userId: string, ruleId: string): Promise<void> {
  const removed = await prisma.ruleAssignment.updateMany({
    where: { tenantId: TENANT, ruleId, userId, isActive: true, assignedToType: 'INDIVIDUAL' },
    data: { isActive: false },
  });
  const purged = await prisma.commission.deleteMany({
    where: {
      tenantId: TENANT,
      userId,
      ruleId,
      missionId: { not: null },
      status: { in: ['PENDING', 'VALIDATED'] },
    },
  });
  if (removed.count > 0 || purged.count > 0) {
    console.log(`  règle ${ruleId.slice(-6)} retirée de ${userId.slice(-6)} (${purged.count} commission(s) de mission purgée(s))`);
  }
}

/**
 * Crée un PLAN MODÈLE ou RESYNCHRONISE ses composants et sa description sur
 * l'état voulu par la démo (réexécution du seed = source de vérité).
 */
async function findOrCreatePlan(
  name: string,
  description: string,
  components: Array<
    | { kind: 'COMMISSION_RULE'; ruleId: string; appliesToEventType: 'DEAL_WON' | 'MISSION_MONTH' }
    | { kind: 'OBJECTIVE'; objective: Record<string, unknown> }
  >,
): Promise<string> {
  const componentsCreate = components.map((c, i) =>
    c.kind === 'COMMISSION_RULE'
      ? { tenantId: TENANT, kind: 'COMMISSION_RULE' as const, ruleId: c.ruleId, appliesToEventType: c.appliesToEventType, sortOrder: i }
      : { tenantId: TENANT, kind: 'OBJECTIVE' as const, objectiveConfig: c.objective as Prisma.InputJsonValue, appliesToEventType: 'DEAL_WON' as const, sortOrder: i },
  );

  const existing = await prisma.variablePlan.findFirst({ where: { tenantId: TENANT, name } });
  if (existing) {
    await prisma.$transaction([
      prisma.planComponent.deleteMany({ where: { planId: existing.id, tenantId: TENANT } }),
      prisma.variablePlan.update({
        where: { id: existing.id },
        data: { description, components: { create: componentsCreate } },
      }),
    ]);
    console.log(`  plan resynchronisé: ${name} (${components.length} composants)`);
    return existing.id;
  }
  const plan = await prisma.variablePlan.create({
    data: {
      tenantId: TENANT,
      name,
      description,
      isTemplate: true,
      createdBy: CREATED_BY,
      components: { create: componentsCreate },
    },
  });
  console.log(`  plan créé: ${name} (${components.length} composants)`);
  return plan.id;
}

/** Trace « ce membre est sur ce plan » (idempotent). */
async function ensurePlanAssignment(planId: string, userId: string): Promise<void> {
  const existing = await prisma.planAssignment.findFirst({ where: { tenantId: TENANT, planId, userId } });
  if (existing) {
    if (!existing.isActive) await prisma.planAssignment.update({ where: { id: existing.id }, data: { isActive: true } });
    return;
  }
  await prisma.planAssignment.create({
    data: { tenantId: TENANT, planId, assignedToType: 'INDIVIDUAL', userId },
  });
}

/** Mot de passe commun des comptes de démo (haché comme le fait auth.service). */
const DEMO_PASSWORD = 'Demo2026!';

/** Crée (ou retrouve par email) un commercial de démo rattaché à une équipe. */
async function findOrCreateCommercial(params: {
  email: string; firstName: string; lastName: string; groupName: string; fixedSalary: number;
}): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    console.log(`  commercial existant: ${params.firstName} ${params.lastName}`);
    return existing.id;
  }
  const group = await prisma.group.findFirst({ where: { tenantId: TENANT, name: params.groupName } });
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: params.email,
      passwordHash,
      firstName: params.firstName,
      lastName: params.lastName,
      role: 'COMMERCIAL',
      tenantId: TENANT,
      groupId: group?.id ?? null,
      fixedSalary: params.fixedSalary,
      isActive: true,
      emailVerified: true,
    },
  });
  console.log(`  commercial créé: ${params.firstName} ${params.lastName} (${params.email}) → ${params.groupName}`);
  return user.id;
}

/** Ajoute un objectif au tableau de bord du membre s'il n'existe pas déjà (par libellé). */
async function ensureObjective(userId: string, objective: Record<string, unknown>): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { objectives: true } });
  const existing = Array.isArray(user?.objectives) ? (user.objectives as Array<Record<string, unknown>>) : [];
  if (existing.some((o) => o['label'] === objective['label'])) return;
  await prisma.user.update({
    where: { id: userId },
    data: { objectives: [...existing, { ...objective, id: randomUUID() }] as object[] },
  });
  console.log(`  objectif « ${String(objective['label'])} » ajouté à ${userId.slice(-6)}`);
}

async function seedDeal(params: {
  odooId: string; title: string; clientName: string; amount: number;
  marginAmount: number | null; userId: string; closedAt: Date; dealType: string;
}): Promise<string> {
  const deal = await dealRepository.upsert({
    tenantId: TENANT,
    odooId: params.odooId,
    title: params.title,
    clientName: params.clientName,
    amount: params.amount,
    status: 'WON',
    probability: 100,
    assignedToId: params.userId,
    closedAt: params.closedAt,
    marginAmount: params.marginAmount,
    marginSource: params.marginAmount != null ? 'ODOO' : null,
    dealType: params.dealType,
  });
  await dealAssignmentRepository.upsertForDeal(deal.id, TENANT, [{ userId: params.userId, share: 1.0 }]);
  await commissionService.recalculateForDeal(deal.id, TENANT);
  return deal.id;
}

async function main() {
  console.log('=== Seed démo ESN (simulation flux Odoo) ===\n');

  // ── 1. Règles de commission ──
  // Chaque règle est liée à un TYPE DE VENTE (dealType) : le moteur n'applique la règle
  // qu'aux deals du même type, exactement comme si le type venait du CRM (étiquette Odoo
  // ou dealtype HubSpot). Aucune confusion possible entre recrutement/formation/portage.
  console.log('Règles :');
  const rRecrut = await findOrCreateRule('Prime recrutement direct', CommissionRuleType.PERCENTAGE, 'Recrutement', {
    type: CommissionRuleType.PERCENTAGE,
    description: '15% de la marge du recrutement, à la signature',
    rate: 0.15,
    calculationBasis: 'MARGIN',
    appliesToEventType: 'DEAL_WON',
    examples: [{ saleAmount: 8000, commission: 1200, explanation: 'Marge 8 000€ × 15% = 1 200€' }],
  });
  const rFormation = await findOrCreateRule('Commission formation', CommissionRuleType.PERCENTAGE, 'Formation', {
    type: CommissionRuleType.PERCENTAGE,
    description: '8% du CA des ventes de formation',
    rate: 0.08,
    calculationBasis: 'REVENUE',
    appliesToEventType: 'DEAL_WON',
    examples: [{ saleAmount: 12000, commission: 960, explanation: 'CA 12 000€ × 8% = 960€' }],
  });
  const rPortageMarge = await findOrCreateRule('Portage ESN — marge mensuelle', CommissionRuleType.PERCENTAGE, 'Portage', {
    type: CommissionRuleType.PERCENTAGE,
    description: '5% de la marge mensuelle récurrente tant que la mission tourne',
    rate: 0.05,
    calculationBasis: 'MARGIN',
    appliesToEventType: 'MISSION_MONTH',
    examples: [{ saleAmount: 3000, commission: 150, explanation: 'Marge mensuelle 3 000€ × 5% = 150€' }],
  });
  const rPortageForfait = await findOrCreateRule('Portage ESN — forfait consultant', CommissionRuleType.FIXED, 'Portage', {
    type: CommissionRuleType.FIXED,
    description: '100€ par mois et par consultant placé',
    fixedAmount: 100,
    calculationBasis: 'PER_UNIT',
    appliesToEventType: 'MISSION_MONTH',
    examples: [{ saleAmount: 3, commission: 300, explanation: '3 consultants × 100€ = 300€' }],
  });

  // ── 2. PLANS DE COMMISSION (modèles par profil) ──
  // Un plan = un ensemble règles + objectifs assigné à un profil. Les ajustements
  // par personne (taux, forfaits…) sont portés par les overrides d'assignation
  // — modifiables depuis Équipes → fiche membre → Ajuster.
  console.log('\nPlans de commission (modèles) :');

  const now = new Date();
  const month = now.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const year = now.getFullYear();

  const objJunior = {
    label: 'Objectif CA mensuel — Junior', target: 40000, unit: '€',
    periodType: 'monthly', month, year,
    bonusMode: 'tiered',
    bonusTiers: [{ threshold: 100, reward: { type: 'fixed', value: 300 } }],
  };
  const objSenior = {
    label: 'Objectif CA mensuel — Senior', target: 60000, unit: '€',
    periodType: 'monthly', month, year,
    bonusMode: 'tiered',
    bonusTiers: [
      { threshold: 80, reward: { type: 'fixed', value: 250 } },
      { threshold: 100, reward: { type: 'fixed', value: 750 } },
    ],
  };
  const objResponsable = {
    label: 'Objectif CA trimestriel — Responsable', target: 200000, unit: '€',
    periodType: 'quarterly', quarter, year,
    bonusMode: 'tiered',
    bonusTiers: [{ threshold: 100, reward: { type: 'fixed', value: 1500 } }],
  };

  // UNE COMMISSION PAR PRODUIT : chaque plan porte UNE SEULE règle portage
  // (forfait pour les juniors, % marge pour les seniors/responsables). Une
  // mission ne déclenche donc jamais deux commissions sur la même vente.
  const planJunior = await findOrCreatePlan(
    'Plan Commercial Junior',
    'Recrutement 15% marge, formation 8% CA, portage 100€/consultant/mois, objectif 40k€/mois (prime 300€)',
    [
      { kind: 'COMMISSION_RULE', ruleId: rRecrut, appliesToEventType: 'DEAL_WON' },
      { kind: 'COMMISSION_RULE', ruleId: rFormation, appliesToEventType: 'DEAL_WON' },
      { kind: 'COMMISSION_RULE', ruleId: rPortageForfait, appliesToEventType: 'MISSION_MONTH' },
      { kind: 'OBJECTIVE', objective: objJunior },
    ],
  );
  const planSenior = await findOrCreatePlan(
    'Plan Commercial Senior',
    'Recrutement 15% marge, formation 8% CA, portage 6% de la marge mensuelle, objectif 60k€/mois (primes 250/750€)',
    [
      { kind: 'COMMISSION_RULE', ruleId: rRecrut, appliesToEventType: 'DEAL_WON' },
      { kind: 'COMMISSION_RULE', ruleId: rFormation, appliesToEventType: 'DEAL_WON' },
      { kind: 'COMMISSION_RULE', ruleId: rPortageMarge, appliesToEventType: 'MISSION_MONTH' },
      { kind: 'OBJECTIVE', objective: objSenior },
    ],
  );
  const planResponsable = await findOrCreatePlan(
    'Plan Responsable de secteur',
    'Recrutement 15% marge, portage 6% de la marge mensuelle, objectif 200k€/trimestre (prime 1 500€)',
    [
      { kind: 'COMMISSION_RULE', ruleId: rRecrut, appliesToEventType: 'DEAL_WON' },
      { kind: 'COMMISSION_RULE', ruleId: rPortageMarge, appliesToEventType: 'MISSION_MONTH' },
      { kind: 'OBJECTIVE', objective: objResponsable },
    ],
  );

  // ── 3. Assignations des plans par profil ──
  console.log('\nAssignations des plans :');

  // Floriant = Junior (portage au forfait consultant uniquement)
  await ensureAssignment(U.floriant, rRecrut);
  await ensureAssignment(U.floriant, rFormation);
  await ensureAssignment(U.floriant, rPortageForfait);
  await removeAssignment(U.floriant, rPortageMarge);
  await ensurePlanAssignment(planJunior, U.floriant);
  await ensureObjective(U.floriant, objJunior);

  // Thibault = Senior — PERSONNALISATION PAR PERSONNE : portage 6% de la marge
  await ensureAssignment(U.thibault, rRecrut);
  await ensureAssignment(U.thibault, rFormation);
  await ensureAssignment(U.thibault, rPortageMarge, { rate: 0.06 });
  await removeAssignment(U.thibault, rPortageForfait);
  await ensurePlanAssignment(planSenior, U.thibault);
  await ensureObjective(U.thibault, objSenior);

  // Matteo = Responsable de secteur — même ajustement senior (6% marge)
  await ensureAssignment(U.matteo, rRecrut);
  await ensureAssignment(U.matteo, rPortageMarge, { rate: 0.06 });
  await removeAssignment(U.matteo, rPortageForfait);
  await ensurePlanAssignment(planResponsable, U.matteo);
  await ensureObjective(U.matteo, objResponsable);

  console.log('  Floriant → Junior · Thibault → Senior (portage personnalisé) · Matteo → Responsable');

  // ── 3bis. Nouveaux commerciaux (2 par équipe) pour une démo réaliste ──
  // Mot de passe commun : Demo2026!
  console.log('\nNouveaux commerciaux (2 par équipe) :');
  const camille = await findOrCreateCommercial({
    email: 'camille.dupont@growcom-demo.fr', firstName: 'Camille', lastName: 'Dupont',
    groupName: 'BU EST', fixedSalary: 2300,
  });
  const lucas = await findOrCreateCommercial({
    email: 'lucas.martin@growcom-demo.fr', firstName: 'Lucas', lastName: 'Martin',
    groupName: 'BU EST', fixedSalary: 2800,
  });
  const emma = await findOrCreateCommercial({
    email: 'emma.leroy@growcom-demo.fr', firstName: 'Emma', lastName: 'Leroy',
    groupName: 'BU NORD', fixedSalary: 2300,
  });
  const hugo = await findOrCreateCommercial({
    email: 'hugo.bernard@growcom-demo.fr', firstName: 'Hugo', lastName: 'Bernard',
    groupName: 'BU NORD', fixedSalary: 2800,
  });

  // Plans par profil : Camille & Emma = Junior (forfait), Lucas & Hugo = Senior (6% marge)
  for (const junior of [camille, emma]) {
    await ensureAssignment(junior, rRecrut);
    await ensureAssignment(junior, rFormation);
    await ensureAssignment(junior, rPortageForfait);
    await removeAssignment(junior, rPortageMarge);
    await ensurePlanAssignment(planJunior, junior);
    await ensureObjective(junior, objJunior);
  }
  for (const senior of [lucas, hugo]) {
    await ensureAssignment(senior, rRecrut);
    await ensureAssignment(senior, rFormation);
    await ensureAssignment(senior, rPortageMarge, { rate: 0.06 });
    await removeAssignment(senior, rPortageForfait);
    await ensurePlanAssignment(planSenior, senior);
    await ensureObjective(senior, objSenior);
  }
  console.log('  Camille & Emma → Junior (forfait) · Lucas & Hugo → Senior (6% marge)');

  // Ventes des nouveaux commerciaux (types alignés sur les étiquettes CRM)
  console.log('\nVentes des nouveaux commerciaux :');
  await seedDeal({ odooId: 'demo-odoo-4001', title: '[DEMO] Recrutement Développeur Fullstack — CDI', clientName: 'WebFactory', amount: 7000, marginAmount: 7000, userId: camille, closedAt: daysAgo(6), dealType: 'Recrutement' });
  await seedDeal({ odooId: 'demo-odoo-4002', title: '[DEMO] Formation Python Data (3j)', clientName: 'DataSoft', amount: 9000, marginAmount: null, userId: camille, closedAt: daysAgo(12), dealType: 'Formation' });
  await seedDeal({ odooId: 'demo-odoo-4003', title: '[DEMO] Recrutement Architecte Cloud — CDI', clientName: 'CloudNine', amount: 12000, marginAmount: 12000, userId: lucas, closedAt: daysAgo(4), dealType: 'Recrutement' });
  await seedDeal({ odooId: 'demo-odoo-4004', title: '[DEMO] Formation Kubernetes (4j)', clientName: 'InfraPlus', amount: 8000, marginAmount: null, userId: emma, closedAt: daysAgo(3), dealType: 'Formation' });
  await seedDeal({ odooId: 'demo-odoo-4005', title: '[DEMO] Recrutement Testeur QA — CDI', clientName: 'QualityFirst', amount: 6000, marginAmount: 6000, userId: emma, closedAt: daysAgo(10), dealType: 'Recrutement' });
  await seedDeal({ odooId: 'demo-odoo-4006', title: '[DEMO] Recrutement DevOps Senior — CDI', clientName: 'ScaleUp', amount: 9500, marginAmount: 9500, userId: hugo, closedAt: daysAgo(7), dealType: 'Recrutement' });
  console.log('  6 ventes one-shot + commissions recalculées');

  // Portage des seniors : contrats d'ancrage + missions (1 ligne = 1 consultant)
  const dPortageLucas = await seedDeal({ odooId: 'demo-odoo-4007', title: '[DEMO] Portage — Consultant DevOps (contrat)', clientName: 'ScaleUp', amount: 0, marginAmount: 0, userId: lucas, closedAt: daysAgo(45), dealType: 'Portage' });
  const dPortageHugo = await seedDeal({ odooId: 'demo-odoo-4008', title: '[DEMO] Portage — Consultants Data (contrat)', clientName: 'DataSoft', amount: 0, marginAmount: 0, userId: hugo, closedAt: daysAgo(30), dealType: 'Portage' });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-5001', dealId: dPortageLucas, userId: lucas,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 6000, consultantCount: 1,
    startDate: monthsFromNow(-1), expectedEndDate: monthsFromNow(11), status: 'ACTIVE',
    source: 'ODOO', marginAmount: 2000, marginSource: 'ODOO',
  });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-5002-c1', dealId: dPortageHugo, userId: hugo,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 5500, consultantCount: 1,
    startDate: monthsFromNow(-1), expectedEndDate: null, status: 'ACTIVE',
    source: 'ODOO', marginAmount: 1800, marginSource: 'ODOO',
  });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-5002-c2', dealId: dPortageHugo, userId: hugo,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 5500, consultantCount: 1,
    startDate: monthsFromNow(-1), expectedEndDate: null, status: 'ACTIVE',
    source: 'ODOO', marginAmount: 1800, marginSource: 'ODOO',
  });
  console.log('  2 contrats de portage + 3 missions actives (Lucas 1, Hugo 2×1 consultant)');

  const NEW_USERS = { camille, lucas, emma, hugo };

  // ── 3. Deals one-shot (recrutement direct / formation) — deals WON Odoo ──
  console.log('\nDeals one-shot (WON) :');
  await seedDeal({ odooId: 'demo-odoo-2001', title: '[DEMO] Recrutement Ingénieur DevOps — CDI', clientName: 'TechCorp', amount: 8000, marginAmount: 8000, userId: U.floriant, closedAt: daysAgo(5), dealType: 'Recrutement' });
  await seedDeal({ odooId: 'demo-odoo-2005', title: '[DEMO] Recrutement Lead Developer — CDI', clientName: 'StartupX', amount: 10000, marginAmount: 10000, userId: U.matteo, closedAt: daysAgo(8), dealType: 'Recrutement' });
  await seedDeal({ odooId: 'demo-odoo-2002', title: '[DEMO] Formation React Avancé (5j)', clientName: 'DigitalPlus', amount: 12000, marginAmount: null, userId: U.thibault, closedAt: daysAgo(3), dealType: 'Formation' });
  console.log('  3 deals one-shot + commissions recalculées');

  // ── 4. Deals d'ancrage portage (contrat signé, valeur one-shot nulle) ──
  // dealType 'Portage' : aucune règle DEAL_WON ne cible ce type → aucune commission
  // parasite à 0 € n'est créée sur ces contrats (le récurrent vient des missions).
  console.log('\nDeals d\'ancrage portage (WON, ancre des missions) :');
  const dPortageFloriant = await seedDeal({ odooId: 'demo-odoo-2003', title: '[DEMO] Portage — Consultant Data Engineer (contrat)', clientName: 'BigRetail', amount: 0, marginAmount: 0, userId: U.floriant, closedAt: daysAgo(90), dealType: 'Portage' });
  const dPortageThibault = await seedDeal({ odooId: 'demo-odoo-2004', title: '[DEMO] Portage — Consultants Cloud (contrat)', clientName: 'AeroSys', amount: 0, marginAmount: 0, userId: U.thibault, closedAt: daysAgo(60), dealType: 'Portage' });
  const dPortageMatteo = await seedDeal({ odooId: 'demo-odoo-2006', title: '[DEMO] Portage — Consultants Cybersécurité (contrat)', clientName: 'DefenseCorp', amount: 0, marginAmount: 0, userId: U.matteo, closedAt: daysAgo(30), dealType: 'Portage' });
  console.log('  3 deals d\'ancrage');

  // ── 5. Missions récurrentes (sale.order abonnements Odoo) ──
  // UNE MISSION PAR CONSULTANT PLACÉ : le dashboard affiche une ligne par consultant,
  // même si plusieurs consultants sont chez le même client sur le même contrat.
  console.log('\nMissions récurrentes (abonnements Odoo, 1 ligne = 1 consultant) :');

  // Nettoyage des anciennes missions agrégées (2-3 consultants sur une seule ligne)
  const obsoleteOdooIds = ['demo-sub-3002', 'demo-sub-3003'];
  const obsolete = await prisma.mission.findMany({
    where: { tenantId: TENANT, odooId: { in: obsoleteOdooIds } },
    select: { id: true },
  });
  if (obsolete.length > 0) {
    const ids = obsolete.map((m) => m.id);
    await prisma.commission.deleteMany({ where: { missionId: { in: ids } } });
    await prisma.commissionableEvent.deleteMany({ where: { missionId: { in: ids } } });
    await prisma.mission.deleteMany({ where: { id: { in: ids } } });
    console.log(`  ${obsolete.length} ancienne(s) mission(s) agrégée(s) supprimée(s)`);
  }

  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3001', dealId: dPortageFloriant, userId: U.floriant,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 9000, consultantCount: 1,
    startDate: monthsFromNow(-3), expectedEndDate: monthsFromNow(9), status: 'ACTIVE',
    source: 'ODOO', marginAmount: 3000, marginSource: 'ODOO',
  });
  // Thibault : 2 consultants Cloud chez AeroSys → 2 missions distinctes
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3002-c1', dealId: dPortageThibault, userId: U.thibault,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 6000, consultantCount: 1,
    startDate: monthsFromNow(-2), expectedEndDate: null, status: 'ACTIVE',
    source: 'ODOO', marginAmount: 2000, marginSource: 'ODOO',
  });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3002-c2', dealId: dPortageThibault, userId: U.thibault,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 6000, consultantCount: 1,
    startDate: monthsFromNow(-2), expectedEndDate: null, status: 'ACTIVE',
    source: 'ODOO', marginAmount: 2000, marginSource: 'ODOO',
  });
  // Matteo : 3 consultants Cybersécurité chez DefenseCorp → 3 missions distinctes
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3003-c1', dealId: dPortageMatteo, userId: U.matteo,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 5000, consultantCount: 1,
    startDate: monthsFromNow(-1), expectedEndDate: monthsFromNow(11), status: 'ACTIVE',
    source: 'ODOO', marginAmount: 1700, marginSource: 'ODOO',
  });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3003-c2', dealId: dPortageMatteo, userId: U.matteo,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 5000, consultantCount: 1,
    startDate: monthsFromNow(-1), expectedEndDate: monthsFromNow(11), status: 'ACTIVE',
    source: 'ODOO', marginAmount: 1650, marginSource: 'ODOO',
  });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3003-c3', dealId: dPortageMatteo, userId: U.matteo,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 5000, consultantCount: 1,
    startDate: monthsFromNow(-1), expectedEndDate: monthsFromNow(11), status: 'ACTIVE',
    source: 'ODOO', marginAmount: 1650, marginSource: 'ODOO',
  });
  console.log('  6 missions actives (Floriant 1, Thibault 2×1 consultant, Matteo 3×1 consultant)');

  // ── 6. Job de récurrence réel : génère les commissions du mois ──
  console.log('\nJob de récurrence (génération commissions du mois en cours) :');
  await generateRecurringMissionCommissions(new Date());

  // ── 7. Résumé ──
  console.log('\n=== Résumé ===');
  const plans = await prisma.variablePlan.findMany({
    where: { tenantId: TENANT, isActive: true, isTemplate: true },
    include: {
      components: true,
      assignments: { where: { isActive: true }, include: { user: { select: { firstName: true } } } },
    },
  });
  for (const p of plans) {
    const assignees = p.assignments.map((a) => a.user?.firstName ?? '?').join(', ') || 'personne';
    console.log(`  PLAN « ${p.name} » : ${p.components.length} composants → ${assignees}`);
  }
  for (const [name, id] of Object.entries({ ...U, ...NEW_USERS })) {
    const deals = await prisma.deal.count({ where: { tenantId: TENANT, assignedToId: id, odooId: { startsWith: 'demo-odoo-' } } });
    const missions = await prisma.mission.count({ where: { tenantId: TENANT, userId: id, status: 'ACTIVE' } });
    const oneShot = await prisma.commission.aggregate({
      where: { tenantId: TENANT, userId: id, missionId: null, deal: { odooId: { startsWith: 'demo-odoo-' } } },
      _sum: { amount: true }, _count: true,
    });
    const recurring = await prisma.commission.aggregate({
      where: { tenantId: TENANT, userId: id, missionId: { not: null } },
      _sum: { amount: true }, _count: true,
    });
    console.log(`  ${name}: ${deals} deals démo, ${missions} missions actives | one-shot ${oneShot._sum.amount ?? 0}€ (${oneShot._count}) | récurrent/mois ${recurring._sum.amount ?? 0}€ (${recurring._count})`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Seed terminé.');
}

main().catch((e) => { console.error(e); process.exit(1); });
