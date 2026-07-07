/**
 * Impact de la décision « marge inconnue = commission à 0 » (Léo, 2026-07-06).
 * Liste les commissions actuelles calculées par une règle MARGIN sur un deal ou
 * une mission SANS marge connue, puis recalcule les PENDING (deals) et le mois
 * en cours (missions). Les commissions déjà VALIDATED/PAID sur des deals ne sont
 * jamais retouchées.
 */
import { prisma } from '../src/config/prisma';
import { commissionService } from '../src/services/commission.service';
import { generateRecurringMissionCommissions } from '../src/services/missionRecurrence.service';
import type { CommissionRuleConfig } from '../../shared/types';

async function main() {
  const commissions = await prisma.commission.findMany({
    where: { status: { in: ['PENDING', 'VALIDATED'] } },
    include: {
      rule: { select: { name: true, config: true } },
      deal: { select: { id: true, title: true, marginAmount: true, costAmount: true } },
      mission: { select: { id: true, marginAmount: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  const affected = commissions.filter((c) => {
    const cfg = c.rule.config as unknown as CommissionRuleConfig;
    if (cfg?.calculationBasis !== 'MARGIN') return false;
    const source = c.missionId ? c.mission : c.deal;
    const marginKnown = source?.marginAmount != null
      || (!c.missionId && c.deal.costAmount != null);
    return !marginKnown && c.amount !== 0;
  });

  console.log(`Commissions concernées (règle % marge, marge inconnue, montant ≠ 0) : ${affected.length}`);
  for (const c of affected) {
    console.log(
      `  ${c.user.firstName} ${c.user.lastName} | ${c.deal.title} | ${c.amount}€ | ${c.status}` +
      ` | ${c.missionId ? 'MISSION' : 'DEAL'} | règle « ${c.rule.name} »`,
    );
  }

  if (affected.length === 0) {
    console.log('Rien à recalculer.');
    return;
  }

  // Recalcul des deals concernés (ne touche que les PENDING, par construction)
  const dealIds = [...new Set(affected.filter((c) => !c.missionId && c.status === 'PENDING').map((c) => c.dealId))];
  for (const dealId of dealIds) {
    const c = affected.find((x) => x.dealId === dealId)!;
    await commissionService.recalculateForDeal(dealId, c.tenantId);
    console.log(`  → deal ${dealId} recalculé`);
  }

  // Régénération du mois en cours pour les missions (l'upsert met à jour le montant)
  if (affected.some((c) => c.missionId)) {
    await generateRecurringMissionCommissions(new Date());
    console.log('  → commissions de mission du mois régénérées');
  }

  const skipped = affected.filter((c) => !c.missionId && c.status !== 'PENDING');
  if (skipped.length > 0) {
    console.log(`\n⚠️ ${skipped.length} commission(s) deal déjà VALIDÉES non retouchées (décision manager conservée) :`);
    for (const c of skipped) console.log(`  ${c.user.firstName} | ${c.deal.title} | ${c.amount}€`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
