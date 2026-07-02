import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ruleAssignmentRepository } from '../repositories/ruleAssignment.repository';
import { commissionRuleRepository } from '../repositories/commissionRule.repository';
import { commissionService } from '../services/commission.service';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AssigneeType, UserRole } from '../../../shared/types';

// Paramètres surchargeables par assignation (template + override).
const overridesSchema = z
  .object({
    rate: z.number().min(0).max(1).optional(),
    fixedAmount: z.number().min(0).optional(),
    cap: z.number().min(0).optional(),
    floor: z.number().min(0).optional(),
    tiers: z
      .array(z.object({ min: z.number().min(0), max: z.number().nullable(), rate: z.number().min(0).max(1) }))
      .optional(),
  })
  .strict()
  .optional()
  .nullable();

const assignSchema = z.object({
  ruleId: z.string().min(1, 'La règle est requise'),
  assignedToType: z.nativeEnum(AssigneeType),
  userId: z.string().optional().nullable(),
  teamName: z.string().max(100).optional().nullable(),
  overrides: overridesSchema,
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional().nullable(),
});

export const ruleAssignmentController = {
  async getForUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { userId } = req.params;

      // TEAM_LEAD : vérifier que le commercial appartient à son équipe
      await commissionService.assertUserInScope(userId, user.userId, user.role as UserRole, user.tenantId!);

      const assignments = await ruleAssignmentRepository.findByUserId(userId, user.tenantId!);
      res.json({ success: true, data: assignments });
    } catch (err) {
      next(err);
    }
  },

  async assign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { ruleId, assignedToType, userId, teamName, overrides, startDate, endDate } = assignSchema.parse(req.body);

      const rule = await commissionRuleRepository.findById(ruleId, user.tenantId!);
      if (!rule) throw new AppError(404, 'RULE_NOT_FOUND', 'Règle introuvable');
      if (rule.isArchived) throw new AppError(400, 'RULE_ARCHIVED', 'Impossible d\'assigner une règle archivée');

      if (assignedToType === AssigneeType.INDIVIDUAL && !userId) {
        throw new AppError(400, 'MISSING_USER', 'L\'identifiant du commercial est requis pour une assignation individuelle');
      }
      if (assignedToType === AssigneeType.TEAM && !teamName) {
        throw new AppError(400, 'MISSING_TEAM', 'Le nom de l\'équipe est requis pour une assignation d\'équipe');
      }

      // TEAM_LEAD : vérifier que le commercial cible appartient à son équipe
      if (assignedToType === AssigneeType.INDIVIDUAL && userId) {
        await commissionService.assertUserInScope(userId, user.userId, user.role as UserRole, user.tenantId!);
      }

      const assignment = await ruleAssignmentRepository.assign({
        tenantId: user.tenantId!,
        ruleId,
        assignedToType,
        userId: userId ?? null,
        teamName: teamName ?? null,
        overrides: overrides ?? null,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
      });

      res.status(201).json({ success: true, data: assignment });
    } catch (err) {
      next(err);
    }
  },

  async deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const assignment = await ruleAssignmentRepository.findById(id, user.tenantId!);
      if (!assignment) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignation introuvable');

      // TEAM_LEAD : vérifier que l'assignation concerne un membre de son équipe
      if (assignment.userId) {
        await commissionService.assertUserInScope(assignment.userId, user.userId, user.role as UserRole, user.tenantId!);
      }

      const updated = await ruleAssignmentRepository.deactivate(id, user.tenantId!);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
};
