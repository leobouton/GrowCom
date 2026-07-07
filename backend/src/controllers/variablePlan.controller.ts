import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '../config/prisma';
import { variablePlanRepository } from '../repositories/variablePlan.repository';
import { commissionRuleRepository } from '../repositories/commissionRule.repository';
import { ruleAssignmentRepository } from '../repositories/ruleAssignment.repository';
import { commissionAIService, generatedPlanSchema } from '../integrations/ai.service';
import { simulatePlan } from '../services/variablePlanSimulation.service';
import { recalculateForUser } from '../services/recalculation.service';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AssigneeType, RuleScope, CommissionRuleType, Objective } from '../../../shared/types';
import type { GeneratedPlanDraft } from '../../../shared/types';

const generatePlanSchemaBody = z.object({
  description: z
    .string()
    .min(10, 'La description doit faire au moins 10 caractères')
    .max(2000, 'La description ne peut pas dépasser 2000 caractères'),
  // Mode ÉDITION : plan courant + instruction → plan complet mis à jour
  currentPlan: generatedPlanSchema.optional(),
});

// Scénario de simulation — tous les champs ont un défaut raisonnable
const scenarioSchema = z.object({
  dealAmount: z.number().min(0).max(100_000_000).default(10000),
  dealMargin: z.number().min(0).max(100_000_000).nullable().default(null),
  missionMonthlyAmount: z.number().min(0).max(10_000_000).default(8000),
  missionMonthlyMargin: z.number().min(0).max(10_000_000).nullable().default(null),
  consultantCount: z.number().int().min(0).max(500).default(1),
  missionMonths: z.number().int().min(1).max(60).default(12),
  objectiveAchievementPct: z.number().min(0).max(500).default(100),
});

const simulateSchema = z.object({
  plan: generatedPlanSchema,
  scenario: scenarioSchema.default({}),
});

const savePlanSchema = z.object({
  plan: generatedPlanSchema,
  assignedUserIds: z.array(z.string().min(1)).max(200).default([]),
});

/** Complète les champs de période manquants d'un objectif avec la période courante. */
function withPeriodDefaults(objective: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  const o = { ...objective };
  if (o['year'] === undefined) o['year'] = now.getFullYear();
  if (o['periodType'] === 'monthly' && o['month'] === undefined) o['month'] = now.getMonth() + 1;
  if (o['periodType'] === 'quarterly' && o['quarter'] === undefined) o['quarter'] = Math.ceil((now.getMonth() + 1) / 3);
  if (o['periodType'] === 'semester' && o['semester'] === undefined) o['semester'] = now.getMonth() < 6 ? 1 : 2;
  return o;
}

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
   * Avec `currentPlan` : mode édition — instruction + plan courant → plan complet mis à jour.
   */
  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { description, currentPlan } = generatePlanSchemaBody.parse(req.body);
      const draft = await commissionAIService.generatePlan(description, currentPlan);
      res.json({ success: true, data: draft });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Simule un plan (brouillon ou édité) sur un scénario paramétrable.
   * RÈGLE ABSOLUE : le calcul passe par le moteur réel (jamais côté front).
   */
  async simulate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { plan, scenario } = simulateSchema.parse(req.body);
      const result = simulatePlan(plan as GeneratedPlanDraft, scenario);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Sauvegarde un plan validé par le manager :
   * - chaque composant COMMISSION_RULE devient une vraie CommissionRule ;
   * - le plan + ses composants sont persistés (VariablePlan / PlanComponent) ;
   * - si `assignedUserIds` est fourni : les règles sont assignées à chaque membre
   *   et les objectifs ajoutés à leur User.objectives (source de vérité).
   */
  async save(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenantId = user.tenantId!;
      const { plan, assignedUserIds } = savePlanSchema.parse(req.body);

      // Vérifier que les membres ciblés appartiennent bien au tenant
      const targetUsers = assignedUserIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: assignedUserIds }, tenantId, isActive: true },
            select: { id: true, objectives: true },
          })
        : [];
      if (targetUsers.length !== assignedUserIds.length) {
        throw new AppError(400, 'INVALID_ASSIGNEES', 'Un ou plusieurs membres sont introuvables dans votre entreprise');
      }

      // 1. Créer les règles de commission réelles pour les composants COMMISSION_RULE
      const componentsToCreate: Array<{
        kind: 'COMMISSION_RULE' | 'OBJECTIVE';
        ruleId: string | null;
        objectiveConfig: Record<string, unknown> | null;
        appliesToEventType: 'DEAL_WON' | 'MISSION_MONTH';
        sortOrder: number;
      }> = [];
      const createdRuleIds: string[] = [];
      const objectiveConfigs: Array<Record<string, unknown>> = [];

      for (let i = 0; i < plan.components.length; i++) {
        const component = plan.components[i];
        if (component.kind === 'COMMISSION_RULE') {
          const rule = await commissionRuleRepository.create({
            tenantId,
            name: component.name,
            description: component.config.description,
            type: component.config.type as CommissionRuleType,
            config: component.config,
            createdBy: user.userId,
            dealType: null,
            scope: RuleScope.GLOBAL,
            paymentDelayDays: null,
          });
          createdRuleIds.push(rule.id);
          componentsToCreate.push({
            kind: 'COMMISSION_RULE',
            ruleId: rule.id,
            objectiveConfig: null,
            appliesToEventType: component.config.appliesToEventType === 'MISSION_MONTH' ? 'MISSION_MONTH' : 'DEAL_WON',
            sortOrder: i,
          });
        } else {
          const objectiveConfig = withPeriodDefaults(component.objective as unknown as Record<string, unknown>);
          objectiveConfigs.push(objectiveConfig);
          componentsToCreate.push({
            kind: 'OBJECTIVE',
            ruleId: null,
            objectiveConfig,
            appliesToEventType: 'DEAL_WON',
            sortOrder: i,
          });
        }
      }

      // 2. Persister le plan et ses composants
      const savedPlan = await variablePlanRepository.create({
        tenantId,
        name: plan.name,
        description: plan.description,
        createdBy: user.userId,
        components: componentsToCreate,
      });

      // 3. Assignation simple : règles + objectifs pour chaque membre ciblé
      for (const target of targetUsers) {
        for (const ruleId of createdRuleIds) {
          await ruleAssignmentRepository.assign({
            tenantId,
            ruleId,
            assignedToType: AssigneeType.INDIVIDUAL,
            userId: target.id,
            overrides: null,
          });
        }
        if (objectiveConfigs.length > 0) {
          const existing = Array.isArray(target.objectives) ? (target.objectives as unknown as Objective[]) : [];
          const newObjectives = objectiveConfigs.map((o) => ({ ...o, id: randomUUID() }));
          await prisma.user.update({
            where: { id: target.id },
            data: { objectives: [...existing, ...newObjectives] as object[] },
          });
        }
        // Trace « ce membre est sur ce plan » (affichage dans la liste des plans)
        await variablePlanRepository.recordAssignment(savedPlan.id, tenantId, target.id);
      }

      // Recalcul immédiat : le plan doit produire ses commissions sans attendre une synchro
      for (const target of targetUsers) {
        try {
          await recalculateForUser(target.id, tenantId);
        } catch {
          // un membre en erreur ne doit pas bloquer les autres
        }
      }

      const planWithAssignments = await variablePlanRepository.findById(savedPlan.id, tenantId);
      res.status(201).json({ success: true, data: planWithAssignments });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Met à jour un plan existant depuis l'interface de simulation (mode ÉDITION) :
   * - les règles existantes du plan sont mises à jour EN PLACE (les assignations
   *   des membres suivent automatiquement) ;
   * - les composants ajoutés créent de nouvelles règles, assignées aux membres
   *   déjà sur le plan ; les composants retirés archivent la règle et désactivent
   *   ses assignations ;
   * - les objectifs des membres assignés sont synchronisés (clé label|periodType).
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenantId = user.tenantId!;
      const { plan } = z.object({ plan: generatedPlanSchema }).parse(req.body);

      const existing = await variablePlanRepository.findById(req.params.id, tenantId);
      if (!existing || !existing.isActive) {
        throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan de variable introuvable');
      }

      const assigneeIds = existing.assignments
        .map((a) => a.userId)
        .filter((id): id is string => id !== null);

      // Anciennes règles du plan : par id, et par nom (rematch après re-prompt IA)
      const oldRuleComponents = existing.components.filter((c) => c.kind === 'COMMISSION_RULE' && c.ruleId);
      const oldRuleIdSet = new Set(oldRuleComponents.map((c) => c.ruleId!));
      const oldRuleIdByName = new Map(
        oldRuleComponents.filter((c) => c.rule).map((c) => [c.rule!.name, c.ruleId!]),
      );

      const componentsToCreate: Array<{
        kind: 'COMMISSION_RULE' | 'OBJECTIVE';
        ruleId: string | null;
        objectiveConfig: Record<string, unknown> | null;
        appliesToEventType: 'DEAL_WON' | 'MISSION_MONTH';
        sortOrder: number;
      }> = [];
      const keptRuleIds = new Set<string>();
      const newRuleIds: string[] = [];

      for (let i = 0; i < plan.components.length; i++) {
        const component = plan.components[i];
        if (component.kind === 'COMMISSION_RULE') {
          // Rematch : ruleId fourni par le front, sinon nom identique (re-prompt IA)
          let ruleId = component.ruleId && oldRuleIdSet.has(component.ruleId) ? component.ruleId : undefined;
          if (!ruleId) {
            const byName = oldRuleIdByName.get(component.name);
            if (byName && !keptRuleIds.has(byName)) ruleId = byName;
          }
          if (ruleId) {
            keptRuleIds.add(ruleId);
            await commissionRuleRepository.updateMeta(ruleId, tenantId, {
              name: component.name,
              description: component.config.description,
              config: component.config,
              type: component.config.type as CommissionRuleType,
            });
          } else {
            const rule = await commissionRuleRepository.create({
              tenantId,
              name: component.name,
              description: component.config.description,
              type: component.config.type as CommissionRuleType,
              config: component.config,
              createdBy: user.userId,
              dealType: null,
              scope: RuleScope.GLOBAL,
              paymentDelayDays: null,
            });
            ruleId = rule.id;
            newRuleIds.push(rule.id);
          }
          componentsToCreate.push({
            kind: 'COMMISSION_RULE',
            ruleId,
            objectiveConfig: null,
            appliesToEventType: component.config.appliesToEventType === 'MISSION_MONTH' ? 'MISSION_MONTH' : 'DEAL_WON',
            sortOrder: i,
          });
        } else {
          const objectiveConfig = withPeriodDefaults(component.objective as unknown as Record<string, unknown>);
          componentsToCreate.push({
            kind: 'OBJECTIVE',
            ruleId: null,
            objectiveConfig,
            appliesToEventType: 'DEAL_WON',
            sortOrder: i,
          });
        }
      }

      // Règles retirées du plan : archivage + désactivation de leurs assignations
      const removedRuleIds = [...oldRuleIdSet].filter((id) => !keptRuleIds.has(id));
      for (const ruleId of removedRuleIds) {
        await commissionRuleRepository.archive(ruleId, tenantId);
      }
      if (removedRuleIds.length > 0) {
        await prisma.ruleAssignment.updateMany({
          where: { tenantId, ruleId: { in: removedRuleIds } },
          data: { isActive: false },
        });
      }

      // Nouvelles règles : assignées aux membres déjà sur le plan
      for (const userId of assigneeIds) {
        for (const ruleId of newRuleIds) {
          await ruleAssignmentRepository.assign({
            tenantId,
            ruleId,
            assignedToType: AssigneeType.INDIVIDUAL,
            userId,
            overrides: null,
          });
        }
      }

      // Objectifs des membres assignés : mise à jour / ajout / retrait (clé label|periodType)
      const keyOf = (o: Record<string, unknown>) => `${String(o['label'])}|${String(o['periodType'])}`;
      const oldObjectiveKeys = new Set(
        existing.components
          .filter((c) => c.kind === 'OBJECTIVE' && c.objectiveConfig !== null)
          .map((c) => keyOf(c.objectiveConfig as unknown as Record<string, unknown>)),
      );
      const newObjectivesByKey = new Map(
        componentsToCreate
          .filter((c) => c.kind === 'OBJECTIVE' && c.objectiveConfig !== null)
          .map((c) => [keyOf(c.objectiveConfig!), c.objectiveConfig!]),
      );
      const removedObjectiveKeys = [...oldObjectiveKeys].filter((k) => !newObjectivesByKey.has(k));

      if (assigneeIds.length > 0 && (oldObjectiveKeys.size > 0 || newObjectivesByKey.size > 0)) {
        const targets = await prisma.user.findMany({
          where: { id: { in: assigneeIds }, tenantId },
          select: { id: true, objectives: true },
        });
        for (const target of targets) {
          const current = Array.isArray(target.objectives) ? (target.objectives as unknown as Objective[]) : [];

          // 1. Retrait : objectifs supprimés du plan (templates + leurs occurrences)
          const removedTemplateIds = new Set(
            current
              .filter((o) => !o.parentObjectiveId && removedObjectiveKeys.includes(`${o.label}|${o.periodType}`))
              .map((o) => o.id),
          );
          let next = current.filter(
            (o) => !removedTemplateIds.has(o.id) && !(o.parentObjectiveId && removedTemplateIds.has(o.parentObjectiveId)),
          );

          // 2. Mise à jour : templates (jamais les occurrences, qui gardent leur période propre)
          next = next.map((o) => {
            if (o.parentObjectiveId) return o;
            const updated = newObjectivesByKey.get(`${o.label}|${o.periodType}`);
            return updated ? ({ ...o, ...updated, id: o.id } as Objective) : o;
          });

          // 3. Ajout : objectifs du plan absents chez le membre
          const memberKeys = new Set(next.filter((o) => !o.parentObjectiveId).map((o) => `${o.label}|${o.periodType}`));
          for (const [key, config] of newObjectivesByKey) {
            if (!memberKeys.has(key)) next.push({ ...config, id: randomUUID() } as unknown as Objective);
          }

          await prisma.user.update({
            where: { id: target.id },
            data: { objectives: next as unknown as object[] },
          });
        }
      }

      // Méta + remplacement des composants du plan
      const updated = await variablePlanRepository.update(existing.id, tenantId, {
        name: plan.name,
        description: plan.description,
        components: componentsToCreate,
      });

      // Recalcul immédiat des commissions de chaque membre assigné : les nouveaux
      // barèmes doivent être visibles sans attendre une synchro CRM.
      // NB : les ajustements personnels (overrides d'assignation) restent prioritaires.
      for (const userId of assigneeIds) {
        try {
          await recalculateForUser(userId, tenantId);
        } catch {
          // un membre en erreur ne doit pas bloquer la mise à jour des autres
        }
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Assigne un plan MODÈLE existant à des membres : chaque règle du plan est
   * assignée (sans doublon), chaque objectif est ajouté au tableau de bord du
   * membre (sans doublon sur le libellé), et l'assignation de plan est tracée.
   */
  async assignPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenantId = user.tenantId!;
      const { userIds } = z.object({ userIds: z.array(z.string().min(1)).min(1).max(200) }).parse(req.body);

      const plan = await variablePlanRepository.findById(req.params.id, tenantId);
      if (!plan) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan de variable introuvable');

      const targetUsers = await prisma.user.findMany({
        where: { id: { in: userIds }, tenantId, isActive: true },
        select: { id: true, objectives: true },
      });
      if (targetUsers.length !== userIds.length) {
        throw new AppError(400, 'INVALID_ASSIGNEES', 'Un ou plusieurs membres sont introuvables dans votre entreprise');
      }

      const ruleIds = plan.components.filter((c) => c.ruleId !== null).map((c) => c.ruleId!);
      const objectiveConfigs = plan.components
        .filter((c) => c.kind === 'OBJECTIVE' && c.objectiveConfig !== null)
        .map((c) => c.objectiveConfig as unknown as Record<string, unknown>);

      for (const target of targetUsers) {
        // Règles : pas de doublon si le membre a déjà cette règle en direct
        const existingAssignments = await ruleAssignmentRepository.findActiveForUser(target.id, tenantId);
        const alreadyAssigned = new Set(
          existingAssignments
            .filter((a) => a.assignedToType === 'INDIVIDUAL')
            .map((a) => a.ruleId),
        );
        for (const ruleId of ruleIds) {
          if (alreadyAssigned.has(ruleId)) continue;
          await ruleAssignmentRepository.assign({
            tenantId,
            ruleId,
            assignedToType: AssigneeType.INDIVIDUAL,
            userId: target.id,
            overrides: null,
          });
        }

        // Objectifs : pas de doublon sur (label, periodType)
        if (objectiveConfigs.length > 0) {
          const existing = Array.isArray(target.objectives) ? (target.objectives as unknown as Objective[]) : [];
          const existingKeys = new Set(existing.map((o) => `${o.label}|${o.periodType}`));
          const toAdd = objectiveConfigs
            .filter((o) => !existingKeys.has(`${String(o['label'])}|${String(o['periodType'])}`))
            .map((o) => ({ ...withPeriodDefaults(o), id: randomUUID() }));
          if (toAdd.length > 0) {
            await prisma.user.update({
              where: { id: target.id },
              data: { objectives: [...existing, ...toAdd] as object[] },
            });
          }
        }

        await variablePlanRepository.recordAssignment(plan.id, tenantId, target.id);
      }

      // Recalcul immédiat pour les nouveaux membres du plan
      for (const target of targetUsers) {
        try {
          await recalculateForUser(target.id, tenantId);
        } catch {
          // un membre en erreur ne doit pas bloquer les autres
        }
      }

      const updated = await variablePlanRepository.findById(plan.id, tenantId);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
};
