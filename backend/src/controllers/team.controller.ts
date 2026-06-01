import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userRepository } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';
import type { Objective } from '../../../shared/types';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

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
          periodType: z.enum(['monthly', 'quarterly', 'annual', 'custom']),
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
          recurrence: z.enum(['none', 'monthly', 'quarterly', 'annual']).optional(),
          recurrenceEndDate: z.string().optional(),
          parentObjectiveId: z.string().optional(),
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

      // ── Logique template vs occurrence pour objectifs récurrents ──
      if (objectives !== undefined) {
        const existingObjectives = Array.isArray((member as Record<string, unknown>).objectives)
          ? ((member as Record<string, unknown>).objectives as Objective[])
          : [];

        const newObjectives: Objective[] = [];
        for (const obj of objectives as Objective[]) {
          const isTemplate = obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId;

          if (isTemplate) {
            // C'est un template récurrent → conserver les occurrences passées/en cours, régénérer les futures
            const existingTemplate = existingObjectives.find((e) => e.id === obj.id);
            newObjectives.push(obj);

            if (existingTemplate) {
              // Conserver les occurrences passées et en cours (dont la période a commencé)
              const now = new Date();
              const existingOccurrences = existingObjectives.filter((e) => e.parentObjectiveId === obj.id);
              for (const occ of existingOccurrences) {
                const occStart = getOccurrenceStartDate(occ);
                if (occStart && occStart <= now) {
                  // Occurrence passée ou en cours → on la conserve telle quelle
                  newObjectives.push(occ);
                }
                // Les occurrences futures sont supprimées — elles seront régénérées par le cron
              }
              logger.info('OBJECTIVE_TEMPLATE_UPDATED', {
                userId: memberId,
                tenantId: manager.tenantId,
                objectiveId: obj.id,
                keptOccurrences: existingOccurrences.filter((o) => {
                  const s = getOccurrenceStartDate(o);
                  return s && s <= now;
                }).length,
              });
            }
          } else {
            // Occurrence simple ou objectif non-récurrent → simple update
            newObjectives.push(obj);
          }
        }

        // Conserver aussi les occurrences orphelines (dont le template n'est pas dans la liste envoyée)
        // Ceci évite de perdre des occurrences si le frontend n'envoie que certains objectifs
        const sentIds = new Set((objectives as Objective[]).map((o) => o.id));
        const sentParentIds = new Set((objectives as Objective[]).filter(
          (o) => o.recurrence && o.recurrence !== 'none' && !o.parentObjectiveId,
        ).map((o) => o.id));
        for (const existing of existingObjectives) {
          if (!sentIds.has(existing.id) && existing.parentObjectiveId && !sentParentIds.has(existing.parentObjectiveId)) {
            newObjectives.push(existing);
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
      await userRepository.deactivate(memberId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Retourne la date de début d'une occurrence d'objectif. */
function getOccurrenceStartDate(obj: Objective): Date | null {
  if (obj.startDate) return new Date(obj.startDate);
  const year = obj.year ?? new Date().getFullYear();
  if (obj.periodType === 'monthly' && obj.month) {
    return new Date(year, obj.month - 1, 1);
  }
  if (obj.periodType === 'quarterly' && obj.quarter) {
    return new Date(year, (obj.quarter - 1) * 3, 1);
  }
  if (obj.periodType === 'annual') {
    return new Date(year, 0, 1);
  }
  return null;
}
