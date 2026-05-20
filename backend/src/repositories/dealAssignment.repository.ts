import { DealAssignment } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';

export interface DealAssignmentWithUser extends DealAssignment {
  user: { firstName: string; lastName: string; email: string };
}

export interface AssignmentInput {
  userId: string;
  share: number;
  role?: string | null;
}

export const dealAssignmentRepository = {
  async findByDealId(dealId: string, tenantId: string): Promise<DealAssignmentWithUser[]> {
    return prisma.dealAssignment.findMany({
      where: { dealId, tenantId },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { share: 'desc' },
    });
  },

  async findByUserId(userId: string, tenantId: string): Promise<DealAssignment[]> {
    return prisma.dealAssignment.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Remplace TOUTES les assignations existantes du deal en une transaction atomique.
   * Valide que la somme des shares vaut exactement 1.0 (tolérance ±0.001).
   */
  async upsertForDeal(
    dealId: string,
    tenantId: string,
    assignments: AssignmentInput[],
  ): Promise<DealAssignmentWithUser[]> {
    if (assignments.length === 0) {
      throw new AppError(400, 'INVALID_ASSIGNMENTS', 'Au moins une assignation est requise');
    }

    const total = assignments.reduce((sum, a) => sum + a.share, 0);
    if (Math.abs(total - 1.0) > 0.001) {
      throw new AppError(
        400,
        'INVALID_SHARE_SUM',
        `La somme des parts doit être égale à 100% (actuellement ${(total * 100).toFixed(1)}%)`,
      );
    }

    return prisma.$transaction(async (tx) => {
      // Supprimer toutes les assignations existantes du deal
      await tx.dealAssignment.deleteMany({ where: { dealId, tenantId } });

      // Créer les nouvelles assignations
      await tx.dealAssignment.createMany({
        data: assignments.map((a) => ({
          tenantId,
          dealId,
          userId: a.userId,
          share: a.share,
          role: a.role ?? null,
        })),
      });

      return tx.dealAssignment.findMany({
        where: { dealId, tenantId },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { share: 'desc' },
      });
    });
  },

  async removeForDeal(dealId: string, tenantId: string): Promise<void> {
    await prisma.dealAssignment.deleteMany({ where: { dealId, tenantId } });
  },
};
