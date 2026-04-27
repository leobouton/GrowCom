import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { commissionRuleRepository } from '../repositories/commissionRule.repository';
import { ruleAssignmentRepository } from '../repositories/ruleAssignment.repository';
import { commissionAIService } from '../integrations/ai.service';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';
import { CommissionRuleType, RuleScope } from '../../../shared/types';

const generateRuleSchema = z.object({
  description: z
    .string()
    .min(10, 'La description doit faire au moins 10 caractères')
    .max(1000, 'La description ne peut pas dépasser 1000 caractères'),
  name: z.string().min(1, 'Le nom est requis').max(100),
  dealType: z.string().max(50).optional().nullable(),
  scope: z.nativeEnum(RuleScope).optional(),
});

export const commissionRuleController = {
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const isArchived = req.query.archived === 'true' ? true : req.query.archived === 'false' ? false : undefined;
      const rules = await commissionRuleRepository.findByTenantId(user.tenantId!, { isArchived });

      const rulesWithCount = await Promise.all(
        rules.map(async (rule) => ({
          ...rule,
          assignmentCount: await ruleAssignmentRepository.countActiveForRule(rule.id),
        })),
      );

      res.json({ success: true, data: rulesWithCount });
    } catch (err) {
      next(err);
    }
  },

  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { description, name, dealType, scope } = generateRuleSchema.parse(req.body);

      const generatedConfig = await commissionAIService.generateRule(description);

      const rule = await commissionRuleRepository.create({
        tenantId: user.tenantId!,
        name,
        description,
        type: generatedConfig.type as CommissionRuleType,
        config: generatedConfig,
        createdBy: user.userId,
        dealType: dealType ?? null,
        scope: scope ?? RuleScope.GLOBAL,
      });

      await auditLogRepository.create({
        tenantId: user.tenantId!,
        userId: user.userId,
        action: 'CREATE_COMMISSION_RULE',
        entity: 'CommissionRule',
        entityId: rule.id,
        metadata: { name, type: generatedConfig.type },
      });

      res.status(201).json({ success: true, data: rule });
    } catch (err) {
      next(err);
    }
  },

  async archive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const rule = await commissionRuleRepository.findById(id);
      if (!rule) throw new AppError(404, 'RULE_NOT_FOUND', 'Règle introuvable');
      if (rule.tenantId !== user.tenantId) throw new AppError(403, 'FORBIDDEN', 'Accès refusé');

      const archived = await commissionRuleRepository.archive(id, user.tenantId!);

      await auditLogRepository.create({
        tenantId: user.tenantId!,
        userId: user.userId,
        action: 'ARCHIVE_COMMISSION_RULE',
        entity: 'CommissionRule',
        entityId: id,
        metadata: { name: rule.name },
      });

      res.json({ success: true, data: archived });
    } catch (err) {
      next(err);
    }
  },

  async unarchive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const rule = await commissionRuleRepository.findById(id);
      if (!rule) throw new AppError(404, 'RULE_NOT_FOUND', 'Règle introuvable');
      if (rule.tenantId !== user.tenantId) throw new AppError(403, 'FORBIDDEN', 'Accès refusé');

      const unarchived = await commissionRuleRepository.unarchive(id, user.tenantId!);
      res.json({ success: true, data: unarchived });
    } catch (err) {
      next(err);
    }
  },
};
