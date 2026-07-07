import { prisma } from '../config/prisma';
import { commissionService } from './commission.service';
import { generateMissionMonth, getPeriodMonth, isMissionDueForPeriod } from './missionRecurrence.service';

/**
 * Recalcule immédiatement les commissions d'un membre après un changement
 * de plan ou d'assignation (ajustement, retrait, ajout de règle, mise à jour
 * d'un plan de commissions) : deals WON + mois de mission en cours.
 * Un deal en erreur ne bloque pas les autres.
 */
export async function recalculateForUser(userId: string, tenantId: string): Promise<void> {
  const deals = await prisma.deal.findMany({
    where: {
      tenantId,
      status: 'WON',
      OR: [
        { assignedToId: userId },
        { assignments: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  for (const deal of deals) {
    try {
      await commissionService.recalculateForDeal(deal.id, tenantId);
    } catch {
      // un deal en erreur ne doit pas bloquer les autres
    }
  }
  const missions = await prisma.mission.findMany({
    where: { tenantId, userId, status: 'ACTIVE' },
  });
  const periodMonth = getPeriodMonth();
  for (const mission of missions) {
    if (isMissionDueForPeriod(mission, periodMonth)) {
      await generateMissionMonth(mission, periodMonth);
    }
  }
}
