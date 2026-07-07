import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userRepository } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';
import type { Objective } from '../../../shared/types';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { buildOccurrence } from '../services/objectiveRecurrence.service';

export const teamController = {
  async getTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;

      let members;
      if (user.role === UserRole.MANAGER || user.role === UserRole.BU_MANAGER) {
        // Membres des groupes où ce manager est assigné
        const groups = await prisma.group.findMany({
          where: { managerId: user.userId, tenantId: user.tenantId! },
          include: { members: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
        });
        const seen = new Set<string>();
        const groupMembers = groups.flatMap((g) => g.members).filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
        // Fallback : si ce manager n'est dans aucun groupe, retourner tous les membres du tenant
        members = groupMembers.length > 0 ? groupMembers : await userRepository.findByTenantId(user.tenantId!);
      } else if (user.role === UserRole.TEAM_LEAD) {
        // Membres du groupe dont ce responsable est le lead
        const group = await prisma.group.findFirst({
          where: { leadId: user.userId, tenantId: user.tenantId! },
          include: { members: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
        });
        members = group?.members ?? [];
      } else {
        members = await userRepository.findByTenantId(user.tenantId!);
      }

      res.json({
        success: true,
        data: members.map((m) => ({
          id: m.id,
          email: m.email,
          firstName: m.firstName,
          lastName: m.lastName,
          role: m.role,
          tenantId: m.tenantId,
          fixedSalary: m.fixedSalary,
          objectives: Array.isArray((m as Record<string, unknown>).objectives)
              ? (m as Record<string, unknown>).objectives
              : [],
          isActive: m.isActive,
          emailVerified: m.emailVerified,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },

  async updateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const manager = (req as AuthenticatedRequest).user;
      const { memberId } = req.params;

      const objectiveBonusSchema = z.object({
        enabled: z.boolean(),
        type: z.enum(['percentage', 'fixed']),
        value: z.number(),
      });

      const objectiveBonusTierSchema = z.object({
        threshold: z.number().min(1).max(200),
        reward: z.object({
          type: z.enum(['fixed', 'percentage']),
          value: z.number().min(0),
        }),
      });

      const updateMemberSchema = z.object({
        firstName: z.string().min(1).max(50).optional(),
        lastName: z.string().min(1).max(50).optional(),
        fixedSalary: z.number().min(0).optional(), // Salaire fixe BRUT MENSUEL en euros
        objectives: z.array(z.object({
          id: z.string(),
          label: z.string(),
          target: z.number(),
          unit: z.string(),
          periodType: z.enum(['monthly', 'quarterly', 'semester', 'annual', 'custom']),
          month: z.number().optional(),
          quarter: z.number().optional(),
          year: z.number().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          bonus: objectiveBonusSchema.optional(),
          isActive: z.boolean().optional(),
          // Champs Session B — bonus avancé et récurrence
          bonusMode: z.enum(['none', 'simple', 'tiered']).optional(),
          bonusTiers: z.array(objectiveBonusTierSchema).optional(),
          recurrence: z.enum(['none', 'monthly', 'quarterly', 'semester', 'annual']).optional(),
          semester: z.number().optional(),
          recurrenceEndDate: z.string().optional(),
          parentObjectiveId: z.string().optional(),
        }).superRefine((obj, ctx) => {
          // Validation croisée : les champs de période requis selon periodType
          if (obj.periodType === 'monthly' && !obj.month) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['month'], message: 'Le mois est requis pour un objectif mensuel' });
          }
          if (obj.periodType === 'quarterly' && !obj.quarter) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quarter'], message: 'Le trimestre est requis pour un objectif trimestriel' });
          }
          if (obj.periodType === 'semester' && !obj.semester) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['semester'], message: 'Le semestre est requis pour un objectif semestriel' });
          }
          if ((obj.periodType === 'monthly' || obj.periodType === 'quarterly' || obj.periodType === 'semester' || obj.periodType === 'annual') && !obj.year) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['year'], message: "L'année est requise" });
          }
          if (obj.periodType === 'custom' && (!obj.startDate || !obj.endDate)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Les dates sont requises pour une période personnalisée' });
          }
        })).optional(),
      });

      const { firstName, lastName, fixedSalary, objectives } = updateMemberSchema.parse(req.body);

      const member = await userRepository.findById(memberId);

      if (!member || member.tenantId !== manager.tenantId) {
        res.status(404).json({ success: false, error: { message: 'Collaborateur introuvable' } });
        return;
      }

      // TEAM_LEAD : vérifier que le membre appartient bien à son groupe
      if (manager.role === UserRole.TEAM_LEAD) {
        const group = await prisma.group.findFirst({
          where: { leadId: manager.userId, tenantId: manager.tenantId! },
          select: { id: true },
        });
        if (!group || member.groupId !== group.id) {
          res.status(403).json({ success: false, error: { message: 'Ce collaborateur ne fait pas partie de votre équipe' } });
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      if (firstName !== undefined) updateData.firstName = firstName.trim();
      if (lastName !== undefined) updateData.lastName = lastName.trim();
      if (fixedSalary !== undefined) updateData.fixedSalary = fixedSalary;

      // ── Objectifs : la liste envoyée par le client est la SOURCE DE VÉRITÉ ──
      // Les suppressions faites dans l'interface sont respectées telles quelles
      // (on ne ressuscite plus les occurrences depuis la base — ancien bug :
      // impossible de supprimer un objectif récurrent depuis la fiche membre).
      // Seule garantie ajoutée : chaque template récurrent CONSERVÉ possède une
      // occurrence pour la période en cours (sinon elle est générée).
      if (objectives !== undefined) {
        const input = objectives as Objective[];
        const newObjectives: Objective[] = [...input];

        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const currentQuarter = Math.ceil(currentMonth / 3);
        const currentSemester = currentMonth <= 6 ? 1 : 2;

        for (const obj of input) {
          const isTemplate = obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId;
          if (!isTemplate) continue;

          const freq = obj.recurrence!;
          let hasCurrentPeriod = false;
          if (freq === 'monthly') {
            hasCurrentPeriod = newObjectives.some(
              (o) => o.parentObjectiveId === obj.id && o.month === currentMonth && o.year === currentYear,
            );
          } else if (freq === 'quarterly') {
            hasCurrentPeriod = newObjectives.some(
              (o) => o.parentObjectiveId === obj.id && o.quarter === currentQuarter && o.year === currentYear,
            );
          } else if (freq === 'semester') {
            hasCurrentPeriod = newObjectives.some(
              (o) => o.parentObjectiveId === obj.id && o.semester === currentSemester && o.year === currentYear,
            );
          } else if (freq === 'annual') {
            hasCurrentPeriod = newObjectives.some(
              (o) => o.parentObjectiveId === obj.id && o.year === currentYear,
            );
          }

          if (!hasCurrentPeriod) {
            let periodOverride: Partial<Pick<Objective, 'periodType' | 'month' | 'quarter' | 'semester' | 'year'>> = {};
            if (freq === 'monthly') periodOverride = { periodType: 'monthly', month: currentMonth, year: currentYear };
            else if (freq === 'quarterly') periodOverride = { periodType: 'quarterly', quarter: currentQuarter, year: currentYear };
            else if (freq === 'semester') periodOverride = { periodType: 'semester', semester: currentSemester, year: currentYear };
            else if (freq === 'annual') periodOverride = { periodType: 'annual', year: currentYear };

            const newOcc = buildOccurrence(obj, periodOverride);
            newObjectives.push(newOcc);
            logger.info('OBJECTIVE_OCCURRENCE_AUTO_GENERATED', {
              userId: memberId,
              tenantId: manager.tenantId,
              templateId: obj.id,
              period: periodOverride,
            });
          }
        }

        updateData.objectives = newObjectives;
      }

      const updated = await userRepository.update(memberId, updateData as Parameters<typeof userRepository.update>[1]);

      res.json({
        success: true,
        data: {
          id: updated.id,
          firstName: updated.firstName,
          lastName: updated.lastName,
          fixedSalary: updated.fixedSalary,
          objectives: Array.isArray((updated as Record<string, unknown>).objectives)
              ? (updated as Record<string, unknown>).objectives
              : [],
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const manager = (req as AuthenticatedRequest).user;
      const { memberId } = req.params;

      // Récupérer le membre ciblé
      const member = await userRepository.findById(memberId);

      if (!member || member.tenantId !== manager.tenantId) {
        res.status(404).json({ success: false, error: { message: 'Collaborateur introuvable' } });
        return;
      }

      // Empêcher de se supprimer soi-même
      if (member.id === manager.userId) {
        res.status(400).json({ success: false, error: { message: 'Vous ne pouvez pas vous supprimer vous-même' } });
        return;
      }

      // TEAM_LEAD : vérifier que le membre appartient bien à son groupe
      if (manager.role === UserRole.TEAM_LEAD) {
        const group = await prisma.group.findFirst({
          where: { leadId: manager.userId, tenantId: manager.tenantId! },
          select: { id: true },
        });
        if (!group || member.groupId !== group.id) {
          res.status(403).json({ success: false, error: { message: 'Ce collaborateur ne fait pas partie de votre équipe' } });
          return;
        }
      }

      // Soft delete : désactiver le membre sans supprimer son historique de commissions
      await userRepository.deactivate(memberId, manager.tenantId!);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};

