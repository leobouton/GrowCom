import { prisma } from '../config/prisma';
import { commissionRepository } from '../repositories/commission.repository';
import { ruleAssignmentRepository } from '../repositories/ruleAssignment.repository';
import { dealAssignmentRepository } from '../repositories/dealAssignment.repository';
import { dealRepository } from '../repositories/deal.repository';
import { missionRepository } from '../repositories/mission.repository';
import { userRepository } from '../repositories/user.repository';
import { commissionAdjustmentRepository } from '../repositories/commissionAdjustment.repository';
import { commissionDisputeRepository } from '../repositories/commissionDispute.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { AppError } from '../middlewares/errorHandler';
import { CommissionStatus, CommissionRuleConfig, CommissionRuleType, UserRole, RecurringProjection } from '../../../shared/types';
// CommissionCalculationBasis importé via CommissionRuleConfig (optionnel)
import { CommissionStatus as PrismaCommissionStatus, UserRole as PrismaUserRole, DealStatus as PrismaDealStatus } from '@prisma/client';

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
  const basisLabel =
    config.calculationBasis === 'MARGIN' ? 'Marge'
    : config.calculationBasis === 'PER_UNIT' ? 'Forfait'
    : 'CA';

  // 1. Floor — seuil minimum pour déclencher la règle
  // (pour PER_UNIT, basisAmount = nb de consultants ; le floor devient un nb minimum)
  if (config.floor !== undefined && config.floor !== null && basisAmount < config.floor) {
    return {
      amount: 0,
      explanation: `Sous le seuil minimum (${config.floor.toFixed(2)}) : ${basisLabel} ${basisAmount.toFixed(2)}`,
      skippedReason: 'BELOW_FLOOR',
    };
  }

  // 2. Calcul selon le type de règle
  let amount = 0;
  let explanation = '';

  // Base "forfait par unité" (Session F) : montant fixe × nb de consultants placés.
  // basisAmount porte ici le nb de consultants. Prioritaire sur le type de règle.
  if (config.calculationBasis === 'PER_UNIT') {
    const unit = config.fixedAmount ?? 0;
    amount = unit * basisAmount;
    explanation = `${basisAmount} consultant${basisAmount > 1 ? 's' : ''} × ${unit.toFixed(2)}€ = ${amount.toFixed(2)}€`;
  } else if (config.type === CommissionRuleType.FIXED) {
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

// ─── Résolution de la base de calcul (event deal OU mission) ─────────────────

/**
 * Entrée générique du moteur : facts d'un CommissionableEvent, qu'il vienne d'un
 * deal WON (amount/margin) ou d'un mois de mission (monthlyAmount/margin/consultants).
 */
export interface CommissionBasisInput {
  amount: number;             // base CA/revenu (deal.amount ou mission.monthlyAmount)
  marginAmount?: number | null;
  costAmount?: number | null;
  unitCount?: number | null;  // nb de consultants placés (forfait)
}

/**
 * Résout la base de calcul selon config.calculationBasis.
 * - PER_UNIT : nb de consultants placés
 * - MARGIN   : marge fournie, sinon amount - coût, sinon amount (comportement deal existant)
 * - REVENUE  : amount
 */
export function resolveBasisAmount(
  config: CommissionRuleConfig,
  input: CommissionBasisInput,
): { basisAmount: number; basisLabel: string } {
  if (config.calculationBasis === 'PER_UNIT') {
    return { basisAmount: input.unitCount ?? 0, basisLabel: 'consultants' };
  }
  if (config.calculationBasis === 'MARGIN') {
    let margin: number;
    if (input.marginAmount !== null && input.marginAmount !== undefined) {
      margin = input.marginAmount;
    } else if (input.costAmount !== null && input.costAmount !== undefined) {
      margin = input.amount - input.costAmount;
    } else {
      margin = input.amount;
    }
    return { basisAmount: margin, basisLabel: 'marge' };
  }
  return { basisAmount: input.amount, basisLabel: 'CA' };
}

/**
 * Agrégation d'un plan = SOMME de ses composants (v1). L'opérateur est isolé ici
 * pour rester extensible (max, moyenne pondérée…) sans toucher aux appelants.
 * Chaque composant est calculé sur la base résolue puis multiplié par la part (share).
 * Cap appliqué par composant avant le share (Option A, cohérent avec l'existant).
 */
export function computePlanComponentsAmount(
  configs: CommissionRuleConfig[],
  input: CommissionBasisInput,
  share = 1,
): { total: number; breakdown: Array<{ amount: number; explanation: string; skippedReason?: string }> } {
  let total = 0;
  const breakdown: Array<{ amount: number; explanation: string; skippedReason?: string }> = [];
  for (const config of configs) {
    const { basisAmount } = resolveBasisAmount(config, input);
    const res = calculateCommissionAmount(basisAmount, config);
    const amount = res.amount * share;
    total += amount;
    breakdown.push({ amount, explanation: res.explanation, skippedReason: res.skippedReason });
  }
  return { total, breakdown };
}

// ─── Résolution template + override (assignation) ────────────────────────────

/**
 * Paramètres surchargeables par assignation. Les champs sémantiques (type,
 * calculationBasis, appliesToEventType, description, examples) ne le sont PAS :
 * un override ne change que les valeurs numériques du barème.
 */
const OVERRIDABLE_KEYS = ['rate', 'fixedAmount', 'cap', 'floor', 'tiers'] as const;

/**
 * Applique un override d'assignation sur la config de base d'une règle.
 * Retourne une NOUVELLE config (ne mute pas la base). Seuls les champs surchargeables
 * présents dans l'override sont remplacés.
 */
export function resolveEffectiveConfig(
  baseConfig: CommissionRuleConfig,
  overrides?: Partial<CommissionRuleConfig> | null,
): CommissionRuleConfig {
  if (!overrides) return baseConfig;
  const effective: CommissionRuleConfig = { ...baseConfig };
  for (const key of OVERRIDABLE_KEYS) {
    const value = overrides[key];
    if (value !== undefined && value !== null) {
      // Réaffectation champ à champ ; les clés sont contraintes à OVERRIDABLE_KEYS
      (effective as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return effective;
}

/** Lit et type l'override d'une assignation (colonne JSON Prisma). */
function readOverrides(overrides: unknown): Partial<CommissionRuleConfig> | null {
  return (overrides as Partial<CommissionRuleConfig> | null) ?? null;
}

// ─── Projection du récurrent (missions actives d'un commercial) ─────────────

/** Nombre de mois restants (arrondi au supérieur) avant la fin prévue, ou null si indéterminée. */
function monthsRemaining(now: Date, end: Date | null): number | null {
  if (!end) return null;
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * Calcule le récurrent projeté d'un commercial : pour chaque mission active, la commission
 * mensuelle estimée (règles MISSION_MONTH assignées) et les mois restants tant que la
 * mission tourne. Réutilise le moteur généralisé (computePlanComponentsAmount).
 */
export async function getRecurringProjectionForUser(
  userId: string,
  tenantId: string,
  now: Date = new Date(),
): Promise<RecurringProjection> {
  const missions = await missionRepository.findActiveWithDealByUserId(userId, tenantId);
  if (missions.length === 0) {
    return { monthlyTotal: 0, activeMissionCount: 0, missions: [] };
  }

  const assignments = await ruleAssignmentRepository.findActiveForUser(userId, tenantId);
  const missionConfigs = assignments
    .map((a) => resolveEffectiveConfig(a.rule.config as unknown as CommissionRuleConfig, readOverrides(a.overrides)))
    .filter((c) => c.appliesToEventType === 'MISSION_MONTH');

  let monthlyTotal = 0;
  const list = missions.map((m) => {
    const { total } = computePlanComponentsAmount(missionConfigs, {
      amount: m.monthlyAmount,
      marginAmount: m.marginAmount,
      unitCount: m.consultantCount,
    });
    monthlyTotal += total;
    const remaining = monthsRemaining(now, m.expectedEndDate);
    return {
      missionId: m.id,
      dealId: m.dealId,
      dealTitle: m.deal.title,
      clientName: m.deal.clientName,
      monthlyCommission: total,
      monthlyAmount: m.monthlyAmount,
      consultantCount: m.consultantCount,
      startDate: m.startDate.toISOString(),
      expectedEndDate: m.expectedEndDate ? m.expectedEndDate.toISOString() : null,
      monthsRemaining: remaining,
      projectedRemaining: remaining !== null ? total * remaining : null,
    };
  });

  return { monthlyTotal, activeMissionCount: missions.length, missions: list };
}

// ─── Helpers d'isolation par équipe ──────────────────────────────────────────

/**
 * Retourne les IDs des membres visibles pour le demandeur.
 *
 * Hiérarchie GrowCom :
 * - MANAGER (Directeur)            → accès total à tout le tenant (null = pas de filtre)
 * - TEAM_LEAD (Responsable secteur)→ uniquement les commerciaux/recruteurs de son équipe (leadId)
 * - BU_MANAGER                     → uniquement les équipes qu'il supervise (managerId)
 * - MANAGER                        → uniquement son équipe s'il en a une (leadId ou managerId), sinon accès total
 * - SUPER_ADMIN                    → accès total (null = pas de filtre)
 */
export async function resolveTeamScope(
  callerId: string,
  callerRole: UserRole,
  tenantId: string,
): Promise<string[] | null> {
  const memberFilter = {
    where: {
      isActive: true,
      role: { in: [PrismaUserRole.COMMERCIAL, PrismaUserRole.RECRUITER, PrismaUserRole.TEAM_LEAD] },
    },
    select: { id: true },
  };

  if (callerRole === UserRole.TEAM_LEAD) {
    // Responsable de secteur : voit et valide son équipe + ses propres ventes
    const group = await prisma.group.findFirst({
      where: { leadId: callerId, tenantId },
      include: { members: memberFilter },
    });
    const memberIds = group?.members.map((m) => m.id) ?? [];
    // Inclure le TEAM_LEAD lui-même pour qu'il voie ses propres commissions/ventes
    if (!memberIds.includes(callerId)) {
      memberIds.push(callerId);
    }
    return memberIds;
  }

  if (callerRole === UserRole.BU_MANAGER) {
    // Directeur régional : voit les équipes qu'il supervise (managerId)
    const groups = await prisma.group.findMany({
      where: { managerId: callerId, tenantId },
      include: { members: memberFilter },
    });
    if (groups.length === 0) return [];
    const ids = new Set<string>();
    for (const g of groups) {
      // Inclure le TEAM_LEAD (leadId) du groupe, pas seulement les membres
      if (g.leadId) ids.add(g.leadId);
      for (const m of g.members) ids.add(m.id);
    }
    return [...ids];
  }

  if (callerRole === UserRole.MANAGER) {
    // Manager général : accès total à tous les commerciaux du tenant
    return null;
  }

  // SUPER_ADMIN : accès total à tout le tenant
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
  if (teamIds === null) return; // Accès total (SUPER_ADMIN, ou MANAGER sans équipe)
  if (!teamIds.includes(targetUserId)) {
    throw new AppError(403, 'FORBIDDEN', 'Ce commercial n\'appartient pas à votre équipe');
  }
}

/**
 * Règle métier : TOUTES les ventes des responsables de secteur (TEAM_LEAD) doivent
 * être validées par le manager général (MANAGER) ou un SUPER_ADMIN.
 * Un TEAM_LEAD ou BU_MANAGER ne peut pas valider les commissions d'un autre TEAM_LEAD.
 */
async function assertTeamLeadValidationRestriction(
  commissionUserId: string,
  callerRole: UserRole,
  tenantId: string,
): Promise<void> {
  if (callerRole === UserRole.MANAGER || callerRole === UserRole.SUPER_ADMIN) return;

  // Vérifie si le commercial de cette commission est un TEAM_LEAD
  const targetUser = await userRepository.findById(commissionUserId);
  if (!targetUser || targetUser.tenantId !== tenantId) return;

  if (targetUser.role === PrismaUserRole.TEAM_LEAD) {
    throw new AppError(
      403,
      'TEAM_LEAD_VALIDATION_RESTRICTED',
      'Les ventes des responsables de secteur doivent être validées par le manager général',
    );
  }
}

/**
 * Retourne l'ID d'une règle système "placeholder" (0 €, archivée, invisible dans l'UI)
 * utilisée pour créer des commissions à 0 € sur les deals des TEAM_LEAD sans règle assignée.
 * Permet au deal de passer par le flux de validation manager.
 */
const TEAM_LEAD_PLACEHOLDER_RULE_NAME = '__SYSTEM_TEAM_LEAD_PLACEHOLDER__';

async function getOrCreatePlaceholderRuleId(tenantId: string, createdBy: string): Promise<string> {
  const existing = await prisma.commissionRule.findFirst({
    where: { tenantId, name: TEAM_LEAD_PLACEHOLDER_RULE_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  const rule = await prisma.commissionRule.create({
    data: {
      tenantId,
      name: TEAM_LEAD_PLACEHOLDER_RULE_NAME,
      description: 'Règle système : validation obligatoire des ventes responsable de secteur',
      type: 'FIXED',
      config: {
        type: 'FIXED',
        fixedAmount: 0,
        description: 'Pas de règle de commission — validation manager requise',
        examples: [],
      },
      scope: 'GLOBAL',
      isActive: false,
      isArchived: true,
      createdBy,
    },
  });
  return rule.id;
}

// ─── Service ──────────────────────────────────────────────────────────────────

// Rôles considérés comme "commerciaux" pour les stats/résumés
// TEAM_LEAD inclus car dans certaines structures les responsables de secteur réalisent encore des ventes
const COMMERCIAL_ROLES = [PrismaUserRole.COMMERCIAL, PrismaUserRole.RECRUITER, PrismaUserRole.TEAM_LEAD];

export const commissionService = {
  async findById(id: string, tenantId: string) {
    const commission = await commissionRepository.findById(id, tenantId);
    if (!commission) return null;
    return commission;
  },

  async delete(id: string, tenantId: string) {
    await commissionRepository.delete(id, tenantId);
  },

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
    const commission = await commissionRepository.findById(commissionId, tenantId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.status !== CommissionStatus.PENDING) {
      throw new AppError(400, 'INVALID_STATUS', 'Seules les commissions en attente peuvent être validées');
    }

    // Vérification de périmètre : TEAM_LEAD ne peut valider que son équipe
    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    // Règle métier : les ventes des responsables de secteur doivent être validées par le manager général
    await assertTeamLeadValidationRestriction(commission.userId, callerRole, tenantId);

    // Règle métier : validée = payée immédiatement (pas d'étape intermédiaire)
    return commissionRepository.updateStatus(commissionId, PrismaCommissionStatus.PAID, tenantId);
  },

  async markAsPaid(commissionId: string, tenantId: string, callerId: string, callerRole: UserRole) {
    const commission = await commissionRepository.findById(commissionId, tenantId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.status !== CommissionStatus.VALIDATED && commission.status !== CommissionStatus.PENDING) {
      throw new AppError(400, 'INVALID_STATUS', 'Commission déjà payée');
    }

    // Vérification de périmètre : TEAM_LEAD ne peut payer que son équipe
    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    // Règle métier : les ventes des responsables de secteur doivent être validées par le manager général
    await assertTeamLeadValidationRestriction(commission.userId, callerRole, tenantId);

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

    // Stats globales (filtrées par équipe si TEAM_LEAD, BU_MANAGER, ou MANAGER avec équipe)
    const statsWhere = teamIds !== null
      ? { tenantId, userId: { in: teamIds } }
      : { tenantId };

    const [pendingAgg, validatedAgg, paidAgg] = await Promise.all([
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.PENDING }, _sum: { amount: true } }),
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.VALIDATED }, _sum: { amount: true } }),
      prisma.commission.aggregate({ where: { ...statsWhere, status: PrismaCommissionStatus.PAID, paidAt: { gte: effectiveStart, lte: effectiveEnd } }, _sum: { amount: true } }),
    ]);
    // Note : les commissions CANCELLED sont exclues de tous ces aggregats (filtre par statut exact)

    // Classement "Meilleurs vendeurs" :
    // - MANAGER / SUPER_ADMIN → tous les commerciaux de l'entreprise
    // - TEAM_LEAD / BU_MANAGER → uniquement les commerciaux de leur périmètre
    const rankingShowsAll = callerRole === UserRole.MANAGER || callerRole === UserRole.SUPER_ADMIN;
    const commercials = rankingShowsAll
      ? await userRepository.findByTenantIdAndRoles(tenantId, COMMERCIAL_ROLES)
      : teamIds !== null
        ? await userRepository.findByIds(teamIds, tenantId)
        : await userRepository.findByTenantIdAndRoles(tenantId, COMMERCIAL_ROLES);

    const userIds = commercials.map((u) => u.id);

    // Récupérer les deals WON dans la période pour le classement par CA
    const wonDealsInPeriod = userIds.length > 0
      ? await prisma.deal.findMany({
          where: {
            tenantId,
            status: PrismaDealStatus.WON,
            closedAt: { gte: effectiveStart, lte: effectiveEnd },
            OR: [
              { assignedToId: { in: userIds } },
              { assignments: { some: { userId: { in: userIds } } } },
            ],
          },
          include: {
            assignments: {
              where: { userId: { in: userIds } },
              select: { userId: true, share: true },
            },
          },
        })
      : [];

    // Calculer le CA par user (en tenant compte des splits via DealAssignment)
    const revenueByUser = new Map<string, number>();
    const dealCountByUser = new Map<string, number>();
    for (const deal of wonDealsInPeriod) {
      if (deal.assignments.length > 0) {
        // Deal splitté : chaque participant reçoit sa part
        for (const da of deal.assignments) {
          revenueByUser.set(da.userId, (revenueByUser.get(da.userId) ?? 0) + deal.amount * da.share);
          dealCountByUser.set(da.userId, (dealCountByUser.get(da.userId) ?? 0) + 1);
        }
      } else if (deal.assignedToId && userIds.includes(deal.assignedToId)) {
        // Deal non splitté : 100% pour le commercial assigné
        revenueByUser.set(deal.assignedToId, (revenueByUser.get(deal.assignedToId) ?? 0) + deal.amount);
        dealCountByUser.set(deal.assignedToId, (dealCountByUser.get(deal.assignedToId) ?? 0) + 1);
      }
    }

    // Récupérer les commissions pour les infos en attente
    const allCommissions = await commissionRepository.findByUserIdsInPeriod(userIds, tenantId, effectiveStart, effectiveEnd);
    const commissionsByUser = new Map<string, typeof allCommissions>();
    for (const c of allCommissions) {
      const arr = commissionsByUser.get(c.userId) ?? [];
      arr.push(c);
      commissionsByUser.set(c.userId, arr);
    }

    const commercialsSummary = commercials.map((user) => {
      const userCommissions = commissionsByUser.get(user.id) ?? [];
      const activeCommissions = userCommissions.filter((c) => c.status !== CommissionStatus.CANCELLED);
      const totalCommissions = activeCommissions.reduce((sum, c) => sum + c.amount, 0);
      const pendingCount = activeCommissions.filter((c) => c.status === CommissionStatus.PENDING).length;

      return {
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
        totalRevenue: revenueByUser.get(user.id) ?? 0,
        dealCount: dealCountByUser.get(user.id) ?? 0,
        totalCommissions,
        pendingCount,
      };
    });

    commercialsSummary.sort((a, b) => b.totalRevenue - a.totalRevenue);

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

    // Commissions récemment traitées (validées/payées) dans la période — pour permettre la révocation
    const recentlyProcessedWhere = {
      ...statsWhere,
      status: { in: [PrismaCommissionStatus.VALIDATED, PrismaCommissionStatus.PAID] },
      OR: [
        { validatedAt: { gte: effectiveStart, lte: effectiveEnd } },
        { paidAt: { gte: effectiveStart, lte: effectiveEnd } },
      ],
    };
    const recentlyProcessedCommissions = await prisma.commission.findMany({
      where: recentlyProcessedWhere,
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { validatedAt: 'desc' },
      take: 50,
    });

    const [openDisputeCount, totalAdjustmentsThisPeriod] = await Promise.all([
      commissionDisputeRepository.countOpen(tenantId),
      commissionAdjustmentRepository.sumByTenantAndPeriod(tenantId, effectiveStart, effectiveEnd),
    ]);

    return {
      totalPendingCommissions: pendingAgg._sum.amount ?? 0,
      totalValidatedCommissions: validatedAgg._sum.amount ?? 0,
      totalPaidCommissions: paidAgg._sum.amount ?? 0,
      totalDeferredCommissions,
      commercialsSummary,
      pendingCommissions,
      deferredCommissions,
      recentlyProcessedCommissions,
      openDisputeCount,
      totalAdjustmentsThisPeriod,
    };
  },

  async getCommercialStats(userId: string, tenantId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [totalEarned, allCommissions, openDeals, user, activeAssignments, wonDealsForObjectives, adjustments] = await Promise.all([
      commissionRepository.sumByUserAndMonth(userId, tenantId, startOfMonth, endOfMonth),
      commissionRepository.findByUserId(userId, tenantId),
      dealRepository.findOpenByUserId(userId, tenantId),
      userRepository.findById(userId),
      ruleAssignmentRepository.findActiveForUser(userId, tenantId),
      // Chantier 1 : utilise findWonForObjectives pour exclure les deals avec commission CANCELLED
      // et récupérer le share du DealAssignment pour les splits
      dealRepository.findWonForObjectives(userId, tenantId),
      commissionAdjustmentRepository.findByUserId(userId, tenantId),
    ]);

    const deferredCommissions = allCommissions.filter(
      (c) => c.status === CommissionStatus.PENDING && c.scheduledPaymentAt && new Date(c.scheduledPaymentAt) > now,
    );
    const totalDeferred = deferredCommissions.reduce((sum, c) => sum + c.amount, 0);

    const totalPending = allCommissions
      .filter((c) => c.status === CommissionStatus.PENDING && (!c.scheduledPaymentAt || new Date(c.scheduledPaymentAt) <= now))
      .reduce((sum, c) => sum + c.amount, 0);

    // Projections des deals ouverts : seules les règles DEAL_WON s'appliquent (pas le récurrent).
    const dealWonAssignments = activeAssignments.filter((a) => {
      const cfg = a.rule.config as unknown as CommissionRuleConfig;
      return (cfg.appliesToEventType ?? 'DEAL_WON') === 'DEAL_WON';
    });

    let projectedCommissions = 0;
    const projections = openDeals.map((deal) => {
      if (dealWonAssignments.length === 0) {
        return {
          deal: { id: deal.id, title: deal.title, clientName: deal.clientName ?? null, amount: deal.amount, probability: deal.probability },
          projectedCommission: 0,
          explanation: 'Aucune règle de commission assignée',
        };
      }

      let projected = 0;
      const ruleBreakdown: string[] = [];

      for (const assignment of dealWonAssignments) {
        const config = resolveEffectiveConfig(
          assignment.rule.config as unknown as CommissionRuleConfig,
          readOverrides(assignment.overrides),
        );
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

    // Enrichir les commissions avec leur dispute (ouvert ou résolu le plus récent)
    const commissionIds = allCommissions.map((c) => c.id);
    const allDisputes = commissionIds.length > 0
      ? await prisma.commissionDispute.findMany({
          where: { commissionId: { in: commissionIds }, tenantId },
          select: { id: true, commissionId: true, status: true, managerResponse: true, reason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    // On garde le dispute le plus récent par commission
    const disputeByCommission = new Map<string, typeof allDisputes[number]>();
    for (const d of allDisputes) {
      if (!disputeByCommission.has(d.commissionId)) {
        disputeByCommission.set(d.commissionId, d);
      }
    }

    const commissionsWithDispute = allCommissions.map((c) => {
      const d = disputeByCommission.get(c.id);
      return {
        ...c,
        dispute: d ? { id: d.id, status: d.status, managerResponse: d.managerResponse, reason: d.reason } : null,
      };
    });

    // Récurrent ESN : commissions mensuelles projetées des missions actives
    const recurring = await getRecurringProjectionForUser(userId, tenantId, now);

    return {
      fixedSalary,
      totalEarnedThisMonth: totalEarned,
      totalMonthRevenue: fixedSalary + totalEarned,
      totalPendingValidation: totalPending,
      totalDeferredCommissions: totalDeferred,
      deferredCommissions,
      projectedCommissions,
      projections,
      recurring,
      commissions: commissionsWithDispute,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        tenantId: a.tenantId,
        userId: a.userId,
        originalCommissionId: a.originalCommissionId ?? null,
        amount: a.amount,
        reason: a.reason,
        status: a.status,
        createdBy: a.createdBy,
        createdAt: a.createdAt.toISOString(),
        paidAt: a.paidAt?.toISOString() ?? null,
      })),
      // Chantier 1 : wonDeals filtrés (excluant commission CANCELLED) avec share et marge
      // pour le calcul d'objectifs côté frontend
      wonDeals: wonDealsForObjectives.map((d) => ({
        id: d.id,
        title: d.title,
        clientName: d.clientName ?? null,
        amount: d.amount,
        marginAmount: d.marginAmount ?? null,
        userShare: d.userShare,
        closedAt: d.closedAt?.toISOString() ?? null,
        syncedAt: d.syncedAt?.toISOString() ?? null,
      })),
    };
  },

  async markClientPaid(commissionId: string, tenantId: string, callerId: string, callerRole: UserRole) {
    const commission = await commissionRepository.findById(commissionId, tenantId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (!commission.awaitingClientPayment) {
      throw new AppError(
        400,
        'NOT_AWAITING_CLIENT_PAYMENT',
        'Cette commission n\'est pas en attente de paiement client',
      );
    }

    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    // Règle métier : les ventes des responsables de secteur doivent être validées par le manager général
    await assertTeamLeadValidationRestriction(commission.userId, callerRole, tenantId);

    // Récupère le délai de la règle pour savoir si on planifie ou on valide directement
    const paymentDelayDays = commission.rule?.paymentDelayDays ?? null;

    return commissionRepository.markClientPaid(commissionId, tenantId, callerId, paymentDelayDays);
  },

  /**
   * Révoque la validation d'une commission : la remet en PENDING.
   * Si la commission était PAID, crée un CommissionAdjustment négatif (clawback).
   * Motif obligatoire pour traçabilité.
   */
  async revertToPending(
    commissionId: string,
    tenantId: string,
    callerId: string,
    callerRole: UserRole,
    reason: string,
  ) {
    const commission = await commissionRepository.findById(commissionId, tenantId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');

    if (commission.status !== CommissionStatus.VALIDATED && commission.status !== CommissionStatus.PAID) {
      throw new AppError(400, 'INVALID_STATUS', 'Seules les commissions validées ou payées peuvent être révoquées');
    }
    if (!reason.trim()) {
      throw new AppError(400, 'REASON_REQUIRED', 'Le motif de révocation est requis');
    }

    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    const wasPaid = commission.status === CommissionStatus.PAID;

    // Remettre en PENDING (effacer les dates de validation/paiement)
    const reverted = await prisma.commission.update({
      where: { id: commissionId, tenantId },
      data: {
        status: PrismaCommissionStatus.PENDING,
        validatedAt: null,
        paidAt: null,
      },
    });

    // Clawback si la commission était payée
    let adjustment = null;
    if (wasPaid) {
      adjustment = await commissionAdjustmentRepository.create({
        tenantId,
        userId: commission.userId,
        originalCommissionId: commissionId,
        amount: -commission.amount,
        reason: `Clawback suite à révocation : ${reason.trim()}`,
        createdBy: callerId,
      });
    }

    await auditLogRepository.create({
      tenantId,
      userId: callerId,
      action: 'COMMISSION_REVERTED',
      entity: 'Commission',
      entityId: commissionId,
      metadata: {
        previousStatus: wasPaid ? 'PAID' : 'VALIDATED',
        reason: reason.trim(),
        wasPaid,
        clawbackId: adjustment?.id ?? null,
      },
    });

    return { commission: reverted, adjustment };
  },

  /**
   * Annule une commission. Si déjà PAID, crée un CommissionAdjustment négatif (clawback).
   * Si cancelDeal=true et qu'aucune autre commission active n'existe sur le deal, passe le deal en LOST.
   */
  async cancel(
    commissionId: string,
    tenantId: string,
    callerId: string,
    callerRole: UserRole,
    reason: string,
    options?: { cancelDeal?: boolean },
  ) {
    const commission = await commissionRepository.findById(commissionId, tenantId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.status === CommissionStatus.CANCELLED) {
      throw new AppError(400, 'ALREADY_CANCELLED', 'Cette commission est déjà annulée');
    }
    if (!reason.trim()) {
      throw new AppError(400, 'REASON_REQUIRED', 'Le motif d\'annulation est requis');
    }

    await assertInScope(commission.userId, callerId, callerRole, tenantId);

    const wasPaid = commission.status === CommissionStatus.PAID;

    // Annulation de la commission
    const cancelled = await prisma.commission.update({
      where: { id: commissionId, tenantId },
      data: {
        status: PrismaCommissionStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: callerId,
        cancellationReason: reason.trim(),
      },
    });

    // Clawback si la commission était déjà payée
    let adjustment = null;
    if (wasPaid) {
      adjustment = await commissionAdjustmentRepository.create({
        tenantId,
        userId: commission.userId,
        originalCommissionId: commissionId,
        amount: -commission.amount,
        reason: `Clawback (récupération) suite à annulation : ${reason.trim()}`,
        createdBy: callerId,
      });
    }

    // Annulation du deal si demandée (seulement si aucune autre commission active sur ce deal)
    if (options?.cancelDeal) {
      const otherActiveCommissions = await prisma.commission.count({
        where: {
          dealId: commission.dealId,
          tenantId,
          status: { notIn: [PrismaCommissionStatus.CANCELLED] },
          id: { not: commissionId },
        },
      });

      if (otherActiveCommissions === 0) {
        await dealRepository.updateStatus(commission.dealId, tenantId, PrismaDealStatus.LOST);
      } else {
        // Log silencieux : deal partagé, on ne le marque pas LOST
        console.warn(
          `[CommissionService] cancelDeal ignoré : ${otherActiveCommissions} autre(s) commission(s) active(s) sur le deal ${commission.dealId}`,
        );
      }
    }

    // Chantier 2 — Propagation de l'annulation aux objectifs/concours
    // Détermine si le deal est du mois en cours pour décider si on recalcule ou si on préserve le snapshot
    const deal = await dealRepository.findById(commission.dealId, tenantId);
    const now = new Date();
    const dealDate = deal?.closedAt ?? (deal ? new Date(deal.syncedAt) : now);
    const dealMonth = new Date(dealDate).getMonth();
    const dealYear = new Date(dealDate).getFullYear();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const isDealInCurrentMonth = dealMonth === currentMonth && dealYear === currentYear;

    if (isDealInCurrentMonth) {
      // Mois en cours → les fonctions de calcul (Chantier 1) filtrent déjà les commissions
      // CANCELLED automatiquement. Rien de spécial à faire côté base.
      // Le frontend recalculera au prochain chargement du dashboard.
      // Note : si un cache est présent (React Query), il sera invalidé côté client
      // car la réponse de l'API d'annulation provoquera un refetch.
    } else {
      // Mois passé → snapshot préservé, on ne touche à RIEN
      // Audit log spécifique pour traçabilité
      await auditLogRepository.create({
        tenantId,
        userId: callerId,
        action: 'COMMISSION_CANCELLED_PAST_MONTH',
        entity: 'Commission',
        entityId: commissionId,
        metadata: {
          commissionId,
          dealMonth: `${dealYear}-${String(dealMonth + 1).padStart(2, '0')}`,
          currentMonth: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`,
          message: 'Objectif/concours du mois passé non recalculé (snapshot préservé)',
        },
      });
    }

    await auditLogRepository.create({
      tenantId,
      userId: callerId,
      action: 'CANCEL_COMMISSION',
      entity: 'Commission',
      entityId: commissionId,
      metadata: {
        reason: reason.trim(),
        wasPaid,
        clawbackId: adjustment?.id ?? null,
        cancelDeal: options?.cancelDeal ?? false,
        isDealInCurrentMonth,
      },
    });

    return { commission: cancelled, adjustment };
  },

  /**
   * Chantier 3 — Retourne les commissions PENDING du commercial pour la page "Mes projections".
   * Ces commissions correspondent à des ventes WON dont la commission n'est pas encore versée.
   * Elles comptent déjà dans les objectifs et concours du commercial.
   */
  async getProjections(userId: string, tenantId: string) {
    const pendingCommissions = await prisma.commission.findMany({
      where: {
        userId,
        tenantId,
        status: PrismaCommissionStatus.PENDING,
      },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    });

    const totalAmount = pendingCommissions.reduce((sum, c) => sum + c.amount, 0);
    const awaitingClientPayment = pendingCommissions.filter((c) => c.awaitingClientPayment);
    const standardPending = pendingCommissions.filter((c) => !c.awaitingClientPayment);

    // Récurrent ESN : projections des mois à venir tant que les missions tournent
    const recurring = await getRecurringProjectionForUser(userId, tenantId);

    return {
      recurring,
      totalAmount,
      count: pendingCommissions.length,
      byStatus: {
        awaitingClientPayment: {
          count: awaitingClientPayment.length,
          amount: awaitingClientPayment.reduce((sum, c) => sum + c.amount, 0),
        },
        standardPending: {
          count: standardPending.length,
          amount: standardPending.reduce((sum, c) => sum + c.amount, 0),
        },
      },
      commissions: pendingCommissions.map((c) => ({
        id: c.id,
        amount: c.amount,
        dealTitle: c.deal.title,
        clientName: c.deal.clientName,
        dealAmount: c.deal.amount,
        dealClosedAt: c.deal.closedAt?.toISOString() ?? null,
        awaitingClientPayment: c.awaitingClientPayment,
        scheduledPaymentAt: c.scheduledPaymentAt?.toISOString() ?? null,
        ruleName: c.rule.name,
        calculationDetail: c.calculationDetail ?? c.rule.name,
      })),
    };
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
    const deal = await dealRepository.findById(dealId, tenantId);
    if (!deal) {
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
      const allAssignments = await ruleAssignmentRepository.findActiveForUser(
        target.userId,
        tenantId,
      );
      // Un event DEAL_WON n'applique que les règles ciblant DEAL_WON (défaut).
      // Les règles récurrentes (MISSION_MONTH) sont réservées au job de mission.
      const activeAssignments = allAssignments.filter((a) => {
        const cfg = a.rule.config as unknown as CommissionRuleConfig;
        return (cfg.appliesToEventType ?? 'DEAL_WON') === 'DEAL_WON';
      });

      if (activeAssignments.length === 0) {
        // Pas de règle de commission → normalement on ignore.
        // Mais pour les TEAM_LEAD, on crée une commission à 0 € afin que la vente
        // passe obligatoirement par la validation du manager général.
        const targetUser = await userRepository.findById(target.userId);
        if (targetUser?.role === PrismaUserRole.TEAM_LEAD) {
          const placeholderRuleId = await getOrCreatePlaceholderRuleId(tenantId, target.userId);
          const result = await commissionRepository.upsertForDeal(
            tenantId, target.userId, dealId, placeholderRuleId,
            0, 'Pas de règle de commission — validation manager requise', null, false,
          );
          allResults.push(result);
        }
        continue;
      }

      for (const assignment of activeAssignments) {
        const config = resolveEffectiveConfig(
          assignment.rule.config as unknown as CommissionRuleConfig,
          readOverrides(assignment.overrides),
        );

        // ── Choisir la base de calcul AVANT split (Option A : cap sur total) ──
        // Généralisé via resolveBasisAmount (deal WON = 1 CommissionableEvent).
        const { basisAmount: fullBasisAmount, basisLabel } = resolveBasisAmount(config, {
          amount: deal.amount,
          marginAmount: deal.marginAmount,
          costAmount: deal.costAmount,
        });

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
