import { prisma } from '../config/prisma';
import { ContestStatus, ContestMetric, RuleScope } from '../../../shared/types';

export interface CreateContestData {
  tenantId: string;
  name: string;
  description: string;
  prize: string;
  metric: ContestMetric;
  scope: RuleScope;
  teamName?: string | null;
  participantIds?: string[];
  periodStart: Date;
  periodEnd: Date;
  createdBy: string;
}

export const contestRepository = {
  async findByTenantId(tenantId: string) {
    return prisma.contest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Concours créés par un utilisateur spécifique (utilisé pour les TEAM_LEAD) */
  async findByCreatorId(createdBy: string, tenantId: string) {
    return prisma.contest.findMany({
      where: { createdBy, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Retourne uniquement les concours actifs auxquels l'utilisateur participe */
  async findForUser(userId: string, tenantId: string) {
    // Récupérer le groupe de l'utilisateur pour filtrer les concours TEAM
    const userWithGroup = await prisma.user.findUnique({
      where: { id: userId },
      include: { group: { select: { name: true } } },
    });
    const groupName = userWithGroup?.group?.name ?? null;

    const all = await prisma.contest.findMany({
      where: { tenantId, status: ContestStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });

    return all.filter((c) => {
      if (c.scope === RuleScope.GLOBAL) return true;
      if (c.scope === RuleScope.INDIVIDUAL) {
        const ids = Array.isArray(c.participantIds) ? (c.participantIds as string[]) : [];
        return ids.includes(userId);
      }
      if (c.scope === RuleScope.TEAM && groupName) {
        return c.teamName === groupName;
      }
      return false;
    });
  },

  async findById(id: string, tenantId: string) {
    return prisma.contest.findFirst({
      where: { id, tenantId },
    });
  },

  async create(data: CreateContestData) {
    return prisma.contest.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        description: data.description,
        prize: data.prize,
        metric: data.metric,
        scope: data.scope,
        teamName: data.teamName ?? null,
        participantIds: data.participantIds ?? [],
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        createdBy: data.createdBy,
        status: ContestStatus.ACTIVE,
      },
    });
  },

  async updateStatus(id: string, _tenantId: string, status: ContestStatus) {
    return prisma.contest.update({
      where: { id },
      data: { status },
    });
  },

  async getLeaderboard(contest: {
    metric: string;
    periodStart: Date;
    periodEnd: Date;
    tenantId: string;
    scope: string;
    teamName: string | null;
    participantIds: unknown;
  }) {
    // Déterminer le filtre sur les utilisateurs selon le scope
    let userIdFilter: { in: string[] } | undefined;

    if (contest.scope === RuleScope.INDIVIDUAL) {
      const ids = Array.isArray(contest.participantIds) ? (contest.participantIds as string[]) : [];
      if (ids.length === 0) return [];
      userIdFilter = { in: ids };
    } else if (contest.scope === RuleScope.TEAM && contest.teamName) {
      // Trouver les membres du groupe
      const group = await prisma.group.findFirst({
        where: { tenantId: contest.tenantId, name: contest.teamName },
        include: { members: { select: { id: true } } },
      });
      if (!group || group.members.length === 0) return [];
      userIdFilter = { in: group.members.map((m) => m.id) };
    }
    // RuleScope.GLOBAL → pas de filtre userId

    const baseWhere = {
      tenantId: contest.tenantId,
      status: 'WON' as const,
      closedAt: { gte: contest.periodStart, lte: contest.periodEnd },
      assignedToId: { not: null, ...(userIdFilter ?? {}) },
    };

    if (contest.metric === ContestMetric.REVENUE) {
      const result = await prisma.deal.groupBy({
        by: ['assignedToId'],
        where: baseWhere,
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      });

      const userIds = result.map((r) => r.assignedToId as string);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      return result
        .filter((r) => r.assignedToId && userMap.has(r.assignedToId))
        .map((r, i) => ({
          rank: i + 1,
          user: userMap.get(r.assignedToId as string)!,
          value: r._sum.amount ?? 0,
        }));
    } else {
      const result = await prisma.deal.groupBy({
        by: ['assignedToId'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      const userIds = result.map((r) => r.assignedToId as string);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      return result
        .filter((r) => r.assignedToId && userMap.has(r.assignedToId))
        .map((r, i) => ({
          rank: i + 1,
          user: userMap.get(r.assignedToId as string)!,
          value: r._count.id,
        }));
    }
  },
};
