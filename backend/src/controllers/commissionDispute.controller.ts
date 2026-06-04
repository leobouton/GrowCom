import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { commissionDisputeService } from '../services/commissionDispute.service';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole, DisputeStatus } from '../../../shared/types';

const raiseDisputeSchema = z.object({
  reason: z.string().min(10).max(1000),
});

const resolveDisputeSchema = z.object({
  action: z.enum(['accept', 'reject']),
  response: z.string().min(1).max(1000),
  dealUpdates: z.object({
    title: z.string().optional(),
    clientName: z.string().nullable().optional(),
    amount: z.number().optional(),
    dealType: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    costAmount: z.number().nullable().optional(),
    marginAmount: z.number().nullable().optional(),
  }).optional(),
  commissionOverride: z.number().nullable().optional(),
});

export const commissionDisputeController = {
  async raise(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { commissionId } = req.params;
      const { reason } = raiseDisputeSchema.parse(req.body);

      const dispute = await commissionDisputeService.raise(
        commissionId,
        user.tenantId!,
        user.userId,
        reason,
      );
      res.status(201).json({ success: true, data: dispute });
    } catch (err) {
      next(err);
    }
  },

  async resolve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const { action, response, dealUpdates, commissionOverride } = resolveDisputeSchema.parse(req.body);

      const dispute = await commissionDisputeService.resolve(
        id,
        user.tenantId!,
        user.userId,
        user.role as UserRole,
        action,
        response,
        dealUpdates,
        commissionOverride,
      );
      res.json({ success: true, data: dispute });
    } catch (err) {
      next(err);
    }
  },

  async listByCommission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { commissionId } = req.params;

      const disputes = await commissionDisputeService.listByCommission(
        commissionId,
        user.tenantId!,
      );
      res.json({ success: true, data: disputes });
    } catch (err) {
      next(err);
    }
  },

  async listByTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { status } = req.query;

      const disputes = await commissionDisputeService.listByTenant(
        user.tenantId!,
        user.userId,
        user.role as UserRole,
        status ? { status: status as DisputeStatus } : undefined,
      );
      res.json({ success: true, data: disputes });
    } catch (err) {
      next(err);
    }
  },
};
