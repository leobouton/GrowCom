import { CommissionableEvent } from '@prisma/client';
import { prisma } from '../config/prisma';

export const commissionableEventRepository = {
  /**
   * Upsert idempotent de l'event mensuel d'une mission.
   * Clé unique (missionId, periodMonth) → jamais deux events pour le même (mission, mois).
   */
  async upsertMissionMonth(params: {
    tenantId: string;
    missionId: string;
    dealId: string;
    userId: string;
    periodMonth: Date;
    amount: number;
    marginAmount?: number | null;
    unitCount?: number | null;
    marginSource?: string | null;
  }): Promise<CommissionableEvent> {
    const { tenantId, missionId, dealId, userId, periodMonth, amount, marginAmount, unitCount, marginSource } = params;
    return prisma.commissionableEvent.upsert({
      where: { missionId_periodMonth: { missionId, periodMonth } },
      update: {
        dealId,
        userId,
        amount,
        marginAmount: marginAmount ?? null,
        unitCount: unitCount ?? null,
        marginSource: marginSource ?? null,
      },
      create: {
        tenantId,
        type: 'MISSION_MONTH',
        missionId,
        dealId,
        userId,
        periodMonth,
        amount,
        marginAmount: marginAmount ?? null,
        unitCount: unitCount ?? null,
        marginSource: marginSource ?? null,
        occurredAt: periodMonth,
      },
    });
  },
};
