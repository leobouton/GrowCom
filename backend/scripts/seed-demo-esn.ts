/**
 * seed-demo-esn.ts — Données de démonstration Venatis.
 *
 * Simule un flux Odoo (source ODOO + odooId) SANS insertion brute : on passe par les
 * VRAIS repositories + le moteur de commission + le job de récurrence, exactement comme
 * le fait odooService.sync après avoir lu le CRM. Objectif : tester la mécanique réelle
 * (recrutement direct / vente de formation one-shot + portage ESN récurrent avec override).
 *
 * Idempotent : upserts par odooId, règles/assignations find-or-create. Réexécutable.
 *
 * Lancer : npx tsx scripts/seed-demo-esn.ts
 */
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

async function findOrCreateRule(name: string, type: CommissionRuleType, config: CommissionRuleConfig): Promise<string> {
  const existing = await prisma.commissionRule.findFirst({ where: { tenantId: TENANT, name } });
  if (existing) {
    console.log(`  règle existante: ${name}`);
    return existing.id;
  }
  const rule = await commissionRuleRepository.create({
    tenantId: TENANT,
    name,
    description: config.description,
    type,
    config,
    createdBy: CREATED_BY,
    dealType: null,
    scope: RuleScope.GLOBAL,
    paymentDelayDays: null,
  });
  console.log(`  règle créée: ${name}`);
  return rule.id;
}

async function ensureAssignment(userId: string, ruleId: string, overrides?: Record<string, unknown>): Promise<void> {
  const existing = await prisma.ruleAssignment.findFirst({
    where: { tenantId: TENANT, ruleId, userId, isActive: true },
  });
  if (existing) return;
  await ruleAssignmentRepository.assign({
    tenantId: TENANT,
    ruleId,
    assignedToType: AssigneeType.INDIVIDUAL,
    userId,
    overrides: overrides ?? null,
  });
}

async function seedDeal(params: {
  odooId: string; title: string; clientName: string; amount: number;
  marginAmount: number | null; userId: string; closedAt: Date;
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
  });
  await dealAssignmentRepository.upsertForDeal(deal.id, TENANT, [{ userId: params.userId, share: 1.0 }]);
  await commissionService.recalculateForDeal(deal.id, TENANT);
  return deal.id;
}

async function main() {
  console.log('=== Seed démo ESN (simulation flux Odoo) ===\n');

  // ── 1. Règles de commission ──
  console.log('Règles :');
  const rRecrut = await findOrCreateRule('Prime recrutement direct', CommissionRuleType.PERCENTAGE, {
    type: CommissionRuleType.PERCENTAGE,
    description: '15% de la marge du recrutement, à la signature',
    rate: 0.15,
    calculationBasis: 'MARGIN',
    appliesToEventType: 'DEAL_WON',
    examples: [{ saleAmount: 8000, commission: 1200, explanation: 'Marge 8 000€ × 15% = 1 200€' }],
  });
  const rFormation = await findOrCreateRule('Commission formation', CommissionRuleType.PERCENTAGE, {
    type: CommissionRuleType.PERCENTAGE,
    description: '8% du CA des ventes de formation',
    rate: 0.08,
    calculationBasis: 'REVENUE',
    appliesToEventType: 'DEAL_WON',
    examples: [{ saleAmount: 12000, commission: 960, explanation: 'CA 12 000€ × 8% = 960€' }],
  });
  const rPortageMarge = await findOrCreateRule('Portage ESN — marge mensuelle', CommissionRuleType.PERCENTAGE, {
    type: CommissionRuleType.PERCENTAGE,
    description: '5% de la marge mensuelle récurrente tant que la mission tourne',
    rate: 0.05,
    calculationBasis: 'MARGIN',
    appliesToEventType: 'MISSION_MONTH',
    examples: [{ saleAmount: 3000, commission: 150, explanation: 'Marge mensuelle 3 000€ × 5% = 150€' }],
  });
  const rPortageForfait = await findOrCreateRule('Portage ESN — forfait consultant', CommissionRuleType.FIXED, {
    type: CommissionRuleType.FIXED,
    description: '100€ par mois et par consultant placé',
    fixedAmount: 100,
    calculationBasis: 'PER_UNIT',
    appliesToEventType: 'MISSION_MONTH',
    examples: [{ saleAmount: 3, commission: 300, explanation: '3 consultants × 100€ = 300€' }],
  });

  // ── 2. Assignations (Matteo = senior avec overrides) ──
  console.log('\nAssignations :');
  await ensureAssignment(U.floriant, rRecrut);
  await ensureAssignment(U.floriant, rPortageMarge);
  await ensureAssignment(U.floriant, rPortageForfait);

  await ensureAssignment(U.thibault, rFormation);
  await ensureAssignment(U.thibault, rPortageMarge);
  await ensureAssignment(U.thibault, rPortageForfait);

  await ensureAssignment(U.matteo, rRecrut);
  await ensureAssignment(U.matteo, rPortageMarge, { rate: 0.06 });     // senior : 6% au lieu de 5%
  await ensureAssignment(U.matteo, rPortageForfait, { fixedAmount: 150 }); // senior : 150€/consultant
  console.log('  assignations OK (override senior sur Matteo)');

  // ── 3. Deals one-shot (recrutement direct / formation) — deals WON Odoo ──
  console.log('\nDeals one-shot (WON) :');
  await seedDeal({ odooId: 'demo-odoo-2001', title: '[DEMO] Recrutement Ingénieur DevOps — CDI', clientName: 'TechCorp', amount: 8000, marginAmount: 8000, userId: U.floriant, closedAt: daysAgo(5) });
  await seedDeal({ odooId: 'demo-odoo-2005', title: '[DEMO] Recrutement Lead Developer — CDI', clientName: 'StartupX', amount: 10000, marginAmount: 10000, userId: U.matteo, closedAt: daysAgo(8) });
  await seedDeal({ odooId: 'demo-odoo-2002', title: '[DEMO] Formation React Avancé (5j)', clientName: 'DigitalPlus', amount: 12000, marginAmount: null, userId: U.thibault, closedAt: daysAgo(3) });
  console.log('  3 deals one-shot + commissions recalculées');

  // ── 4. Deals d'ancrage portage (contrat signé, valeur one-shot nulle) ──
  console.log('\nDeals d\'ancrage portage (WON, ancre des missions) :');
  const dPortageFloriant = await seedDeal({ odooId: 'demo-odoo-2003', title: '[DEMO] Portage — Consultant Data Engineer (contrat)', clientName: 'BigRetail', amount: 0, marginAmount: 0, userId: U.floriant, closedAt: daysAgo(90) });
  const dPortageThibault = await seedDeal({ odooId: 'demo-odoo-2004', title: '[DEMO] Portage — Consultant Cloud (contrat)', clientName: 'AeroSys', amount: 0, marginAmount: 0, userId: U.thibault, closedAt: daysAgo(60) });
  const dPortageMatteo = await seedDeal({ odooId: 'demo-odoo-2006', title: '[DEMO] Portage — Consultant Cybersécurité (contrat)', clientName: 'DefenseCorp', amount: 0, marginAmount: 0, userId: U.matteo, closedAt: daysAgo(30) });
  console.log('  3 deals d\'ancrage');

  // ── 5. Missions récurrentes (sale.order abonnements Odoo) ──
  console.log('\nMissions récurrentes (abonnements Odoo) :');
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3001', dealId: dPortageFloriant, userId: U.floriant,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 9000, consultantCount: 1,
    startDate: monthsFromNow(-3), expectedEndDate: monthsFromNow(9), status: 'ACTIVE',
    source: 'ODOO', marginAmount: 3000, marginSource: 'ODOO',
  });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3002', dealId: dPortageThibault, userId: U.thibault,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 12000, consultantCount: 2,
    startDate: monthsFromNow(-2), expectedEndDate: null, status: 'ACTIVE',
    source: 'ODOO', marginAmount: 4000, marginSource: 'ODOO',
  });
  await missionRepository.upsertOdoo({
    tenantId: TENANT, odooId: 'demo-sub-3003', dealId: dPortageMatteo, userId: U.matteo,
    type: 'MARGIN_MENSUELLE', monthlyAmount: 15000, consultantCount: 3,
    startDate: monthsFromNow(-1), expectedEndDate: monthsFromNow(11), status: 'ACTIVE',
    source: 'ODOO', marginAmount: 5000, marginSource: 'ODOO',
  });
  console.log('  3 missions actives (Floriant 1 consultant, Thibault 2, Matteo 3 avec override)');

  // ── 6. Job de récurrence réel : génère les commissions du mois ──
  console.log('\nJob de récurrence (génération commissions du mois en cours) :');
  await generateRecurringMissionCommissions(new Date());

  // ── 7. Résumé ──
  console.log('\n=== Résumé ===');
  for (const [name, id] of Object.entries(U)) {
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
