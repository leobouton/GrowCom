import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { dealAssignmentRepository } from '../repositories/dealAssignment.repository';
import { dealRepository } from '../repositories/deal.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { commissionService } from '../services/commission.service';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const putAssignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        userId: z.string().min(1, 'userId est requis'),
        share: z
          .number()
          .min(0.001, 'La part doit être supérieure à 0')
          .max(1.0, 'La part ne peut pas dépasser 100%'),
        role: z.string().max(100).optional().nullable(),
      }),
    )
    .min(1, 'Au moins une assignation est requise'),
});

export const dealAssignmentController = {
  /**
   * GET /api/deals/:dealId/assignments
   * Accessible à MANAGER, BU_MANAGER, TEAM_LEAD et au commercial concerné.
   */
  async getAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { dealId } = req.params;

      const deal = await dealRepository.findById(dealId, user.tenantId!);
      if (!deal) throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal introuvable');

      // Un commercial ne peut voir que les deals qui le concernent
      if (
        user.role === UserRole.COMMERCIAL &&
        deal.assignedToId !== user.userId
      ) {
        // Vérifier si ce commercial est dans les assignments du deal
        const assignments = await dealAssignmentRepository.findByDealId(dealId, user.tenantId!);
        const isInvolved = assignments.some((a) => a.userId === user.userId);
        if (!isInvolved) throw new AppError(403, 'FORBIDDEN', 'Accès refusé');
      }

      const assignments = await dealAssignmentRepository.findByDealId(dealId, user.tenantId!);
      res.json({ success: true, data: assignments });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PUT /api/deals/:dealId/assignments
   * Remplacement complet. MANAGER et BU_MANAGER uniquement.
   */
  async putAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { dealId } = req.params;

      const deal = await dealRepository.findById(dealId, user.tenantId!);
      if (!deal) throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal introuvable');

      const { assignments } = putAssignmentsSchema.parse(req.body);

      const updated = await dealAssignmentRepository.upsertForDeal(
        dealId,
        user.tenantId!,
        assignments,
      );

      await auditLogRepository.create({
        tenantId: user.tenantId!,
        userId: user.userId,
        action: 'UPDATE_DEAL_ASSIGNMENTS',
        entity: 'DealAssignment',
        entityId: dealId,
        metadata: {
          assignments: assignments.map((a) => ({
            userId: a.userId,
            share: a.share,
            role: a.role ?? null,
          })),
        },
      });

      // Recalculer les commissions si le deal est WON
      if (deal.status === 'WON') {
        try {
          await commissionService.recalculateForDeal(dealId, user.tenantId!);
        } catch (commErr) {
          // Non bloquant : les assignations sont sauvées, on log l'erreur de calcul
          console.warn('Recalcul commission après modification assignations', commErr);
        }
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
};
