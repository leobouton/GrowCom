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

  /**
   * Events mensuels de mission d'un commercial dont la commission a été VALIDÉE
   * par le N+1 (ou payée). Règle métier : un mois de mission n'alimente les
   * objectifs de CA/marge qu'après validation, comme les ventes one-shot.
   */
  async findMissionMonthsByUserId(userId: string, tenantId: string): Promise<CommissionableEvent[]> {
    return prisma.commissionableEvent.findMany({
      where: {
        tenantId,
        userId,
        type: 'MISSION_MONTH',
        commissions: { some: { userId, status: { in: ['VALIDATED', 'PAID'] } } },
      },
      orderBy: { periodMonth: 'desc' },
    });
  },
};
