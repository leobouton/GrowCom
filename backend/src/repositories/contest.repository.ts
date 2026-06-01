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
  anonymousLeaderboard?: boolean;
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
        anonymousLeaderboard: data.anonymousLeaderboard ?? false,
        status: ContestStatus.ACTIVE,
      },
    });
  },

  async updateStatus(id: string, tenantId: string, status: ContestStatus) {
    return prisma.contest.update({
      where: { id, tenantId },
      data: { status },
    });
  },

  /**
   * Calcule le leaderboard d'un concours.
   *
   * Chantier 1 — Refonte :
   * - Se base sur les deals WON dans la période du concours
   * - Exclut les deals dont la commission du commercial est CANCELLED
   * - Gère les DealAssignment (splits) : utilise amount × share
   * - Pour la marge : exclut les deals sans marginAmount (null)
   * - Fallback rétrocompat : si pas de DealAssignment, utilise assignedToId à 100%
   */
  async getLeaderboard(contest: {
    metric: string;
    periodStart: Date;
    periodEnd: Date;
    tenantId: string;
    scope: string;
    teamName: string | null;
    participantIds: unknown;
  }) {
    // 1. Déterminer les participants selon le scope
    let participantUserIds: string[] | null = null; // null = tous

    if (contest.scope === RuleScope.INDIVIDUAL) {
      const ids = Array.isArray(contest.participantIds) ? (contest.participantIds as string[]) : [];
      if (ids.length === 0) return [];
      participantUserIds = ids;
    } else if (contest.scope === RuleScope.TEAM && contest.teamName) {
      const group = await prisma.group.findFirst({
        where: { tenantId: contest.tenantId, name: contest.teamName },
        include: { members: { select: { id: true } } },
      });
      if (!group || group.members.length === 0) return [];
      participantUserIds = group.members.map((m) => m.id);
    }

    // 2. Récupérer tous les deals WON dans la période avec leurs commissions et assignments
    const deals = await prisma.deal.findMany({
      where: {
        tenantId: contest.tenantId,
        status: 'WON',
        closedAt: { gte: contest.periodStart, lte: contest.periodEnd },
      },
      include: {
        assignments: { select: { userId: true, share: true } },
        commissions: { select: { userId: true, status: true } },
      },
    });

    // 3. Calculer les scores par utilisateur
    const scoreMap = new Map<string, number>();

    for (const deal of deals) {
      // Pour la marge, ignorer les deals sans marginAmount
      if (contest.metric === ContestMetric.MARGIN && (deal.marginAmount === null || deal.marginAmount === undefined)) {
        continue;
      }

      const valueField = contest.metric === ContestMetric.MARGIN ? deal.marginAmount! : deal.amount;

      // Déterminer les commerciaux impliqués (DealAssignment ou fallback)
      const contributors: Array<{ userId: string; share: number }> =
        deal.assignments.length > 0
          ? deal.assignments.map((a) => ({ userId: a.userId, share: a.share }))
          : deal.assignedToId
            ? [{ userId: deal.assignedToId, share: 1.0 }]
            : [];

      for (const contrib of contributors) {
        // Filtrer par participants si scope limité
        if (participantUserIds && !participantUserIds.includes(contrib.userId)) continue;

        // Exclure si TOUTES les commissions de ce user sur ce deal sont CANCELLED
        const userCommissions = deal.commissions.filter((c) => c.userId === contrib.userId);
        if (userCommissions.length > 0 && userCommissions.every((c) => c.status === 'CANCELLED')) continue;

        const contribution = contest.metric === ContestMetric.DEAL_COUNT
          ? 1 // 1 deal par deal, même splitté
          : valueField * contrib.share;

        scoreMap.set(contrib.userId, (scoreMap.get(contrib.userId) ?? 0) + contribution);
      }
    }

    // 4. Récupérer les infos utilisateurs et trier
    const userIds = [...scoreMap.keys()];
    if (userIds.length === 0) return [];

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return [...scoreMap.entries()]
      .filter(([uid]) => userMap.has(uid))
      .sort((a, b) => b[1] - a[1])
      .map(([uid, value], i) => ({
        rank: i + 1,
        user: userMap.get(uid)!,
        value,
      }));
  },
};
