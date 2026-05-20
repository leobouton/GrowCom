import { prisma } from '../config/prisma';
import { commissionRepository } from '../repositories/commission.repository';
import { ruleAssignmentRepository } from '../repositories/ruleAssignment.repository';
import { dealAssignmentRepository } from '../repositories/dealAssignment.repository';
import { dealRepository } from '../repositories/deal.repository';
import { userRepository } from '../repositories/user.repository';
import { AppError } from '../middlewares/errorHandler';
import { CommissionStatus, CommissionRuleConfig, CommissionRuleType, UserRole } from '../../../shared/types';
// CommissionCalculationBasis importé via CommissionRuleConfig (optionnel)
import { CommissionStatus as PrismaCommissionStatus, UserRole as PrismaUserRole } from '@prisma/client';

// ─── Calcul du montant de commission ─────────────────────────────────────────

/**
 * Calcule le montant de commission sur la base donnée.
 * basisAmount = CA ou marge selon config.calculationBasis (déjà résolu par l'appelant).
 * Note : appelé sur le montant TOTAL avant split (Option A : cap sur total, puis split).
 */
export function calculateCommissionAmount(
  basisAmount: number,
  config: CommissionRuleConfig,
): { amount: number; explanation: string; skippedReason?: string } {
  const basisLabel = config.calculationBasis === 'MARGIN' ? 'Marge' : 'CA';

  // 1. Floor — seuil minimum du deal pour déclencher la règle
  if (config.floor !== undefined && config.floor !== null && basisAmount < config.floor) {
    return {
      amount: 0,
      explanation: `Sous le seuil minimum (${config.floor.toFixed(2)}€) : ${basisLabel} ${basisAmount.toFixed(2)}€`,
      skippedReason: 'BELOW_FLOOR',
    };
  }

  // 2. Calcul selon le type de règle
  let amount = 0;
  let explanation = '';

  if (config.type === CommissionRuleType.FIXED) {
    amount = config.fixedAmount ?? 0;
    explanation = `Commission fixe : ${amount.toFixed(2)}€`;
  } else if (config.type === CommissionRuleType.PERCENTAGE) {
    const rate = config.rate ?? 0;
    amount = basisAmount * rate;
    explanation = `${basisLabel} ${basisAmount.toFixed(2)}€ × ${(rate * 100).toFixed(0)}% = ${amount.toFixed(2)}€`;
  } else if (config.type === CommissionRuleType.TIERED && config.tiers) {
    let totalCommission = 0;
    const parts: string[] = [];
    const sortedTiers = [...config.tiers].sort((a, b) => a.min - b.min);

    for (const tier of sortedTiers) {
      if (basisAmount < tier.min) break;
      const tierMax = tier.max ?? Infinity;
      const applicable = Math.min(basisAmount, tierMax) - tier.min;
      if (applicable <= 0) continue;
      const tierAmount = applicable * tier.rate;
      totalCommission += tierAmount;
      parts.push(
        `${applicable.toFixed(2)}€ × ${(tier.rate * 100).toFixed(0)}% = ${tierAmount.toFixed(2)}€`,
      );
    }

    amount = totalCommission;
    explanation =
      parts.length > 0
        ? `${basisLabel} ${basisAmount.toFixed(2)}€ par paliers : ${parts.join(' + ')} = ${totalCommission.toFixed(2)}€`
        : `${basisLabel} ${basisAmount.toFixed(2)}€ — aucun palier atteint`;
  } else {
    return { amount: 0, explanation: 'Règle non reconnue' };
  }

  // 3. Cap — plafond absolu en €
  if (config.cap !== undefined && config.cap !== null && amount > config.cap) {
    explanation = `${explanation} (plafonné à ${config.cap.toFixed(2)}€)`;
    amount = config.cap;
  }

  return { amount, explanation };
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

    // Règle métier : validée = payée immédiatement (pas d'étape intermédiaire)
    return commissionRepository.updateStatus(commissionId, PrismaCommissionStatus.PAID, tenantId);
  },

  async markAsPaid(commissionId: string, tenantId: string, callerId: string, callerRole: UserRole) {
    const commission = await commissionRepository.findById(commissionId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.tenantId !== tenantId) throw new AppError(403, 'FORBIDDEN', 'Accès refusé');
    if (commission.status !== CommissionStatus.VALIDATED && commission.status !== CommissionStatus.PENDING) {
      throw new AppError(400, 'INVALID_STATUS', 'Commission déjà payée');
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

    // Période effective : mois en cours par défaut si aucune date fournie
    const now = new Date();
    const effectiveStart = startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const effectiveEnd = endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Stats globales (filtrées par équipe si TEAM_LEAD)
    const statsWhere = teamIds !== null
      ? { tenantId, userId: { in: teamIds } }
      : { tenantId };

    const [pendingAgg, validatedAgg, paidAgg] = await Promise.all([
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.PENDING }, _sum: { amount: true } }),
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.VALIDATED }, _sum: { amount: true } }),
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.PAID, paidAt: { gte: effectiveStart, lte: effectiveEnd } }, _sum: { amount: true } }),
    ]);
    // Note : les commissions CANCELLED sont exclues de tous ces aggregats (filtre par statut exact)

    // Récupérer les commerciaux dans le périmètre (jamais les managers dans ce résumé)
    const commercials = teamIds !== null
      ? await userRepository.findByIds(teamIds, tenantId)
      : await userRepository.findByTenantIdAndRoles(tenantId, COMMERCIAL_ROLES);

    // Récupérer les commissions du mois sélectionné (filtrées par validatedAt)
    const userIds = commercials.map((u) => u.id);
    const allCommissions = await commissionRepository.findByUserIdsInPeriod(userIds, tenantId, effectiveStart, effectiveEnd);

    // Grouper en mémoire par userId
    const commissionsByUser = new Map<string, typeof allCommissions>();
    for (const c of allCommissions) {
      const arr = commissionsByUser.get(c.userId) ?? [];
      arr.push(c);
      commissionsByUser.set(c.userId, arr);
    }

    const commercialsSummary = commercials.map((user) => {
      const userCommissions = commissionsByUser.get(user.id) ?? [];
      // Exclure les commissions CANCELLED des totaux (mais elles restent dans la liste détaillée)
      const activeCommissions = userCommissions.filter((c) => c.status !== CommissionStatus.CANCELLED);
      const totalCommissions = activeCommissions.reduce((sum, c) => sum + c.amount, 0);
      const pendingCount = activeCommissions.filter((c) => c.status === CommissionStatus.PENDING).length;

      return {
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
        totalCommissions,
        pendingCount,
      };
    });

    commercialsSummary.sort((a, b) => b.totalCommissions - a.totalCommissions);

    // Commissions en attente dans le périmètre
    const allPending = teamIds !== null
      ? await commissionRepository.findPendingByUserIds(teamIds, tenantId)
      : await commissionRepository.findPendingByTenantId(tenantId);

    // Commissions normales à valider manuellement (pas de paiement différé ou délai déjà dépassé)
    const pendingCommissions = allPending.filter(
      (c) => !c.scheduledPaymentAt || new Date(c.scheduledPaymentAt) <= now,
    );
    // Commissions différées : paiement programmé dans le futur
    const deferredCommissions = allPending.filter(
      (c) => c.scheduledPaymentAt && new Date(c.scheduledPaymentAt) > now,
    );
    const totalDeferredCommissions = deferredCommissions.reduce((sum, c) => sum + c.amount, 0);

    return {
      totalPendingCommissions: pendingAgg._sum.amount ?? 0,
      totalValidatedCommissions: validatedAgg._sum.amount ?? 0,
      totalPaidCommissions: paidAgg._sum.amount ?? 0,
      totalDeferredCommissions,
      commercialsSummary,
      pendingCommissions,
      deferredCommissions,
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

    const deferredCommissions = allCommissions.filter(
      (c) => c.status === CommissionStatus.PENDING && c.scheduledPaymentAt && new Date(c.scheduledPaymentAt) > now,
    );
    const totalDeferred = deferredCommissions.reduce((sum, c) => sum + c.amount, 0);

    const totalPending = allCommissions
      .filter((c) => c.status === CommissionStatus.PENDING && (!c.scheduledPaymentAt || new Date(c.scheduledPaymentAt) <= now))
      .reduce((sum, c) => sum + c.amount, 0);

    let projectedCommissions = 0;
    const projections = openDeals.map((deal) => {
      if (activeAssignments.length === 0) {
        return {
          deal: { id: deal.id, title: deal.title, clientName: deal.clientName ?? null, amount: deal.amount, probability: deal.probability },
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
        deal: { id: deal.id, title: deal.title, clientName: deal.clientName ?? null, amount: deal.amount, probability: deal.probability },
        projectedCommission: projected,
        explanation: ruleBreakdown.join(' | '),
      };
    });

    const fixedSalary = user?.fixedSalary ?? 0; // Salaire fixe BRUT MENSUEL en euros

    return {
      fixedSalary,
      totalEarnedThisMonth: totalEarned,
      totalMonthRevenue: fixedSalary + totalEarned,
      totalPendingValidation: totalPending,
      totalDeferredCommissions: totalDeferred,
      deferredCommissions,
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

  async markClientPaid(commissionId: string, tenantId: string, callerId: string, callerRole: UserRole) {
    const commission = await commissionRepository.findById(commissionId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.tenantId !== tenantId) throw new AppError(403, 'FORBIDDEN', 'Accès refusé');
    if (!commission.awaitingClientPayment) {
      throw new AppError(
        400,
        'NOT_AWAITING_CLIENT_PAYMENT',
        'Cette commission n\'est pas en attente de paiement client',
      );
    }

    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    // Récupère le délai de la règle pour savoir si on planifie ou on valide directement
    const paymentDelayDays = commission.rule?.paymentDelayDays ?? null;

    return commissionRepository.markClientPaid(commissionId, callerId, paymentDelayDays);
  },

  /**
   * Crée ou met à jour les commissions d'un deal WON.
   * - Applique les règles assignées à chaque commercial selon son DealAssignment.share.
   * - Fallback rétrocompatible : si aucun DealAssignment, utilise deal.assignedToId à 100%.
   * - N'applique PAS de règle "par défaut" : sans assignation de règle = pas de commission.
   * - Cap appliqué sur le total avant split (Option A).
   * - Supporte calculationBasis MARGIN/REVENUE et paymentTrigger CLIENT_PAID/DEAL_WON.
   */
  async recalculateForDeal(dealId: string, tenantId: string) {
    const deal = await dealRepository.findById(dealId);
    if (!deal || deal.tenantId !== tenantId) {
      throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal introuvable');
    }

    const dealAssignments = await dealAssignmentRepository.findByDealId(dealId, tenantId);

    let assignmentTargets: Array<{ userId: string; share: number; shareLabel: string }>;

    if (dealAssignments.length > 0) {
      assignmentTargets = dealAssignments.map((da) => ({
        userId: da.userId,
        share: da.share,
        shareLabel: `${(da.share * 100).toFixed(0)}%`,
      }));
    } else if (deal.assignedToId) {
      // Rétrocompat : pas de DealAssignment → commercial principal à 100%
      assignmentTargets = [{ userId: deal.assignedToId, share: 1.0, shareLabel: '100%' }];
    } else {
      return null;
    }

    const allResults = [];

    for (const target of assignmentTargets) {
      const activeAssignments = await ruleAssignmentRepository.findActiveForUser(
        target.userId,
        tenantId,
      );

      if (activeAssignments.length === 0) continue;

      for (const assignment of activeAssignments) {
        const config = assignment.rule.config as unknown as CommissionRuleConfig;

        // ── Choisir la base de calcul AVANT split (Option A : cap sur total) ──
        let fullBasisAmount: number;
        let basisLabel: string;

        if (config.calculationBasis === 'MARGIN') {
          if (deal.marginAmount === null || deal.marginAmount === undefined) {
            // Règle marge mais marginAmount inconnu → commission à 0€ visible manager
            const calculationDetail = `${assignment.rule.name} : Règle marge non applicable — marge inconnue sur ce deal`;
            const result = await commissionRepository.upsertForDeal(
              tenantId, target.userId, dealId, assignment.ruleId,
              0, calculationDetail, null, false,
            );
            allResults.push(result);
            continue;
          }
          fullBasisAmount = deal.marginAmount;
          basisLabel = 'marge';
        } else {
          // REVENUE ou non défini — comportement historique
          fullBasisAmount = deal.amount;
          basisLabel = 'CA';
        }

        // ── Calcul sur le total (floor/cap appliqués sur le total) ──
        const { amount: totalAmount, explanation, skippedReason } = calculateCommissionAmount(
          fullBasisAmount,
          config,
        );

        // Si floor non atteint → commission à 0€ visible
        if (skippedReason) {
          const calculationDetail = `${assignment.rule.name} : ${explanation}`;
          const result = await commissionRepository.upsertForDeal(
            tenantId, target.userId, dealId, assignment.ruleId,
            0, calculationDetail, null, false,
          );
          allResults.push(result);
          continue;
        }

        // ── Appliquer le share APRÈS le cap (Option A) ──
        const amount = totalAmount * target.share;
        const splitDetail = target.share < 1.0
          ? `Part ${target.shareLabel} sur ${basisLabel} ${fullBasisAmount.toFixed(2)}€ → `
          : '';
        const splitSuffix = target.share < 1.0
          ? ` × ${target.shareLabel} = ${amount.toFixed(2)}€`
          : '';
        const calculationDetail = `${splitDetail}${assignment.rule.name} : ${explanation}${splitSuffix}`;

        // ── paymentTrigger ──
        let scheduledPaymentAt: Date | null = null;
        let awaitingClientPayment = false;

        if (config.paymentTrigger === 'CLIENT_PAID') {
          awaitingClientPayment = true;
          // scheduledPaymentAt sera calculé quand le manager clique "Client a payé"
        } else {
          // DEAL_WON (défaut) — délai normal
          if (assignment.rule.paymentDelayDays && assignment.rule.paymentDelayDays > 0) {
            const baseDate = deal.closedAt ? new Date(deal.closedAt) : new Date();
            scheduledPaymentAt = new Date(baseDate);
            scheduledPaymentAt.setDate(scheduledPaymentAt.getDate() + assignment.rule.paymentDelayDays);
          }
        }

        const result = await commissionRepository.upsertForDeal(
          tenantId, target.userId, dealId, assignment.ruleId,
          amount, calculationDetail, scheduledPaymentAt, awaitingClientPayment,
        );
        allResults.push(result);
      }
    }

    return allResults[0] ?? null;
  },
};
