import { prisma } from '../config/prisma';
import { UserRole as PrismaUserRole } from '@prisma/client';
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

  async delete(id: string, tenantId: string) {
    const contest = await prisma.contest.findFirst({ where: { id, tenantId } });
    if (!contest) throw new Error('Concours introuvable');
    await prisma.contest.delete({ where: { id } });
  },

  /**
   * Calcule le leaderboard d'un concours.
   *
   * - Se base sur les deals WON dans la période du concours
   * - Exclut les deals dont la commission du commercial est CANCELLED
   * - Gère les DealAssignment (splits) : utilise amount × share
   * - Pour la marge : exclut les deals sans marginAmount (null)
   * - Fallback rétrocompat : si pas de DealAssignment, utilise assignedToId à 100%
   * - Inclut TOUS les participants (même ceux sans deal) avec un score de 0
   * - Gère les ex-aequo : même score = même rang
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
    //    - INDIVIDUAL : utilise participantIds stockés à la création
    //    - TEAM : utilise participantIds si disponible, sinon fallback membres du groupe
    //    - GLOBAL : tous les utilisateurs éligibles du tenant (null = pas de filtre par ID)
    let participantUserIds: string[] | null = null; // null = tous

    const storedIds = Array.isArray(contest.participantIds) ? (contest.participantIds as string[]) : [];

    if (contest.scope === RuleScope.INDIVIDUAL || contest.scope === RuleScope.TEAM) {
      if (storedIds.length > 0) {
        // Participants explicitement enregistrés à la création
        participantUserIds = storedIds;
      } else if (contest.scope === RuleScope.TEAM && contest.teamName) {
        // Fallback rétrocompat : résolution dynamique par nom de groupe
        const group = await prisma.group.findFirst({
          where: { tenantId: contest.tenantId, name: contest.teamName },
          include: { members: { where: { isActive: true }, select: { id: true } } },
        });
        if (!group || group.members.length === 0) return [];
        participantUserIds = group.members.map((m) => m.id);
      } else if (contest.scope === RuleScope.INDIVIDUAL) {
        return []; // INDIVIDUAL sans participantIds = pas de participants
      }
    }

    // 2. Récupérer TOUS les participants pour les inclure même à score 0
    //    GLOBAL → tous les utilisateurs actifs du tenant sauf SUPER_ADMIN (commerciaux, recruteurs, team_leads, bu_managers)
    //    TEAM/INDIVIDUAL → liste connue ci-dessus
    const allParticipants = await prisma.user.findMany({
      where: {
        tenantId: contest.tenantId,
        isActive: true,
        ...(participantUserIds !== null
          ? { id: { in: participantUserIds } }
          : {
              role: {
                in: [
                  PrismaUserRole.COMMERCIAL,
                  PrismaUserRole.RECRUITER,
                  PrismaUserRole.TEAM_LEAD,
                  PrismaUserRole.BU_MANAGER,
                ],
              },
            }),
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (allParticipants.length === 0) return [];

    // Initialiser les scores à 0 pour tous les participants
    const scoreMap = new Map<string, number>();
    for (const p of allParticipants) {
      scoreMap.set(p.id, 0);
    }

    // 3. Récupérer tous les deals WON dans la période avec leurs commissions et assignments
    // Normaliser les bornes pour couvrir la journée entière (corrige les problèmes de timezone)
    const periodStart = new Date(contest.periodStart);
    periodStart.setUTCHours(0, 0, 0, 0);
    const periodEnd = new Date(contest.periodEnd);
    periodEnd.setUTCHours(23, 59, 59, 999);

    const deals = await prisma.deal.findMany({
      where: {
        tenantId: contest.tenantId,
        status: 'WON',
        closedAt: { gte: periodStart, lte: periodEnd },
      },
      include: {
        assignments: { select: { userId: true, share: true } },
        commissions: { select: { userId: true, status: true } },
      },
    });

    // 4. Calculer les scores par utilisateur
    // Détail par user : liste des contributions deal par deal (pour debug / affichage)
    const detailMap = new Map<string, Array<{
      dealId: string;
      dealTitle: string;
      clientName: string | null;
      amount: number;
      marginAmount: number | null;
      costAmount: number | null;
      valueUsed: number;
      share: number;
      contribution: number;
      source: string;
    }>>();
    for (const p of allParticipants) {
      detailMap.set(p.id, []);
    }

    for (const deal of deals) {
      let valueField: number;
      let source: string;
      if (contest.metric === ContestMetric.MARGIN) {
        if (deal.marginAmount !== null && deal.marginAmount !== undefined) {
          valueField = deal.marginAmount;
          source = 'marginAmount';
        } else if (deal.costAmount !== null && deal.costAmount !== undefined) {
          valueField = deal.amount - deal.costAmount;
          source = 'amount - costAmount';
        } else {
          valueField = deal.amount;
          source = 'amount (fallback)';
        }
      } else {
        valueField = deal.amount;
        source = 'amount';
      }

      // Déterminer les commerciaux impliqués (DealAssignment ou fallback)
      const contributors: Array<{ userId: string; share: number }> =
        deal.assignments.length > 0
          ? deal.assignments.map((a) => ({ userId: a.userId, share: a.share }))
          : deal.assignedToId
            ? [{ userId: deal.assignedToId, share: 1.0 }]
            : [];

      for (const contrib of contributors) {
        // Filtrer par participants si scope limité
        if (!scoreMap.has(contrib.userId)) continue;

        // Exclure si TOUTES les commissions de ce user sur ce deal sont CANCELLED
        const userCommissions = deal.commissions.filter((c) => c.userId === contrib.userId);
        if (userCommissions.length > 0 && userCommissions.every((c) => c.status === 'CANCELLED')) continue;

        const contribution = contest.metric === ContestMetric.DEAL_COUNT
          ? 1 // 1 deal par deal, même splitté
          : valueField * contrib.share;

        scoreMap.set(contrib.userId, (scoreMap.get(contrib.userId) ?? 0) + contribution);

        detailMap.get(contrib.userId)?.push({
          dealId: deal.id,
          dealTitle: deal.title,
          clientName: deal.clientName,
          amount: deal.amount,
          marginAmount: deal.marginAmount,
          costAmount: deal.costAmount,
          valueUsed: valueField,
          share: contrib.share,
          contribution,
          source,
        });
      }
    }

    // 5. Construire le classement avec gestion des ex-aequo
    const userMap = new Map(allParticipants.map((u) => [u.id, u]));

    const sorted = [...scoreMap.entries()]
      .filter(([uid]) => userMap.has(uid))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); // tiebreak stable par id

    // Rang ex-aequo : même score = même rang
    const result: Array<{
      rank: number;
      user: { id: string; firstName: string; lastName: string; email: string };
      value: number;
      details?: Array<{
        dealId: string;
        dealTitle: string;
        clientName: string | null;
        amount: number;
        marginAmount: number | null;
        costAmount: number | null;
        valueUsed: number;
        share: number;
        contribution: number;
        source: string;
      }>;
    }> = [];
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      const [uid, value] = sorted[i];
      // Si ce n'est pas le premier et que le score est différent du précédent → nouveau rang
      if (i > 0 && sorted[i][1] < sorted[i - 1][1]) {
        currentRank = i + 1; // rang = position réelle (ex: 1,1,3 et non 1,1,2)
      }
      result.push({ rank: currentRank, user: userMap.get(uid)!, value, details: detailMap.get(uid) });
    }

    return result;
  },
};
