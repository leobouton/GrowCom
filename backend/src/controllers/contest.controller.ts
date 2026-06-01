import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { contestRepository } from '../repositories/contest.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { ContestStatus, ContestMetric, RuleScope, UserRole } from '../../../shared/types';

/** Retourne les IDs des membres de l'équipe d'un TEAM_LEAD (commerciaux/recruteurs uniquement) */
async function getTeamLeadMemberIds(leadId: string, tenantId: string): Promise<string[]> {
  const group = await prisma.group.findFirst({
    where: { leadId, tenantId },
    include: {
      members: {
        where: { isActive: true },
        select: { id: true },
      },
    },
  });
  return group?.members.map((m) => m.id) ?? [];
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  prize: z.string().min(1).max(200),
  metric: z.nativeEnum(ContestMetric),
  scope: z.nativeEnum(RuleScope).default(RuleScope.GLOBAL),
  teamName: z.string().max(100).optional().nullable(),
  participantIds: z.array(z.string()).default([]),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  anonymousLeaderboard: z.boolean().default(false),
});

export const contestController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;

      let contests;
      if (user.role === UserRole.MANAGER || user.role === UserRole.BU_MANAGER) {
        // Directeur : voit tous les concours du tenant
        contests = await contestRepository.findByTenantId(user.tenantId!);
      } else if (user.role === UserRole.TEAM_LEAD) {
        // Responsable de secteur : voit uniquement les concours qu'il a créés
        contests = await contestRepository.findByCreatorId(user.userId, user.tenantId!);
      } else {
        // Commercial / Recruteur : voit uniquement les concours actifs où il participe
        contests = await contestRepository.findForUser(user.userId, user.tenantId!);
      }

      res.json({ success: true, data: contests });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const body = createSchema.parse(req.body);

      const start = new Date(body.periodStart);
      const end = new Date(body.periodEnd);
      if (end <= start) {
        res.status(400).json({ success: false, error: { code: 'INVALID_DATES', message: 'La date de fin doit être après la date de début' } });
        return;
      }

      // Restriction TEAM_LEAD : les participants doivent être membres de son équipe
      let finalScope = body.scope;
      if (user.role === UserRole.TEAM_LEAD) {
        const teamMemberIds = await getTeamLeadMemberIds(user.userId, user.tenantId!);

        if (body.participantIds.length === 0) {
          res.status(400).json({ success: false, error: { code: 'NO_PARTICIPANTS', message: 'Vous devez sélectionner au moins un participant de votre équipe' } });
          return;
        }

        const invalidIds = body.participantIds.filter((id) => !teamMemberIds.includes(id));
        if (invalidIds.length > 0) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Certains participants ne font pas partie de votre équipe' } });
          return;
        }

        // Forcer le scope à INDIVIDUAL pour les TEAM_LEAD
        finalScope = RuleScope.INDIVIDUAL;
      }

      const contest = await contestRepository.create({
        tenantId: user.tenantId!,
        createdBy: user.userId,
        name: body.name,
        description: body.description,
        prize: body.prize,
        metric: body.metric,
        scope: finalScope,
        teamName: body.teamName ?? null,
        participantIds: body.participantIds,
        periodStart: start,
        periodEnd: end,
        anonymousLeaderboard: body.anonymousLeaderboard,
      });

      res.status(201).json({ success: true, data: contest });
    } catch (err) {
      next(err);
    }
  },

  async end(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const contest = await contestRepository.findById(id, user.tenantId!);
      if (!contest) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Concours introuvable' } });
        return;
      }

      // TEAM_LEAD ne peut terminer que ses propres concours
      if (user.role === UserRole.TEAM_LEAD && contest.createdBy !== user.userId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Vous ne pouvez modifier que les concours que vous avez créés' } });
        return;
      }

      const updated = await contestRepository.updateStatus(id, user.tenantId!, ContestStatus.ENDED);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },

  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const contest = await contestRepository.findById(id, user.tenantId!);
      if (!contest) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Concours introuvable' } });
        return;
      }

      // TEAM_LEAD ne peut annuler que ses propres concours
      if (user.role === UserRole.TEAM_LEAD && contest.createdBy !== user.userId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Vous ne pouvez modifier que les concours que vous avez créés' } });
        return;
      }

      const updated = await contestRepository.updateStatus(id, user.tenantId!, ContestStatus.CANCELLED);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },

  async leaderboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;

      const contest = await contestRepository.findById(id, user.tenantId!);
      if (!contest) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Concours introuvable' } });
        return;
      }

      const entries = await contestRepository.getLeaderboard({
        metric: contest.metric,
        periodStart: contest.periodStart,
        periodEnd: contest.periodEnd,
        tenantId: user.tenantId!,
        scope: contest.scope,
        teamName: contest.teamName,
        participantIds: contest.participantIds,
      });

      // Sécurité : si classement anonyme ET l'utilisateur est un commercial → filtrer les données
      const isManager = user.role === UserRole.MANAGER || user.role === UserRole.BU_MANAGER || user.role === UserRole.TEAM_LEAD;

      if (contest.anonymousLeaderboard && !isManager) {
        // Trouver la position du commercial dans le classement
        const myEntry = entries.find((e) => e.user.id === user.userId);
        const leaderEntry = entries[0];

        res.json({
          success: true,
          data: {
            anonymous: true,
            myRank: myEntry?.rank ?? 0,
            totalParticipants: entries.length,
            myScore: myEntry?.value ?? 0,
            leaderScore: leaderEntry?.value ?? 0,
          },
        });
        return;
      }

      // Manager ou concours non anonyme → classement complet
      res.json({ success: true, data: entries });
    } catch (err) {
      next(err);
    }
  },
};
