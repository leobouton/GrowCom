import { CommissionAdjustment, CommissionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateAdjustmentData {
  tenantId: string;
  userId: string;
  originalCommissionId?: string;
  amount: number;
  reason: string;
  createdBy: string;
  autoPaid?: boolean; // Si true, crée directement en PAID (ex: primes d'objectifs automatiques)
}

export const commissionAdjustmentRepository = {
  async create(data: CreateAdjustmentData): Promise<CommissionAdjustment> {
    return prisma.commissionAdjustment.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        originalCommissionId: data.originalCommissionId ?? null,
        amount: data.amount,
        reason: data.reason,
        createdBy: data.createdBy,
        status: data.autoPaid ? CommissionStatus.PAID : CommissionStatus.VALIDATED,
        paidAt: data.autoPaid ? new Date() : null,
      },
    });
  },

  async findByUserId(userId: string, tenantId: string): Promise<CommissionAdjustment[]> {
    return prisma.commissionAdjustment.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async sumByUserAndPeriod(
    userId: string,
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    const result = await prisma.commissionAdjustment.aggregate({
      where: {
        userId,
        tenantId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  },

  async sumByTenantAndPeriod(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    const result = await prisma.commissionAdjustment.aggregate({
      where: {
        tenantId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  },

  async markPaid(id: string, tenantId: string): Promise<CommissionAdjustment> {
    return prisma.commissionAdjustment.update({
      where: { id, tenantId },
      data: { status: CommissionStatus.PAID, paidAt: new Date() },
    });
  },

  async findByUserInPeriod(
    userId: string,
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<CommissionAdjustment[]> {
    return prisma.commissionAdjustment.findMany({
      where: {
        userId,
        tenantId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Ajustements éligibles à la paie d'une période : non encore payés (paidAt null)
   * et créés dans la période. Inclut clawbacks (négatifs) et bonus exceptionnels.
   */
  async findUnpaidByUserIdsInPeriod(
    userIds: string[],
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<CommissionAdjustment[]> {
    if (userIds.length === 0) return [];
    return prisma.commissionAdjustment.findMany({
      where: {
        userId: { in: userIds },
        tenantId,
        paidAt: null,
        createdAt: { gte: periodStart, lte: periodEnd },
        // Exclut les primes d'objectifs auto-générées (déjà comptées via ObjectiveSnapshot),
        // pour éviter un double comptage.
        NOT: { createdBy: 'SYSTEM', reason: { startsWith: 'Prime objectif' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};
