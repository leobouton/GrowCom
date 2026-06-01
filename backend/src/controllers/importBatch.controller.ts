import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';
import { importBatchService } from '../services/importBatch.service';
import { UserRole } from '../../../shared/types';

const CancelBodySchema = z.object({
  reason: z.string()
    .trim()
    .min(10, 'Le motif doit contenir au moins 10 caractères')
    .max(500, 'Le motif ne peut pas dépasser 500 caractères'),
});

export const importBatchController = {
  /**
   * GET /api/imports
   * Liste les imports du tenant (paginé).
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user.tenantId) throw new AppError(403, 'TENANT_REQUIRED', 'Tenant requis');

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

      const result = await importBatchService.list(user.tenantId, page, limit);

      res.json({
        success: true,
        data: {
          batches: result.batches,
          total: result.total,
          page,
          limit,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/imports/:id
   * Détail d'un import avec ses deals.
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user.tenantId) throw new AppError(403, 'TENANT_REQUIRED', 'Tenant requis');

      const batch = await importBatchService.getById(req.params.id, user.tenantId);

      res.json({ success: true, data: batch });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/imports/:id/cancel-preview
   * Aperçu de l'impact d'une annulation (sans rien modifier).
   */
  async cancelPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user.tenantId) throw new AppError(403, 'TENANT_REQUIRED', 'Tenant requis');

      const preview = await importBatchService.cancelPreview(req.params.id, user.tenantId);

      res.json({ success: true, data: preview });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/imports/:id/cancel
   * Annule un import.
   */
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user.tenantId) throw new AppError(403, 'TENANT_REQUIRED', 'Tenant requis');

      const parsed = CancelBodySchema.safeParse(req.body);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => i.message).join(', ');
        throw new AppError(400, 'VALIDATION_ERROR', msg);
      }

      const result = await importBatchService.cancelImport({
        batchId: req.params.id,
        tenantId: user.tenantId,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        reason: parsed.data.reason,
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
};
