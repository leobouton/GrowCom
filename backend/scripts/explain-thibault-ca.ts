/**
 * Diagnostic — décompose le CA « objectif juillet » de Thibault :
 * quels deals et quels mois de mission contribuent, avec quelles dates.
 * Reproduit exactement le périmètre du moteur (objectiveProgress.service).
 */
import { prisma } from '../src/config/prisma';
import { dealRepository } from '../src/repositories/deal.repository';
import { commissionableEventRepository } from '../src/repositories/commissionableEvent.repository';
import { computeObjectiveActual } from '../src/services/objectiveProgress.service';
import type { Objective } from '../../shared/types';

async function main() {
  const user = await prisma.user.findFirst({
    where: { firstName: { contains: 'Thibau', mode: 'insensitive' } },
    select: { id: true, tenantId: true, firstName: true, lastName: true, objectives: true },
  });
  if (!user) throw new Error('Thibault introuvable');

  console.log(`\n── Objectifs configurés pour ${user.firstName} ──`);
  const objectives = (user.objectives as unknown as Objective[]) ?? [];
  for (const o of objectives) {
    console.log(`  ${o.label} | unit=${o.unit} | ${o.periodType} ${o.month ?? ''}/${o.year ?? ''} | cible=${o.target}`);
  }

  // Périmètre moteur : deals WON à commission VALIDATED/PAID, avec part
  const wonDeals = await dealRepository.findWonForObjectives(user.id, user.tenantId);
  console.log(`\n── Deals WON éligibles (commission validée/payée) : ${wonDeals.length} ──`);
  for (const d of wonDeals) {
    console.log(
      `  ${d.title} | CA ${d.amount}€ × part ${d.userShare}` +
      ` | signé ${d.closedAt?.toISOString().slice(0, 10) ?? 'null'}`,
    );
  }

  // Mois de mission éligibles (events à commission VALIDATED/PAID)
  const missionMonths = await commissionableEventRepository.findMissionMonthsByUserId(user.id, user.tenantId);
  console.log(`\n── Mois de mission éligibles : ${missionMonths.length} ──`);
  for (const m of missionMonths) {
    console.log(
      `  mission ${m.missionId} | CA mensuel ${m.amount}€ | marge ${m.marginAmount ?? 'null'}` +
      ` | mois ${m.periodMonth?.toISOString().slice(0, 10) ?? 'null'}`,
    );
  }

  // Reconstruction de l'objectif CA juillet 2026 (comme le dashboard)
  const julyCA: Objective = {
    id: 'diag', label: 'CA juillet (diagnostic)', unit: '€',
    periodType: 'monthly', month: 7, year: 2026, target: 1,
  };
  const wonDealsInput = wonDeals.map((d) => ({
    amount: d.amount,
    marginAmount: d.marginAmount,
    costAmount: d.costAmount,
    userShare: d.userShare,
    closedAt: d.closedAt,
    syncedAt: d.syncedAt,
  }));
  const missionInput = missionMonths.map((m) => ({
    amount: m.amount,
    marginAmount: m.marginAmount,
    periodMonth: m.periodMonth,
  }));
  const total = computeObjectiveActual(julyCA, wonDealsInput, missionInput);

  // Détail juillet uniquement
  const inJuly = (d: Date | null) => d && d >= new Date(2026, 6, 1) && d <= new Date(2026, 6, 31, 23, 59, 59);
  console.log('\n── Contributions au CA de JUILLET 2026 ──');
  let sum = 0;
  for (const d of wonDeals) {
    if (inJuly(d.closedAt ?? d.syncedAt)) {
      const contrib = d.amount * d.userShare;
      sum += contrib;
      console.log(`  DEAL   | ${d.title} | ${d.amount}€ × ${d.userShare} = ${contrib}€ (signé ${d.closedAt?.toISOString().slice(0, 10)})`);
    }
  }
  for (const m of missionMonths) {
    if (m.periodMonth && m.periodMonth.getUTCFullYear() === 2026 && m.periodMonth.getUTCMonth() === 6) {
      sum += m.amount;
      console.log(`  MISSION| ${m.missionId} | CA mensuel juillet = ${m.amount}€`);
    }
  }
  console.log(`\nTOTAL CA juillet (moteur) : ${total}€ — somme des contributions listées : ${sum}€`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
