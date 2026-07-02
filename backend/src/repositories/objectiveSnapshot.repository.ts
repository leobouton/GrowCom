import { ObjectiveSnapshot, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateSnapshotData {
  tenantId: string;
  userId: string;
  objectiveId: string;
  periodLabel: string;
  snapshotData: Record<string, unknown>;
  actualValue: number;
  bonusEarned: number;
}

export const objectiveSnapshotRepository = {
  async create(data: CreateSnapshotData): Promise<ObjectiveSnapshot> {
    return prisma.objectiveSnapshot.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        objectiveId: data.objectiveId,
        periodLabel: data.periodLabel,
        snapshotData: data.snapshotData as Prisma.InputJsonValue,
        actualValue: data.actualValue,
        bonusEarned: data.bonusEarned,
      },
    });
  },

  async findByUserId(userId: string, tenantId: string, limit = 24): Promise<ObjectiveSnapshot[]> {
    return prisma.objectiveSnapshot.findMany({
      where: { userId, tenantId },
      orderBy: { snapshotAt: 'desc' },
      take: limit,
    });
  },

  async findByUserAndPeriod(
    userId: string,
    tenantId: string,
    objectiveId: string,
    periodLabel: string,
  ): Promise<ObjectiveSnapshot | null> {
    return prisma.objectiveSnapshot.findFirst({
      where: { userId, tenantId, objectiveId, periodLabel },
      orderBy: { snapshotAt: 'desc' },
    });
  },

  async existsForPeriod(
    userId: string,
    tenantId: string,
    objectiveId: string,
    periodLabel: string,
  ): Promise<boolean> {
    const count = await prisma.objectiveSnapshot.count({
      where: { userId, tenantId, objectiveId, periodLabel },
    });
    return count > 0;
  },

  /**
   * Snapshots d'objectifs dont la date (snapshotAt) tombe dans la période,
   * pour sommer les primes d'objectifs (bonusEarned) par commercial.
   */
  async findByUserIdsInPeriod(
    userIds: string[],
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Pick<ObjectiveSnapshot, 'userId' | 'bonusEarned' | 'periodLabel'>[]> {
    if (userIds.length === 0) return [];
    return prisma.objectiveSnapshot.findMany({
      where: {
        userId: { in: userIds },
        tenantId,
        snapshotAt: { gte: periodStart, lte: periodEnd },
      },
      select: { userId: true, bonusEarned: true, periodLabel: true },
    });
  },
};
