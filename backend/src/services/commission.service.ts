import { prisma } from '../config/prisma';
import { commissionRepository } from '../repositories/commission.repository';
import { ruleAssignmentRepository } from '../repositories/ruleAssignment.repository';
import { dealRepository } from '../repositories/deal.repository';
import { userRepository } from '../repositories/user.repository';
import { AppError } from '../middlewares/errorHandler';
import { CommissionStatus, CommissionRuleConfig, CommissionRuleType, UserRole } from '../../../shared/types';
import { CommissionStatus as PrismaCommissionStatus, UserRole as PrismaUserRole } from '@prisma/client';

// ─── Calcul du montant de commission ─────────────────────────────────────────

export function calculateCommissionAmount(
  saleAmount: number,
  config: CommissionRuleConfig,
): { amount: number; explanation: string } {
  if (config.type === CommissionRuleType.FIXED) {
    return {
      amount: config.fixedAmount ?? 0,
      explanation: `Commission fixe : ${(config.fixedAmount ?? 0).toFixed(2)}€`,
    };
  }

  if (config.type === CommissionRuleType.PERCENTAGE) {
    const rate = config.rate ?? 0;
    const amount = saleAmount * rate;
    return {
      amount,
      explanation: `${saleAmount.toFixed(2)}€ × ${(rate * 100).toFixed(0)}% = ${amount.toFixed(2)}€`,
    };
  }

  if (config.type === CommissionRuleType.TIERED && config.tiers) {
    let totalCommission = 0;
    const parts: string[] = [];

    for (const tier of config.tiers) {
      if (saleAmount <= tier.min) break;
      const tierMax = tier.max ?? Infinity;
      const applicable = Math.min(saleAmount, tierMax) - tier.min;
      if (applicable <= 0) continue;
      const tierAmount = applicable * tier.rate;
      totalCommission += tierAmount;
      parts.push(
        `${applicable.toFixed(2)}€ × ${(tier.rate * 100).toFixed(0)}% = ${tierAmount.toFixed(2)}€`,
      );
    }

    return {
      amount: totalCommission,
      explanation: parts.join(' + ') + ` = ${totalCommission.toFixed(2)}€`,
    };
  }

  return { amount: 0, explanation: 'Règle non reconnue' };
}

// ─── Helpers d'isolation par équipe ──────────────────────────────────────────

/**
 * Retourne les IDs des membres visibles pour le demandeur.
 *
 * Hiérarchie GrowCom :
 * - MANAGER (Directeur)            → accès total à tout le tenant (null = pas de filtre)
 * - BU_MANAGER                     → accès total à tout le tenant (null = pas de filtre)
 * - TEAM_LEAD (Responsable secteur)→ uniquement les commerciaux/recruteurs de son équipe
 * - SUPER_ADMIN                    → accès total (null = pas de filtre)
 */
async function resolveTeamScope(
  callerId: string,
  callerRole: UserRole,
  tenantId: string,
): Promise<string[] | null> {
  if (callerRole === UserRole.TEAM_LEAD) {
    // Responsable de secteur : voit et valide uniquement son équipe (commerciaux/recruteurs)
    const group = await prisma.group.findFirst({
      where: { leadId: callerId, tenantId },
      include: {
        members: {
          where: {
            isActive: true,
            role: { in: [PrismaUserRole.COMMERCIAL, PrismaUserRole.RECRUITER] },
          },
          select: { id: true },
        },
      },
    });
    return group?.members.map((m) => m.id) ?? [];
  }

  // MANAGER, BU_MANAGER, SUPER_ADMIN : accès total à tout le tenant
  return null;
}

/**
 * Vérifie que l'userId cible appartient bien au scope du demandeur.
 * Lance une AppError si l'accès est interdit.
 */
async function assertInScope(
  targetUserId: string,
  callerId: string,
  callerRole: UserRole,
  tenantId: string,
): Promise<void> {
  const teamIds = await resolveTeamScope(callerId, callerRole, tenantId);
  if (teamIds === null) return; // Accès total (MANAGER, BU_MANAGER, SUPER_ADMIN)
  if (!teamIds.includes(targetUserId)) {
    throw new AppError(403, 'FORBIDDEN', 'Ce commercial n\'appartient pas à votre équipe');
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

// Rôles considérés comme "commerciaux" pour les stats/résumés
const COMMERCIAL_ROLES = [PrismaUserRole.COMMERCIAL, PrismaUserRole.RECRUITER];

export const commissionService = {
  /** Vérifie publiquement que targetUserId est dans le périmètre du demandeur. */
  async assertUserInScope(
    targetUserId: string,
    callerId: string,
    callerRole: UserRole,
    tenantId: string,
  ): Promise<void> {
    return assertInScope(targetUserId, callerId, callerRole, tenantId);
  },

  async getByTenantId(tenantId: string) {
    return commissionRepository.findByTenantId(tenantId);
  },

  async getByUserId(userId: string, tenantId: string) {
    return commissionRepository.findByUserId(userId, tenantId);
  },

  async getPendingByTenantId(tenantId: string) {
    return commissionRepository.findPendingByTenantId(tenantId);
  },

  async validate(commissionId: string, tenantId: string, callerId: string, callerRole: UserRole) {
    const commission = await commissionRepository.findById(commissionId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.tenantId !== tenantId) throw new AppError(403, 'FORBIDDEN', 'Accès refusé');
    if (commission.status !== CommissionStatus.PENDING) {
      throw new AppError(400, 'INVALID_STATUS', 'Seules les commissions en attente peuvent être validées');
    }

    // Vérification de périmètre : TEAM_LEAD ne peut valider que son équipe
    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    return commissionRepository.updateStatus(commissionId, PrismaCommissionStatus.VALIDATED, tenantId);
  },

  async markAsPaid(commissionId: string, tenantId: string, callerId: string, callerRole: UserRole) {
    const commission = await commissionRepository.findById(commissionId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.tenantId !== tenantId) throw new AppError(403, 'FORBIDDEN', 'Accès refusé');
    if (commission.status !== CommissionStatus.VALIDATED) {
      throw new AppError(400, 'INVALID_STATUS', 'Seules les commissions validées peuvent être marquées comme payées');
    }

    // Vérification de périmètre : TEAM_LEAD ne peut payer que son équipe
    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    return commissionRepository.updateStatus(commissionId, PrismaCommissionStatus.PAID, tenantId);
  },

  async getManagerStats(
    tenantId: string,
    callerId: string,
    callerRole: UserRole,
    startDate?: Date,
    endDate?: Date,
  ) {
    const teamIds = await resolveTeamScope(callerId, callerRole, tenantId);

    // Stats globales (filtrées par équipe si TEAM_LEAD)
    const statsWhere = teamIds !== null
      ? { tenantId, userId: { in: teamIds } }
      : { tenantId };

    const [pendingAgg, validatedAgg, paidAgg] = await Promise.all([
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.PENDING }, _sum: { amount: true } }),
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.VALIDATED }, _sum: { amount: true } }),
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.PAID }, _sum: { amount: true } }),
    ]);

    // Récupérer les commerciaux dans le périmètre (jamais les managers dans ce résumé)
    const commercials = teamIds !== null
      ? await userRepository.findByIds(teamIds, tenantId)
      : await userRepository.findByTenantIdAndRoles(tenantId, COMMERCIAL_ROLES);

    // Résumé par commercial avec filtre de période optionnel
    const commercialsSummary = await Promise.all(
      commercials.map(async (user) => {
        const userCommissions = startDate && endDate
          ? await commissionRepository.findByUserIdInPeriod(user.id, tenantId, startDate, endDate)
          : await commissionRepository.findByUserId(user.id, tenantId);

        const totalCommissions = userCommissions.reduce((sum, c) => sum + c.amount, 0);
        const pendingCount = userCommissions.filter((c) => c.status === CommissionStatus.PENDING).length;

        return {
          user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
          totalCommissions,
          pendingCount,
        };
      }),
    );

    commercialsSummary.sort((a, b) => b.totalCommissions - a.totalCommissions);

    // Commissions en attente dans le périmètre
    const pending = teamIds !== null
      ? await commissionRepository.findPendingByUserIds(teamIds, tenantId)
      : await commissionRepository.findPendingByTenantId(tenantId);

    return {
      totalPendingCommissions: pendingAgg._sum.amount ?? 0,
      totalValidatedCommissions: validatedAgg._sum.amount ?? 0,
      totalPaidCommissions: paidAgg._sum.amount ?? 0,
      commercialsSummary,
      pendingCommissions: pending,
    };
  },

  async getCommercialStats(userId: string, tenantId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [totalEarned, allCommissions, openDeals, user, activeAssignments, wonDeals] = await Promise.all([
      commissionRepository.sumByUserAndMonth(userId, tenantId, startOfMonth, endOfMonth),
      commissionRepository.findByUserId(userId, tenantId),
      dealRepository.findOpenByUserId(userId, tenantId),
      userRepository.findById(userId),
      ruleAssignmentRepository.findActiveForUser(userId, tenantId),
      dealRepository.findWonByUserId(userId, tenantId),
    ]);

    const totalPending = allCommissions
      .filter((c) => c.status === CommissionStatus.PENDING)
      .reduce((sum, c) => sum + c.amount, 0);

    let projectedCommissions = 0;
    const projections = openDeals.map((deal) => {
      if (activeAssignments.length === 0) {
        return {
          deal: { id: deal.id, title: deal.title, amount: deal.amount, probability: deal.probability },
          projectedCommission: 0,
          explanation: 'Aucune règle de commission assignée',
        };
      }

      let projected = 0;
      const ruleBreakdown: string[] = [];

      for (const assignment of activeAssignments) {
        const config = assignment.rule.config as unknown as CommissionRuleConfig;
        const result = calculateCommissionAmount(deal.amount, config);
        projected += result.amount;
        ruleBreakdown.push(`${assignment.rule.name} : ${result.explanation}`);
      }

      projectedCommissions += projected;

      return {
        deal: { id: deal.id, title: deal.title, amount: deal.amount, probability: deal.probability },
        projectedCommission: projected,
        explanation: ruleBreakdown.join(' | '),
      };
    });

    const fixedSalary = user?.fixedSalary ?? 0;

    return {
      fixedSalary,
      totalEarnedThisMonth: totalEarned,
      totalMonthRevenue: fixedSalary + totalEarned,
      totalPendingValidation: totalPending,
      projectedCommissions,
      projections,
      commissions: allCommissions,
      wonDeals: wonDeals.map((d) => ({
        id: d.id,
        title: d.title,
        amount: d.amount,
        closedAt: d.closedAt?.toISOString() ?? null,
        syncedAt: d.syncedAt?.toISOString() ?? null,
      })),
    };
  },

  /**
   * Crée ou met à jour les commissions d'un deal WON.
   * - Applique uniquement les règles explicitement assignées au commercial.
   * - N'applique PAS de règle "par défaut" : sans assignation = pas de commission.
   * - Stocke le détail du calcul pour affichage côté commercial.
   */
  async recalculateForDeal(dealId: string, tenantId: string) {
    const deal = await dealRepository.findById(dealId);
    if (!deal || deal.tenantId !== tenantId) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal introuvable');
    }

    if (!deal.assignedToId) return null;

    const activeAssignments = await ruleAssignmentRepository.findActiveForUser(
      deal.assignedToId,
      tenantId,
    );

    // Aucune règle assignée → pas de commission créée (pas de fallback dangereux)
    if (activeAssignments.length === 0) return null;

    const results = await Promise.all(
      activeAssignments.map(async (assignment) => {
        const config = assignment.rule.config as unknown as CommissionRuleConfig;
        const { amount, explanation } = calculateCommissionAmount(deal.amount, config);
        return commissionRepository.upsertForDeal(
          tenantId,
          deal.assignedToId!,
          dealId,
          assignment.ruleId,
          amount,
          `${assignment.rule.name} : ${explanation}`,
        );
      }),
    );

    return results[0] ?? null;
  },
};
