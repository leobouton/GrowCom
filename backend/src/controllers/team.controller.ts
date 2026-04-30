import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userRepository } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';
import { prisma } from '../config/prisma';

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
      if (objectives !== undefined) updateData.objectives = objectives;

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
