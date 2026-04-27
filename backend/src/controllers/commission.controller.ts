import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { commissionService } from '../services/commission.service';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const updateStatusSchema = z.object({
  action: z.enum(['validate', 'pay']),
});

export const commissionController = {
  async getManagerStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;

      let startDate: Date | undefined;
      let endDate: Date | undefined;

      const { period, year, month } = req.query;

      if (period === 'month' && year && month) {
        const y = parseInt(year as string, 10);
        const m = parseInt(month as string, 10) - 1; // 0-indexed
        startDate = new Date(y, m, 1);
        endDate = new Date(y, m + 1, 0, 23, 59, 59);
      } else if (period === 'year' && year) {
        const y = parseInt(year as string, 10);
        startDate = new Date(y, 0, 1);
        endDate = new Date(y, 11, 31, 23, 59, 59);
      }

      const stats = await commissionService.getManagerStats(
        user.tenantId!,
        user.userId,
        user.role as UserRole,
        startDate,
        endDate,
      );
      res.json({ success: true, data: stats });
    } catch (err) {
      next(err);
    }
  },

  async getCommercialStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const stats = await commissionService.getCommercialStats(user.userId, user.tenantId!);
      res.json({ success: true, data: stats });
    } catch (err) {
      next(err);
    }
  },

  async getPending(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      // Réutilise getManagerStats pour obtenir uniquement les commissions en attente du périmètre du demandeur
      const { pendingCommissions: commissions } = await commissionService.getManagerStats(
        user.tenantId!,
        user.userId,
        user.role as UserRole,
      );
      res.json({ success: true, data: commissions });
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { action } = updateStatusSchema.parse(req.body);

      let commission;
      if (action === 'validate') {
        commission = await commissionService.validate(id, user.tenantId!, user.userId, user.role as UserRole);
      } else {
        commission = await commissionService.markAsPaid(id, user.tenantId!, user.userId, user.role as UserRole);
      }

      res.json({ success: true, data: commission });
    } catch (err) {
      next(err);
    }
  },

  async getMyCommissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;

      // Un commercial ne peut voir que ses propres commissions
      // Les rôles manager peuvent voir celles d'un commercial spécifique via ?userId=
      const managerRoles: UserRole[] = [UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD];
      let targetUserId = user.userId;
      if (managerRoles.includes(user.role as UserRole) && req.query['userId']) {
        targetUserId = req.query['userId'] as string;
        // Vérification de périmètre (lance 403 si TEAM_LEAD hors équipe)
        await commissionService.assertUserInScope(targetUserId, user.userId, user.role as UserRole, user.tenantId!);
      }

      const commissions = await commissionService.getByUserId(targetUserId, user.tenantId!);
      res.json({ success: true, data: commissions });
    } catch (err) {
      next(err);
    }
  },
};
