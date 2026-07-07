/**
 * AUDIT D'INVARIANTS — vérifie la cohérence des données de commissions en base.
 * Lecture seule (aucune écriture). Chaque section affiche ✅ ou la liste des anomalies.
 */
import { prisma } from '../src/config/prisma';
import { commissionRepository } from '../src/repositories/commission.repository';
import {
  calculateCommissionAmount,
  resolveBasisAmount,
  resolveEffectiveConfig,
  filterAssignmentsForDealType,
} from '../src/services/commission.service';
import type { CommissionRuleConfig } from '../../shared/types';

let anomalies = 0;

function section(title: string) {
  console.log(`\n═══ ${title} ═══`);
}
function ok(msg: string) {
  console.log(`  ✅ ${msg}`);
}
function bad(msg: string) {
  anomalies++;
  console.log(`  ❌ ${msg}`);
}

async function main() {
  // ── 1. Montants négatifs ──────────────────────────────────────────────────
  section('1. Commissions à montant négatif');
  const negatives = await prisma.commission.findMany({
    where: { amount: { lt: 0 } },
    include: { deal: { select: { title: true } }, user: { select: { firstName: true, lastName: true } } },
  });
  if (negatives.length === 0) ok('Aucune commission négative');
  for (const c of negatives) bad(`${c.user.firstName} | ${c.deal.title} | ${c.amount}€ | ${c.status}`);

  // ── 2. Doublons deal (missionId NULL ne bloque pas l'unicité Postgres) ────
  section('2. Doublons de commission par (deal, user, règle) hors mission');
  const dealCommissions = await prisma.commission.findMany({
    where: { missionId: null },
    select: { id: true, dealId: true, userId: true, ruleId: true, amount: true, status: true },
  });
  const seen = new Map<string, number>();
  for (const c of dealCommissions) {
    const key = `${c.dealId}|${c.userId}|${c.ruleId}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length === 0) ok(`Aucun doublon (${dealCommissions.length} commissions deal vérifiées)`);
  for (const [key, n] of dups) bad(`${n} commissions pour la même clé ${key}`);

  // ── 3. Doublons mission (mission, règle, mois) ────────────────────────────
  section('3. Doublons de commission par (mission, règle, mois)');
  const missionCommissions = await prisma.commission.findMany({
    where: { missionId: { not: null } },
    select: { missionId: true, ruleId: true, periodMonth: true, userId: true },
  });
  const seenM = new Map<string, number>();
  for (const c of missionCommissions) {
    const key = `${c.missionId}|${c.ruleId}|${c.periodMonth?.toISOString() ?? 'null'}`;
    seenM.set(key, (seenM.get(key) ?? 0) + 1);
  }
  const dupsM = [...seenM.entries()].filter(([, n]) => n > 1);
  if (dupsM.length === 0) ok(`Aucun doublon (${missionCommissions.length} commissions mission vérifiées)`);
  for (const [key, n] of dupsM) bad(`${n} commissions pour la clé ${key}`);

  // ── 4. États incohérents ──────────────────────────────────────────────────
  section('4. États incohérents');
  const validatedNoDate = await prisma.commission.count({
    where: { status: { in: ['VALIDATED', 'PAID'] }, validatedAt: null, paidAt: null },
  });
  if (validatedNoDate === 0) ok('Toutes les VALIDATED/PAID ont une date de validation ou de paiement');
  else bad(`${validatedNoDate} commissions VALIDATED/PAID sans validatedAt NI paidAt`);

  const awaitingButValidated = await prisma.commission.count({
    where: { awaitingClientPayment: true, status: { in: ['VALIDATED', 'PAID'] } },
  });
  if (awaitingButValidated === 0) ok('Aucune commission à la fois validée ET en attente de paiement client');
  else bad(`${awaitingButValidated} commissions VALIDATED/PAID encore marquées awaitingClientPayment`);

  const paidNoDate = await prisma.commission.count({ where: { status: 'PAID', paidAt: null } });
  if (paidNoDate === 0) ok('Toutes les PAID ont une date de paiement');
  else bad(`${paidNoDate} commissions PAID sans paidAt`);

  const cancelledNoDate = await prisma.commission.count({ where: { status: 'CANCELLED', cancelledAt: null } });
  if (cancelledNoDate === 0) ok('Toutes les CANCELLED ont une date d\'annulation');
  else bad(`${cancelledNoDate} commissions CANCELLED sans cancelledAt`);

  // ── 5. Dates impossibles ──────────────────────────────────────────────────
  section('5. Dates impossibles (validée avant la signature du deal)');
  const withDeal = await prisma.commission.findMany({
    where: { status: { in: ['VALIDATED', 'PAID'] }, missionId: null },
    include: { deal: { select: { title: true, closedAt: true } }, user: { select: { firstName: true } } },
  });
  const badDates = withDeal.filter(
    (c) => c.deal.closedAt && c.validatedAt && c.validatedAt < c.deal.closedAt,
  );
  if (badDates.length === 0) ok(`Aucune (${withDeal.length} vérifiées)`);
  for (const c of badDates) {
    bad(`${c.user.firstName} | ${c.deal.title} | validée ${c.validatedAt?.toISOString().slice(0, 10)} avant signature ${c.deal.closedAt?.toISOString().slice(0, 10)}`);
  }

  // ── 6. Commissions sur des deals non gagnés ───────────────────────────────
  section('6. Commissions actives sur des deals non gagnés');
  const onNotWon = await prisma.commission.findMany({
    where: { status: { in: ['PENDING', 'VALIDATED', 'PAID'] }, deal: { status: { not: 'WON' } } },
    include: { deal: { select: { title: true, status: true } }, user: { select: { firstName: true } } },
  });
  if (onNotWon.length === 0) ok('Toutes les commissions actives portent sur des deals WON');
  for (const c of onNotWon) bad(`${c.user.firstName} | ${c.deal.title} (${c.deal.status}) | ${c.amount}€ ${c.status}`);

  // ── 7. Deals WON sans date de signature ───────────────────────────────────
  section('7. Deals WON sans closedAt');
  const wonNoDate = await prisma.deal.count({ where: { status: 'WON', closedAt: null } });
  if (wonNoDate === 0) ok('Tous les deals WON ont une date de signature');
  else bad(`${wonNoDate} deals WON sans closedAt (ils échappent aux filtres par mois)`);

  // ── 8. Recalcul : chaque commission deal PENDING recalculable à l'identique ─
  section('8. Recalcul des commissions deal PENDING (montant stocké = moteur)');
  const pendings = await prisma.commission.findMany({
    where: { status: 'PENDING', missionId: null },
    include: {
      deal: true,
      rule: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  let recalcOk = 0;
  for (const c of pendings) {
    // Retrouver l'assignation active de cette règle pour ce user (overrides)
    const assignments = await prisma.ruleAssignment.findMany({
      where: { tenantId: c.tenantId, ruleId: c.ruleId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    const userGroup = await prisma.user.findUnique({
      where: { id: c.userId }, select: { group: { select: { name: true } } },
    });
    const assignment = assignments.find(
      (a) =>
        (a.assignedToType === 'USER' && a.userId === c.userId) ||
        (a.assignedToType === 'TEAM' && a.teamName === (userGroup?.group?.name ?? '')),
    );
    const share = (await prisma.dealAssignment.findFirst({
      where: { dealId: c.dealId, userId: c.userId },
    }))?.share ?? 1.0;

    const baseConfig = c.rule.config as unknown as CommissionRuleConfig;
    // Placeholder « pas de règle » (TEAM_LEAD) : montant 0 attendu
    if (!baseConfig?.type) {
      if (c.amount !== 0) bad(`${c.user.firstName} | ${c.deal.title} | placeholder ≠ 0€ (${c.amount}€)`);
      else recalcOk++;
      continue;
    }
    const config = resolveEffectiveConfig(
      baseConfig,
      (assignment?.overrides as Partial<CommissionRuleConfig> | null) ?? null,
    );
    const applicable = filterAssignmentsForDealType(
      [{ rule: { dealType: c.rule.dealType } }],
      c.deal.dealType,
    );
    if (applicable.length === 0) {
      bad(`${c.user.firstName} | ${c.deal.title} | règle « ${c.rule.name} » (type ${c.rule.dealType ?? 'générique'}) ne matche plus le deal (${c.deal.dealType ?? 'sans type'}) — commission obsolète ?`);
      continue;
    }
    const { basisAmount } = resolveBasisAmount(config, {
      amount: c.deal.amount,
      marginAmount: c.deal.marginAmount,
      costAmount: c.deal.costAmount,
    });
    const { amount: totalAmount } = calculateCommissionAmount(basisAmount, config);
    const expected = Math.round(totalAmount * share * 100) / 100;
    const stored = Math.round(c.amount * 100) / 100;
    if (Math.abs(expected - stored) > 0.01) {
      bad(`${c.user.firstName} ${c.user.lastName} | ${c.deal.title} | stocké ${stored}€ ≠ recalculé ${expected}€ (règle « ${c.rule.name} », share ${share})`);
    } else {
      recalcOk++;
    }
  }
  if (pendings.length === 0) ok('Aucune commission PENDING à vérifier');
  else if (recalcOk === pendings.length) ok(`${recalcOk}/${pendings.length} commissions PENDING recalculées à l'identique`);
  else console.log(`  → ${recalcOk}/${pendings.length} conformes`);

  // ── 9. Cohérence manager ↔ commercial : total gains du mois ──────────────
  section('9. Cohérence des totaux « gains du mois » par utilisateur');
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['COMMERCIAL', 'RECRUITER', 'TEAM_LEAD', 'BU_MANAGER'] } },
    select: { id: true, tenantId: true, firstName: true, lastName: true },
  });
  let sumOk = 0;
  for (const u of users) {
    // Total serveur (celui du header du dashboard)
    const serverTotal = await commissionRepository.sumByUserAndMonth(u.id, u.tenantId, startOfMonth, endOfMonth);
    // Total « tableau » : même règle que le frontend (validatedAt ?? paidAt ?? calculatedAt)
    const all = await prisma.commission.findMany({
      where: { userId: u.id, tenantId: u.tenantId, status: { in: ['VALIDATED', 'PAID'] } },
      select: { amount: true, validatedAt: true, paidAt: true, calculatedAt: true },
    });
    const tableTotal = all
      .filter((c) => {
        const d = c.validatedAt ?? c.paidAt ?? c.calculatedAt;
        return d >= startOfMonth && d <= endOfMonth;
      })
      .reduce((s, c) => s + c.amount, 0);
    if (Math.abs(serverTotal - tableTotal) > 0.01) {
      bad(`${u.firstName} ${u.lastName} : header ${serverTotal}€ ≠ tableau ${tableTotal}€`);
    } else {
      sumOk++;
    }
  }
  if (sumOk === users.length) ok(`${sumOk}/${users.length} utilisateurs : header = tableau`);

  // ── 10. Missions : une commission par consultant placé et par mois ────────
  section('10. Missions actives sans commission du mois en cours');
  const periodMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const activeMissions = await prisma.mission.findMany({
    where: { status: 'ACTIVE', userId: { not: null }, startDate: { lt: new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)) } },
    select: { id: true, tenantId: true, userId: true, dealId: true, monthlyAmount: true },
  });
  let missionOk = 0;
  const missionsMissing: string[] = [];
  for (const m of activeMissions) {
    const count = await prisma.commission.count({
      where: { missionId: m.id, periodMonth },
    });
    // 0 commission est légitime si aucune règle MISSION_MONTH n'est assignée au commercial
    const hasRecurringRule = (await prisma.ruleAssignment.findMany({
      where: { tenantId: m.tenantId, isActive: true },
      include: { rule: { select: { config: true } } },
    })).some((a) => {
      const cfg = a.rule.config as unknown as CommissionRuleConfig;
      return cfg.appliesToEventType === 'MISSION_MONTH';
    });
    if (count > 0 || !hasRecurringRule) missionOk++;
    else missionsMissing.push(m.id);
  }
  if (missionsMissing.length === 0) ok(`${activeMissions.length} missions actives cohérentes pour le mois en cours`);
  for (const id of missionsMissing) bad(`Mission ${id} : active, règle récurrente présente, mais aucune commission ce mois-ci`);

  // ── Bilan ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  if (anomalies === 0) console.log('BILAN : ✅ 0 anomalie détectée sur les 10 invariants.');
  else console.log(`BILAN : ❌ ${anomalies} anomalie(s) détectée(s).`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
