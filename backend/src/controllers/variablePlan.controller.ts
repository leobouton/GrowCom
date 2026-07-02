import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { variablePlanRepository } from '../repositories/variablePlan.repository';
import { commissionAIService } from '../integrations/ai.service';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';

const generatePlanSchema = z.object({
  description: z
    .string()
    .min(10, 'La description doit faire au moins 10 caractères')
    .max(2000, 'La description ne peut pas dépasser 2000 caractères'),
});

export const variablePlanController = {
  /** Liste les plans de variable du tenant (avec leurs composants). */
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const plans = await variablePlanRepository.findByTenantId(user.tenantId!);
      res.json({ success: true, data: plans });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const plan = await variablePlanRepository.findById(req.params.id, user.tenantId!);
      if (!plan) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan de variable introuvable');
      res.json({ success: true, data: plan });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Génère un BROUILLON de plan multi-composants via l'IA (non persisté).
   * Destiné au futur wizard de saisie unifiée qui décidera de la persistance.
   */
  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { description } = generatePlanSchema.parse(req.body);
      const draft = await commissionAIService.generatePlan(description);
      res.json({ success: true, data: draft });
    } catch (err) {
      next(err);
    }
  },
};
