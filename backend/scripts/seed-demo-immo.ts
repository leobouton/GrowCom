/**
 * seed-demo-immo.ts — Données de démonstration IMMOBILIER (réseau de mandataires).
 *
 * Monte un univers crédible pour un réseau de conseillers immobiliers :
 *   • 1 tenant neutre « Réseau Horizon Immobilier (démo) »
 *   • 1 directeur réseau (MANAGER) + 1 responsable d'agence (TEAM_LEAD) + 6 conseillers
 *   • 1 règle de commission à PALIERS (TIERED) : rétrocession progressive des honoraires
 *   • ~26 ventes de biens (appartement / maison) avec prix + honoraires réalistes
 *   • ≥ 1 vente en CO-MANDAT (split 50/50 entre 2 conseillers)
 *   • objectifs d'honoraires sur 2 conseillers → page Projections/simulation vivante
 *   • statuts variés (en attente / validées / versées) → dashboards actifs
 *
 * IMPORTANT — le moteur applique les paliers SUR LES HONORAIRES DE CHAQUE VENTE
 * (pas de cumul annuel : le moteur ne sait pas le faire, on ne le simule donc pas).
 * deal.amount = HONORAIRES HT (le « CA » du mandataire) ; le prix de vente du bien
 * est porté par le titre de la vente. La règle est une TIERED sur la base REVENUE.
 *
 * Idempotent : upserts par identifiants stables (slug, email, fileExternalId, nom).
 * Rejouable sans doublon. Reset propre : `--reset` efface le tenant démo puis reconstruit.
 *
 * Lancer :  npm run seed:demo         (idempotent)
 *           npm run seed:demo:reset   (efface la démo puis reconstruit)
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/config/prisma';
import { dealAssignmentRepository } from '../src/repositories/dealAssignment.repository';
import { ruleAssignmentRepository } from '../src/repositories/ruleAssignment.repository';
import { commissionRuleRepository } from '../src/repositories/commissionRule.repository';
import { commissionService } from '../src/services/commission.service';
import { AssigneeType, RuleScope, CommissionRuleType } from '../src/../../shared/types';
import type { CommissionRuleConfig, Objective } from '../src/../../shared/types';

// ─── Constantes de démo ──────────────────────────────────────────────────────

const TENANT_SLUG = 'reseau-horizon-immobilier-demo';
const TENANT_NAME = 'Réseau Horizon Immobilier (démo)';
const DEMO_PASSWORD = 'Demo2026!';
const DOMAIN = 'horizon-immo-demo.fr';

/** Clé d'idempotence des ventes de démo (préfixe fileExternalId). */
const DEAL_PREFIX = 'demo-immo-';

function email(local: string): string {
  return `${local}@${DOMAIN}`;
}

/**
 * Date de clôture d'une vente, ancrée à un mois précis (et non « il y a N jours »).
 *   m = nombre de mois en arrière (0 = mois courant) ; d = jour du mois.
 * Pour le mois courant, on ne dépasse jamais aujourd'hui (repli sur le jour courant),
 * ce qui garantit qu'une vente « du mois » reste dans le mois quelle que soit la
 * date à laquelle le seed est rejoué — condition clé pour que CA et commissions
 * tombent dans la MÊME période dans le classement manager.
 */
function dateOf(m: number, d: number): Date {
  const now = new Date();
  if (m === 0) {
    const day = Math.min(d, now.getDate());
    return new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth() - m, d, 12, 0, 0, 0);
}

// ─── Barème à paliers (choix validé : 70 / 80 / 87 %, seuils 8k / 15k) ─────────
// Les paliers s'appliquent sur les HONORAIRES d'une vente (base REVENUE).
const RETROCESSION_CONFIG: CommissionRuleConfig = {
  type: CommissionRuleType.TIERED,
  description:
    'Rétrocession progressive des honoraires : 70 % jusqu\'à 8 000 €, 80 % de 8 000 à 15 000 €, 87 % au-delà.',
  tiers: [
    { min: 0, max: 8000, rate: 0.7 },
    { min: 8000, max: 15000, rate: 0.8 },
    { min: 15000, max: null, rate: 0.87 },
  ],
  calculationBasis: 'REVENUE',
  appliesToEventType: 'DEAL_WON',
  examples: [
    {
      saleAmount: 20000,
      commission: 15550,
      explanation: '8 000 × 70% + 7 000 × 80% + 5 000 × 87% = 15 550 €',
    },
    {
      saleAmount: 6000,
      commission: 4200,
      explanation: '6 000 × 70% = 4 200 € (premier palier)',
    },
  ],
};

// ─── Comptes de démo ───────────────────────────────────────────────────────────

type UserKey =
  | 'directeur'
  | 'julien'
  | 'sophie'
  | 'thomas'
  | 'camille'
  | 'marie'
  | 'antoine'
  | 'lea';

interface DemoUser {
  key: UserKey;
  email: string;
  firstName: string;
  lastName: string;
  role: 'MANAGER' | 'TEAM_LEAD' | 'COMMERCIAL';
  jobTitle: string;
  groupName: string | null;
  fixedSalary: number;
}

const GROUP_LYON = 'Lyon';
const GROUP_AIX = 'Aix-en-Provence';

const DEMO_USERS: DemoUser[] = [
  { key: 'directeur', email: email('nicolas.mercier'), firstName: 'Nicolas', lastName: 'Mercier', role: 'MANAGER', jobTitle: 'Directeur réseau', groupName: null, fixedSalary: 0 },
  // Julien est RESPONSABLE de l'agence Lyon (leadId), pas un membre de la liste
  // des conseillers → groupName = null (comme un lead désigné via l'interface, qui
  // garde groupId = null). Il vend malgré tout (ses ventes lui sont rattachées par id).
  { key: 'julien', email: email('julien.faure'), firstName: 'Julien', lastName: 'Faure', role: 'TEAM_LEAD', jobTitle: "Responsable d'agence", groupName: null, fixedSalary: 0 },
  { key: 'sophie', email: email('sophie.lemaire'), firstName: 'Sophie', lastName: 'Lemaire', role: 'COMMERCIAL', jobTitle: 'Conseillère immobilière', groupName: GROUP_LYON, fixedSalary: 0 },
  { key: 'thomas', email: email('thomas.girard'), firstName: 'Thomas', lastName: 'Girard', role: 'COMMERCIAL', jobTitle: 'Conseiller immobilier', groupName: GROUP_LYON, fixedSalary: 0 },
  { key: 'camille', email: email('camille.rousseau'), firstName: 'Camille', lastName: 'Rousseau', role: 'COMMERCIAL', jobTitle: 'Conseillère immobilière', groupName: GROUP_LYON, fixedSalary: 0 },
  { key: 'marie', email: email('marie.fontaine'), firstName: 'Marie', lastName: 'Fontaine', role: 'COMMERCIAL', jobTitle: 'Conseillère immobilière', groupName: GROUP_AIX, fixedSalary: 0 },
  { key: 'antoine', email: email('antoine.blanchard'), firstName: 'Antoine', lastName: 'Blanchard', role: 'COMMERCIAL', jobTitle: 'Conseiller immobilier', groupName: GROUP_AIX, fixedSalary: 0 },
  { key: 'lea', email: email('lea.moreau'), firstName: 'Léa', lastName: 'Moreau', role: 'COMMERCIAL', jobTitle: 'Conseillère immobilière', groupName: GROUP_AIX, fixedSalary: 0 },
];

const DEMO_EMAILS = DEMO_USERS.map((u) => u.email);

// ─── Ventes de démo (deal.amount = HONORAIRES HT) ──────────────────────────────

type DealStatus = 'PENDING' | 'VALIDATED' | 'PAID';

interface DemoDeal {
  ext: string;                 // suffixe fileExternalId (préfixe ajouté)
  bien: string;                // type de bien + localisation, ex : 'Appartement T3 — Lyon 3e'
  client: string;              // acquéreur / vendeur
  prix: number;                // PRIX DE VENTE du bien (affiché dans l'intitulé)
  honoraires: number;          // deal.amount = HONORAIRES HT (~3 à 6 % du prix) = base de commission
  who: UserKey | [UserKey, UserKey]; // 1 conseiller, ou co-mandat (split 50/50)
  when: { m: number; d: number };    // clôture : m mois en arrière (0 = mois courant), jour d
  status: DealStatus;
  dealType: 'Appartement' | 'Maison';
}

/**
 * ~26 ventes. deal.amount = HONORAIRES (≈ 3 à 6 % du prix du bien), base réelle de
 * la commission calculée par le moteur. Le PRIX du bien vit dans l'intitulé.
 *
 * RÈGLE DE COHÉRENCE DU CLASSEMENT (à ne pas casser) : une vente PENDING doit
 * toujours être clôturée dans le MOIS COURANT (m: 0). Sinon son CA tombe dans le
 * mois de clôture alors que sa commission (calculée « maintenant », non validée)
 * compterait dans le mois courant → l'affichage montrerait commissions > CA.
 * Les ventes des mois passés sont donc toujours VALIDATED ou PAID.
 *
 * Sophie & Thomas ont des ventes récentes pour animer leurs objectifs mensuels.
 * Une vente en CO-MANDAT (Sophie + Marie, split 50/50).
 */
const DEMO_DEALS: DemoDeal[] = [
  // — Sophie (objectif mensuel vivant) —
  { ext: 's01', bien: 'Appartement T3 — Lyon 3e', client: 'Famille Petit', prix: 268000, honoraires: 12000, who: 'sophie', when: { m: 0, d: 18 }, status: 'VALIDATED', dealType: 'Appartement' },
  { ext: 's02', bien: 'Appartement T2 — Villeurbanne', client: 'M. et Mme Roy', prix: 205000, honoraires: 9500, who: 'sophie', when: { m: 0, d: 11 }, status: 'PAID', dealType: 'Appartement' },
  { ext: 's03', bien: 'Maison 4P — Caluire-et-Cuire', client: 'Famille Dubois', prix: 415000, honoraires: 14000, who: 'sophie', when: { m: 0, d: 6 }, status: 'PENDING', dealType: 'Maison' },
  { ext: 's04', bien: 'Studio — Lyon 7e', client: 'Mlle Perrin', prix: 148000, honoraires: 6500, who: 'sophie', when: { m: 1, d: 15 }, status: 'PAID', dealType: 'Appartement' },

  // — Thomas (objectif mensuel vivant) —
  { ext: 't01', bien: 'Maison 5P — Écully', client: 'Famille Garnier', prix: 520000, honoraires: 21000, who: 'thomas', when: { m: 0, d: 16 }, status: 'PAID', dealType: 'Maison' },
  { ext: 't02', bien: 'Appartement T4 — Lyon 6e', client: 'M. Lefebvre', prix: 372000, honoraires: 15000, who: 'thomas', when: { m: 0, d: 9 }, status: 'VALIDATED', dealType: 'Appartement' },
  { ext: 't03', bien: 'Appartement T3 — Lyon 2e', client: 'Mme Chevalier', prix: 295000, honoraires: 13000, who: 'thomas', when: { m: 0, d: 4 }, status: 'PENDING', dealType: 'Appartement' },
  { ext: 't04', bien: 'Maison 6P — Sainte-Foy-lès-Lyon', client: 'Famille Moreau', prix: 610000, honoraires: 24000, who: 'thomas', when: { m: 2, d: 10 }, status: 'PAID', dealType: 'Maison' },

  // — Co-mandat Sophie + Marie (split 50/50) : grosse villa —
  { ext: 'co1', bien: 'Villa 7P avec piscine — Aix-en-Provence', client: 'Famille Lambert', prix: 780000, honoraires: 31000, who: ['sophie', 'marie'], when: { m: 0, d: 13 }, status: 'VALIDATED', dealType: 'Maison' },

  // — Camille —
  { ext: 'c01', bien: 'Appartement T2 — Lyon 8e', client: 'M. Renard', prix: 189000, honoraires: 8500, who: 'camille', when: { m: 0, d: 5 }, status: 'PENDING', dealType: 'Appartement' },
  { ext: 'c02', bien: 'Maison 4P — Vénissieux', client: 'Famille Faure', prix: 328000, honoraires: 14500, who: 'camille', when: { m: 0, d: 17 }, status: 'VALIDATED', dealType: 'Maison' },
  { ext: 'c03', bien: 'Appartement T3 — Oullins', client: 'Mme Girard', prix: 242000, honoraires: 10500, who: 'camille', when: { m: 1, d: 20 }, status: 'PAID', dealType: 'Appartement' },

  // — Julien (responsable, vend aussi) —
  { ext: 'j01', bien: 'Maison 5P — Lyon 5e', client: 'Famille Bertrand', prix: 495000, honoraires: 20000, who: 'julien', when: { m: 0, d: 7 }, status: 'VALIDATED', dealType: 'Maison' },
  { ext: 'j02', bien: 'Appartement T4 — Lyon 6e', client: 'M. et Mme Simon', prix: 448000, honoraires: 18500, who: 'julien', when: { m: 1, d: 12 }, status: 'PAID', dealType: 'Appartement' },
  { ext: 'j03', bien: 'Appartement T2 — Villeurbanne', client: 'Mlle Robert', prix: 198000, honoraires: 9000, who: 'julien', when: { m: 2, d: 8 }, status: 'PAID', dealType: 'Appartement' },

  // — Marie —
  { ext: 'm01', bien: 'Appartement T3 — Aix-en-Provence', client: 'Famille Blanc', prix: 340000, honoraires: 15000, who: 'marie', when: { m: 0, d: 8 }, status: 'PENDING', dealType: 'Appartement' },
  { ext: 'm02', bien: 'Maison 4P — Aix-en-Provence', client: 'M. Guerin', prix: 465000, honoraires: 19000, who: 'marie', when: { m: 1, d: 5 }, status: 'VALIDATED', dealType: 'Maison' },
  { ext: 'm03', bien: 'Studio — Aix-en-Provence', client: 'Mme Legrand', prix: 172000, honoraires: 7500, who: 'marie', when: { m: 2, d: 18 }, status: 'PAID', dealType: 'Appartement' },

  // — Antoine —
  { ext: 'a01', bien: 'Maison 5P — Marseille 8e', client: 'Famille Muller', prix: 540000, honoraires: 22000, who: 'antoine', when: { m: 0, d: 3 }, status: 'PENDING', dealType: 'Maison' },
  { ext: 'a02', bien: 'Appartement T4 — Marseille 6e', client: 'M. Nguyen', prix: 385000, honoraires: 16000, who: 'antoine', when: { m: 0, d: 14 }, status: 'VALIDATED', dealType: 'Appartement' },
  { ext: 'a03', bien: 'Appartement T2 — Aix-en-Provence', client: 'Mlle Roux', prix: 215000, honoraires: 9500, who: 'antoine', when: { m: 1, d: 22 }, status: 'PAID', dealType: 'Appartement' },

  // — Léa —
  { ext: 'l01', bien: 'Maison 6P — Aix-en-Provence', client: 'Famille Vidal', prix: 650000, honoraires: 26000, who: 'lea', when: { m: 0, d: 10 }, status: 'VALIDATED', dealType: 'Maison' },
  { ext: 'l02', bien: 'Appartement T3 — Marseille 9e', client: 'M. Fabre', prix: 258000, honoraires: 11500, who: 'lea', when: { m: 1, d: 9 }, status: 'PAID', dealType: 'Appartement' },
  { ext: 'l03', bien: 'Studio — Aix-en-Provence', client: 'Mme Henry', prix: 158000, honoraires: 7000, who: 'lea', when: { m: 2, d: 14 }, status: 'PAID', dealType: 'Appartement' },
  { ext: 'l04', bien: 'Appartement T4 — Marseille 8e', client: 'Famille Masson', prix: 410000, honoraires: 17000, who: 'lea', when: { m: 3, d: 10 }, status: 'PAID', dealType: 'Appartement' },
];

/** Intitulé de vente cohérent : « bien + localisation · vendu(e) PRIX € ». */
function dealTitle(d: DemoDeal): string {
  const verb = d.dealType === 'Maison' ? 'vendue' : 'vendu';
  return `${d.bien} · ${verb} ${d.prix.toLocaleString('fr-FR')} €`;
}

// ─── Reset propre (--reset) ────────────────────────────────────────────────────

/** Efface tout le tenant démo (ordre FK-safe) puis les comptes de démo. */
async function resetDemo(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  console.log('=== Reset démo immobilier ===');
  if (tenant) {
    const t = { tenantId: tenant.id };
    // Enfants d'abord, remontée vers le tenant
    await prisma.commission.deleteMany({ where: t });
    await prisma.commissionableEvent.deleteMany({ where: t });
    await prisma.commissionAdjustment.deleteMany({ where: t });
    await prisma.commissionDispute.deleteMany({ where: t });
    await prisma.dealAssignment.deleteMany({ where: t });
    await prisma.mission.deleteMany({ where: t });
    await prisma.planComponent.deleteMany({ where: t });
    await prisma.planAssignment.deleteMany({ where: t });
    await prisma.variablePlan.deleteMany({ where: t });
    await prisma.ruleAssignment.deleteMany({ where: t });
    await prisma.commissionRule.deleteMany({ where: t });
    await prisma.objectiveSnapshot.deleteMany({ where: t });
    await prisma.deal.deleteMany({ where: t });
    await prisma.contest.deleteMany({ where: t });
    await prisma.importBatch.deleteMany({ where: t });
    await prisma.importLog.deleteMany({ where: t });
    await prisma.payrollPeriod.deleteMany({ where: t });
    await prisma.auditLog.deleteMany({ where: t });
    await prisma.group.deleteMany({ where: t });
    // Détacher les utilisateurs puis les supprimer (jetons de session en cascade)
    await prisma.user.updateMany({ where: t, data: { groupId: null } });
    await prisma.user.deleteMany({ where: { email: { in: DEMO_EMAILS } } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    console.log(`  tenant « ${tenant.name} » et ses données supprimés.`);
  } else {
    // Sécurité : purge d'éventuels comptes orphelins portant les emails de démo
    await prisma.user.deleteMany({ where: { email: { in: DEMO_EMAILS } } });
    console.log('  aucun tenant démo existant (rien à supprimer).');
  }
  console.log('');
}

// ─── Construction idempotente ──────────────────────────────────────────────────

async function ensureTenant(): Promise<string> {
  const existing = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (existing) {
    await prisma.tenant.update({
      where: { id: existing.id },
      data: { name: TENANT_NAME, defaultJobTitle: 'Conseiller immobilier' },
    });
    console.log(`  tenant existant: ${TENANT_NAME}`);
    return existing.id;
  }
  const tenant = await prisma.tenant.create({
    data: {
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      plan: 'PRO',
      status: 'ACTIVE',
      defaultJobTitle: 'Conseiller immobilier',
    },
  });
  console.log(`  tenant créé: ${TENANT_NAME}`);
  return tenant.id;
}

async function ensureGroup(tenantId: string, name: string): Promise<string> {
  const existing = await prisma.group.findFirst({ where: { tenantId, name } });
  if (existing) return existing.id;
  const g = await prisma.group.create({ data: { tenantId, name } });
  console.log(`  groupe créé: ${name}`);
  return g.id;
}

async function ensureUser(
  tenantId: string,
  u: DemoUser,
  groupId: string | null,
): Promise<string> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const existing = await prisma.user.findUnique({ where: { email: u.email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        tenantId,
        groupId,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        jobTitle: u.jobTitle,
        fixedSalary: u.fixedSalary,
        isActive: true,
        emailVerified: true,
      },
    });
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      email: u.email,
      passwordHash,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      jobTitle: u.jobTitle,
      tenantId,
      groupId,
      fixedSalary: u.fixedSalary,
      isActive: true,
      emailVerified: true,
    },
  });
  console.log(`  compte créé: ${u.firstName} ${u.lastName} (${u.role}) — ${u.email}`);
  return created.id;
}

async function ensureRule(tenantId: string, createdBy: string): Promise<string> {
  const name = 'Rétrocession honoraires (paliers)';
  const existing = await prisma.commissionRule.findFirst({ where: { tenantId, name } });
  if (existing) {
    await prisma.commissionRule.update({
      where: { id: existing.id },
      data: {
        type: CommissionRuleType.TIERED,
        dealType: null, // règle générique : s'applique à toutes les ventes (repli)
        config: RETROCESSION_CONFIG as unknown as Prisma.InputJsonValue,
        description: RETROCESSION_CONFIG.description,
        isArchived: false,
        isActive: true,
      },
    });
    console.log(`  règle resynchronisée: ${name}`);
    return existing.id;
  }
  const rule = await commissionRuleRepository.create({
    tenantId,
    name,
    description: RETROCESSION_CONFIG.description,
    type: CommissionRuleType.TIERED,
    config: RETROCESSION_CONFIG,
    createdBy,
    dealType: null,
    scope: RuleScope.GLOBAL,
    paymentDelayDays: null,
  });
  console.log(`  règle créée: ${name}`);
  return rule.id;
}

async function ensureRuleAssignment(tenantId: string, ruleId: string, userId: string): Promise<void> {
  const existing = await prisma.ruleAssignment.findFirst({
    where: { tenantId, ruleId, userId, isActive: true },
  });
  if (existing) return;
  await ruleAssignmentRepository.assign({
    tenantId,
    ruleId,
    assignedToType: AssigneeType.INDIVIDUAL,
    userId,
  });
}

/** Ajoute (ou remplace par libellé) un objectif au tableau de bord d'un conseiller. */
async function ensureObjective(userId: string, objective: Objective): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { objectives: true } });
  const existing = Array.isArray(user?.objectives)
    ? (user!.objectives as unknown as Objective[])
    : [];
  const kept = existing.filter((o) => o.label !== objective.label);
  await prisma.user.update({
    where: { id: userId },
    data: { objectives: [...kept, objective] as unknown as Prisma.InputJsonValue },
  });
}

/** Crée/resynchronise le plan de variable modèle (règle paliers + objectif). */
async function ensurePlan(
  tenantId: string,
  createdBy: string,
  ruleId: string,
  objectiveTemplate: Objective,
): Promise<string> {
  const name = 'Plan Conseiller Immobilier';
  const description =
    'Rétrocession des honoraires par paliers (70 / 80 / 87 %) + objectif d\'honoraires mensuel.';
  const componentsCreate: Prisma.PlanComponentUncheckedCreateWithoutPlanInput[] = [
    {
      tenantId,
      kind: 'COMMISSION_RULE',
      ruleId,
      appliesToEventType: 'DEAL_WON',
      sortOrder: 0,
    },
    {
      tenantId,
      kind: 'OBJECTIVE',
      objectiveConfig: objectiveTemplate as unknown as Prisma.InputJsonValue,
      appliesToEventType: 'DEAL_WON',
      sortOrder: 1,
    },
  ];

  const existing = await prisma.variablePlan.findFirst({ where: { tenantId, name } });
  if (existing) {
    await prisma.$transaction([
      prisma.planComponent.deleteMany({ where: { planId: existing.id, tenantId } }),
      prisma.variablePlan.update({
        where: { id: existing.id },
        data: { description, components: { create: componentsCreate } },
      }),
    ]);
    console.log(`  plan resynchronisé: ${name}`);
    return existing.id;
  }
  const plan = await prisma.variablePlan.create({
    data: {
      tenantId,
      name,
      description,
      isTemplate: true,
      createdBy,
      components: { create: componentsCreate },
    },
  });
  console.log(`  plan créé: ${name}`);
  return plan.id;
}

async function ensurePlanAssignment(tenantId: string, planId: string, userId: string): Promise<void> {
  const existing = await prisma.planAssignment.findFirst({ where: { tenantId, planId, userId } });
  if (existing) {
    if (!existing.isActive) {
      await prisma.planAssignment.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return;
  }
  await prisma.planAssignment.create({
    data: { tenantId, planId, assignedToType: 'INDIVIDUAL', userId },
  });
}

/** Upsert d'une vente (source FILE, aucune trace CRM recrutement). */
async function upsertDeal(
  tenantId: string,
  d: DemoDeal,
  primaryUserId: string,
): Promise<string> {
  const fileExternalId = `${DEAL_PREFIX}${d.ext}`;
  const closedAt = dateOf(d.when.m, d.when.d);
  const title = dealTitle(d);
  const deal = await prisma.deal.upsert({
    where: { tenantId_fileExternalId: { tenantId, fileExternalId } },
    update: {
      title,
      clientName: d.client,
      amount: d.honoraires,
      status: 'WON',
      probability: 100,
      assignedToId: primaryUserId,
      closedAt,
      dealType: d.dealType,
      syncedAt: new Date(),
    },
    create: {
      tenantId,
      fileExternalId,
      source: 'FILE',
      title,
      clientName: d.client,
      amount: d.honoraires,
      currency: 'EUR',
      status: 'WON',
      probability: 100,
      assignedToId: primaryUserId,
      closedAt,
      dealType: d.dealType,
    },
  });
  return deal.id;
}

/**
 * Applique le statut voulu aux commissions d'une vente (VALIDATED / PAID),
 * en respectant les invariants (validatedAt/paidAt renseignés).
 */
async function applyCommissionStatus(dealId: string, status: DealStatus, closedAt: Date): Promise<void> {
  if (status === 'PENDING') return; // recalc laisse déjà en PENDING
  if (status === 'VALIDATED') {
    await prisma.commission.updateMany({
      where: { dealId, status: 'PENDING' },
      data: { status: 'VALIDATED', validatedAt: closedAt, scheduledPaymentAt: null, awaitingClientPayment: false },
    });
  } else if (status === 'PAID') {
    const paidAt = closedAt;
    const validatedAt = new Date(closedAt.getTime() - 2 * 24 * 3600 * 1000);
    await prisma.commission.updateMany({
      where: { dealId, status: { in: ['PENDING', 'VALIDATED'] } },
      data: { status: 'PAID', validatedAt, paidAt, scheduledPaymentAt: null, awaitingClientPayment: false },
    });
  }
}

// ─── Vérification des invariants (échoue le seed si violé) ───────────────────────

/**
 * Contrôles de crédibilité, exécutés en fin de seed. Lèvent une erreur (→ seed en
 * échec) si une incohérence est détectée :
 *   1. Statique — chaque vente : honoraires ∈ [2,5 % ; 7 %] du prix du bien.
 *   2. Par vente — commission ≤ honoraires du deal (jamais l'inverse).
 *   3. Par conseiller (cumul) — total commissions ≤ total honoraires (part incluse).
 *   4. Par conseiller (MOIS COURANT) — commissions-en-période ≤ CA-en-période, en
 *      répliquant EXACTEMENT la logique du classement manager. C'est le garde-fou
 *      du bug « commissions > CA » : il échoue si une vente PENDING d'un mois passé
 *      réapparaît dans les commissions du mois courant.
 */
async function verifyInvariants(tenantId: string): Promise<void> {
  console.log('\n=== Vérification des invariants ===');
  const errors: string[] = [];
  const EPS = 0.01;

  // 1. Ratio honoraires / prix (statique, sur le catalogue de démo)
  for (const d of DEMO_DEALS) {
    const ratio = d.honoraires / d.prix;
    if (ratio < 0.025 || ratio > 0.07) {
      errors.push(`Vente ${d.ext} : honoraires ${d.honoraires}€ = ${(ratio * 100).toFixed(1)}% du prix (hors 2,5–7 %).`);
    }
  }

  // Commissions actives (hors annulées) + honoraires du deal + part du conseiller
  const commissions = await prisma.commission.findMany({
    where: { tenantId, status: { not: 'CANCELLED' } },
    select: {
      amount: true, userId: true, status: true, validatedAt: true, calculatedAt: true,
      deal: { select: { id: true, amount: true, closedAt: true } },
    },
  });
  const assignments = await prisma.dealAssignment.findMany({
    where: { tenantId },
    select: { dealId: true, userId: true, share: true },
  });
  const shareOf = new Map<string, number>(); // clé `${dealId}|${userId}`
  for (const a of assignments) shareOf.set(`${a.dealId}|${a.userId}`, a.share);

  // 2. Commission ≤ honoraires de son deal
  for (const c of commissions) {
    if (c.deal && c.amount > c.deal.amount + EPS) {
      errors.push(`Commission ${c.amount.toFixed(2)}€ > honoraires ${c.deal.amount.toFixed(2)}€ (deal ${c.deal.id}).`);
    }
  }

  // 3. Par conseiller : Σ commissions ≤ Σ honoraires (part incluse)
  const honorairesByUser = new Map<string, number>();
  const commByUser = new Map<string, number>();
  const wonAmountByDeal = new Map<string, number>();
  for (const c of commissions) {
    if (!c.deal) continue;
    wonAmountByDeal.set(c.deal.id, c.deal.amount);
    commByUser.set(c.userId, (commByUser.get(c.userId) ?? 0) + c.amount);
  }
  for (const a of assignments) {
    const dealAmount = wonAmountByDeal.get(a.dealId);
    if (dealAmount === undefined) continue;
    honorairesByUser.set(a.userId, (honorairesByUser.get(a.userId) ?? 0) + dealAmount * a.share);
  }
  for (const [userId, comm] of commByUser) {
    const hono = honorairesByUser.get(userId) ?? 0;
    if (comm > hono + EPS) {
      errors.push(`Conseiller ${userId} : total commissions ${comm.toFixed(2)}€ > total honoraires ${hono.toFixed(2)}€.`);
    }
  }

  // 4. Mois courant : commissions-en-période ≤ CA-en-période (logique du classement)
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const inPeriod = (dt: Date | null) => dt !== null && dt >= start && dt <= end;

  const caMonthByUser = new Map<string, number>();
  for (const a of assignments) {
    const c = commissions.find((x) => x.deal?.id === a.dealId);
    const closedAt = c?.deal?.closedAt ?? null;
    if (inPeriod(closedAt)) {
      const dealAmount = wonAmountByDeal.get(a.dealId) ?? 0;
      caMonthByUser.set(a.userId, (caMonthByUser.get(a.userId) ?? 0) + dealAmount * a.share);
    }
  }
  const commMonthByUser = new Map<string, number>();
  for (const c of commissions) {
    // Réplique findByUserIdsInPeriod : validée dans la période, ou PENDING (validatedAt null) calculée dans la période
    const counts = inPeriod(c.validatedAt) || (c.validatedAt === null && inPeriod(c.calculatedAt));
    if (counts) commMonthByUser.set(c.userId, (commMonthByUser.get(c.userId) ?? 0) + c.amount);
  }
  for (const [userId, comm] of commMonthByUser) {
    const ca = caMonthByUser.get(userId) ?? 0;
    if (comm > ca + EPS) {
      errors.push(`Conseiller ${userId} (mois courant) : commissions ${comm.toFixed(2)}€ > CA ${ca.toFixed(2)}€ — incohérence classement.`);
    }
  }

  if (errors.length > 0) {
    console.error('  ❌ Invariants VIOLÉS :');
    for (const e of errors) console.error(`     • ${e}`);
    throw new Error(`Seed interrompu : ${errors.length} invariant(s) de crédibilité violé(s).`);
  }
  console.log('  ✅ Tous les invariants sont respectés (ratios, commission ≤ honoraires, mois courant cohérent).');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  if (reset) await resetDemo();

  console.log('=== Seed démo IMMOBILIER (réseau de mandataires) ===\n');

  // 1. Tenant
  console.log('Tenant :');
  const tenantId = await ensureTenant();

  // 2. Groupes (agences)
  console.log('\nAgences :');
  const groupIds: Record<string, string> = {
    [GROUP_LYON]: await ensureGroup(tenantId, GROUP_LYON),
    [GROUP_AIX]: await ensureGroup(tenantId, GROUP_AIX),
  };

  // 3. Comptes
  console.log('\nComptes :');
  const userIds = {} as Record<UserKey, string>;
  for (const u of DEMO_USERS) {
    const groupId = u.groupName ? groupIds[u.groupName] : null;
    userIds[u.key] = await ensureUser(tenantId, u, groupId);
  }

  // Hiérarchie : Julien dirige l'agence Lyon ; le directeur pilote les deux agences
  // ET assure lui-même la responsabilité de l'agence Aix (un dirigeant peut très
  // bien être aussi responsable d'une équipe).
  await prisma.group.update({
    where: { id: groupIds[GROUP_LYON] },
    data: { leadId: userIds.julien, managerId: userIds.directeur },
  });
  await prisma.group.update({
    where: { id: groupIds[GROUP_AIX] },
    data: { leadId: userIds.directeur, managerId: userIds.directeur },
  });

  // 4. Règle à paliers + assignation à tous les vendeurs (pas le directeur)
  console.log('\nRègle de commission :');
  const ruleId = await ensureRule(tenantId, userIds.directeur);
  const sellers: UserKey[] = ['julien', 'sophie', 'thomas', 'camille', 'marie', 'antoine', 'lea'];
  for (const key of sellers) {
    await ensureRuleAssignment(tenantId, ruleId, userIds[key]);
  }
  console.log(`  règle assignée à ${sellers.length} vendeurs`);

  // 5. Objectifs (Sophie & Thomas) — honoraires mensuels + trimestriels
  console.log('\nObjectifs :');
  const now = new Date();
  const month = now.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const year = now.getFullYear();

  const objMonthlySophie: Objective = {
    id: randomUUID(),
    label: 'Objectif honoraires mensuel',
    target: 24000,
    unit: '€',
    periodType: 'monthly',
    month,
    year,
    bonusMode: 'tiered',
    bonusTiers: [
      { threshold: 80, reward: { type: 'fixed', value: 300 } },
      { threshold: 100, reward: { type: 'fixed', value: 800 } },
    ],
  };
  const objQuarterSophie: Objective = {
    id: randomUUID(),
    label: 'Objectif honoraires trimestriel',
    target: 60000,
    unit: '€',
    periodType: 'quarterly',
    quarter,
    year,
    bonusMode: 'tiered',
    bonusTiers: [{ threshold: 100, reward: { type: 'fixed', value: 1500 } }],
  };
  const objMonthlyThomas: Objective = {
    id: randomUUID(),
    label: 'Objectif honoraires mensuel',
    target: 22000,
    unit: '€',
    periodType: 'monthly',
    month,
    year,
    bonusMode: 'tiered',
    bonusTiers: [{ threshold: 100, reward: { type: 'fixed', value: 600 } }],
  };

  await ensureObjective(userIds.sophie, objMonthlySophie);
  await ensureObjective(userIds.sophie, objQuarterSophie);
  await ensureObjective(userIds.thomas, objMonthlyThomas);
  console.log('  Sophie (mensuel + trimestriel), Thomas (mensuel)');

  // 6. Plan de variable modèle + assignations
  console.log('\nPlan de variable :');
  const planObjectiveTemplate: Objective = {
    id: randomUUID(),
    label: 'Objectif honoraires mensuel',
    target: 22000,
    unit: '€',
    periodType: 'monthly',
    month,
    year,
    bonusMode: 'tiered',
    bonusTiers: [{ threshold: 100, reward: { type: 'fixed', value: 600 } }],
  };
  const planId = await ensurePlan(tenantId, userIds.directeur, ruleId, planObjectiveTemplate);
  for (const key of sellers) {
    await ensurePlanAssignment(tenantId, planId, userIds[key]);
  }
  console.log(`  plan assigné à ${sellers.length} conseillers`);

  // 7. Ventes + commissions (moteur réel) + statuts
  console.log('\nVentes :');
  let coMandats = 0;
  for (const d of DEMO_DEALS) {
    const isCo = Array.isArray(d.who);
    const primaryKey = isCo ? (d.who as [UserKey, UserKey])[0] : (d.who as UserKey);
    const dealId = await upsertDeal(tenantId, d, userIds[primaryKey]);

    if (isCo) {
      const [a, b] = d.who as [UserKey, UserKey];
      await dealAssignmentRepository.upsertForDeal(dealId, tenantId, [
        { userId: userIds[a], share: 0.5 },
        { userId: userIds[b], share: 0.5 },
      ]);
      coMandats += 1;
    } else {
      await dealAssignmentRepository.upsertForDeal(dealId, tenantId, [
        { userId: userIds[primaryKey], share: 1.0 },
      ]);
    }

    await commissionService.recalculateForDeal(dealId, tenantId);
    await applyCommissionStatus(dealId, d.status, dateOf(d.when.m, d.when.d));
  }
  console.log(`  ${DEMO_DEALS.length} ventes traitées (dont ${coMandats} co-mandat)`);

  // 8. Résumé
  console.log('\n=== Résumé ===');
  for (const u of DEMO_USERS) {
    if (u.role === 'MANAGER') continue;
    const id = userIds[u.key];
    const agg = await prisma.commission.groupBy({
      by: ['status'],
      where: { tenantId, userId: id },
      _sum: { amount: true },
    });
    const byStatus = (s: string) => agg.find((a) => a.status === s)?._sum.amount ?? 0;
    console.log(
      `  ${u.firstName} ${u.lastName}: ` +
        `en attente ${byStatus('PENDING').toFixed(0)}€ · ` +
        `validées ${byStatus('VALIDATED').toFixed(0)}€ · ` +
        `versées ${byStatus('PAID').toFixed(0)}€`,
    );
  }

  // 8.5 Vérification bloquante des invariants de crédibilité
  await verifyInvariants(tenantId);

  // 9. Identifiants de connexion
  console.log('\n=== Identifiants de connexion (mot de passe commun) ===');
  console.log(`  Mot de passe : ${DEMO_PASSWORD}`);
  const directeur = DEMO_USERS.find((u) => u.role === 'MANAGER')!;
  const conseiller = DEMO_USERS.find((u) => u.key === 'sophie')!;
  console.log(`  ▸ DIRECTEUR RÉSEAU : ${directeur.email}`);
  console.log(`  ▸ CONSEILLÈRE      : ${conseiller.email}`);
  console.log('  (tous les comptes de démo utilisent le même mot de passe)');

  await prisma.$disconnect();
  console.log('\n✅ Seed immobilier terminé.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
