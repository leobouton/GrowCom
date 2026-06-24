import { commissionDisputeRepository, DisputeWithDetails } from '../repositories/commissionDispute.repository';
import { commissionRepository } from '../repositories/commission.repository';
import { dealRepository } from '../repositories/deal.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { AppError } from '../middlewares/errorHandler';
import { UserRole, CommissionRuleConfig } from '../../../shared/types';
import { DisputeStatus } from '@prisma/client';
import { resolveTeamScope, calculateCommissionAmount } from './commission.service';

export const commissionDisputeService = {
  /**
   * Soulève une contestation sur une commission.
   * Le commercial ne peut contester que ses propres commissions.
   * Un seul dispute OPEN autorisé par commission.
   */
  async raise(
    commissionId: string,
    tenantId: string,
    callerId: string,
    reason: string,
  ): Promise<DisputeWithDetails> {
    const commission = await commissionRepository.findById(commissionId, tenantId);
    if (!commission) throw new AppError(404, 'COMMISSION_NOT_FOUND', 'Commission introuvable');
    if (commission.userId !== callerId) {
      throw new AppError(403, 'FORBIDDEN', 'Vous ne pouvez contester que vos propres commissions');
    }
    if (!reason.trim() || reason.trim().length < 10) {
      throw new AppError(400, 'REASON_TOO_SHORT', 'Le motif doit contenir au moins 10 caractères');
    }

    const existing = await commissionDisputeRepository.findOpenByCommissionId(commissionId, tenantId);
    if (existing) {
      throw new AppError(409, 'DISPUTE_ALREADY_OPEN', 'Une contestation est déjà en cours pour cette commission');
    }

    const dispute = await commissionDisputeRepository.create({
      tenantId,
      commissionId,
      raisedBy: callerId,
      reason: reason.trim(),
    });

    await auditLogRepository.create({
      tenantId,
      userId: callerId,
      action: 'RAISE_DISPUTE',
      entity: 'CommissionDispute',
      entityId: dispute.id,
      metadata: { commissionId, reason: reason.trim() },
    });

    return dispute;
  },

  /**
   * Résout un dispute (accept ou reject).
   * Réservé aux managers avec vérification de périmètre.
   */
  async resolve(
    disputeId: string,
    tenantId: string,
    callerId: string,
    callerRole: UserRole,
    action: 'accept' | 'reject',
    response: string,
    dealUpdates?: {
      title?: string;
      clientName?: string | null;
      amount?: number;
      dealType?: string | null;
      notes?: string | null;
      costAmount?: number | null;
      marginAmount?: number | null;
    },
    commissionOverride?: number | null,
  ): Promise<DisputeWithDetails> {
    const dispute = await commissionDisputeRepository.findById(disputeId, tenantId);
    if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Contestation introuvable');
    if (dispute.status !== 'OPEN') {
      throw new AppError(400, 'DISPUTE_ALREADY_RESOLVED', 'Cette contestation est déjà résolue');
    }
    if (!response.trim()) {
      throw new AppError(400, 'RESPONSE_REQUIRED', 'Une réponse est requise');
    }

    // Vérification de périmètre : TEAM_LEAD ne peut résoudre que pour son équipe
    const commission = await commissionRepository.findById(dispute.commissionId, tenantId);
    if (commission) {
      const teamIds = await resolveTeamScope(callerId, callerRole, tenantId);
      if (teamIds !== null && !teamIds.includes(commission.userId)) {
        throw new AppError(403, 'FORBIDDEN', 'Ce commercial n\'est pas dans votre périmètre');
      }
    }

    if (action === 'accept' && commission) {
      const dealAmountChanged = dealUpdates?.amount !== undefined && dealUpdates.amount !== commission.deal.amount;

      // 1. Mettre à jour le deal si des modifications sont fournies
      if (dealUpdates) {
        await dealRepository.updateDeal(commission.dealId, tenantId, dealUpdates);
      }

      // 2. Gérer le montant de la commission
      if (commissionOverride !== undefined && commissionOverride !== null) {
        // Override direct du montant de commission par le manager
        await commissionRepository.updateAmountAndDetail(
          commission.id,
          tenantId,
          commissionOverride,
          `Montant ajusté manuellement suite à contestation (ancien : ${commission.amount.toFixed(2)}€)`,
        );
      } else if (dealAmountChanged) {
        // Le montant du deal a changé → recalcul automatique de la commission
        const config = commission.rule.config as CommissionRuleConfig;
        const newDealAmount = dealUpdates!.amount!;
        const { amount: newCommissionAmount, explanation } = calculateCommissionAmount(newDealAmount, config);
        await commissionRepository.updateAmountAndDetail(
          commission.id,
          tenantId,
          newCommissionAmount,
          `${explanation} (recalculé suite à contestation, deal modifié de ${commission.deal.amount.toFixed(2)}€ à ${newDealAmount.toFixed(2)}€)`,
        );
      }
    }

    const newStatus: DisputeStatus = action === 'accept' ? 'RESOLVED_ACCEPTED' : 'RESOLVED_REJECTED';

    const resolved = await commissionDisputeRepository.resolve(
      disputeId,
      tenantId,
      callerId,
      newStatus as 'RESOLVED_ACCEPTED' | 'RESOLVED_REJECTED',
      response.trim(),
    );

    await auditLogRepository.create({
      tenantId,
      userId: callerId,
      action: 'RESOLVE_DISPUTE',
      entity: 'CommissionDispute',
      entityId: disputeId,
      metadata: {
        action,
        response: response.trim(),
        commissionId: dispute.commissionId,
        ...(dealUpdates ? { dealUpdates } : {}),
        ...(commissionOverride !== undefined && commissionOverride !== null ? { commissionOverride } : {}),
      },
    });

    return resolved;
  },

  async listByCommission(commissionId: string, tenantId: string): Promise<DisputeWithDetails[]> {
    return commissionDisputeRepository.findByCommissionId(commissionId, tenantId);
  },

  async listByTenant(
    tenantId: string,
    callerId: string,
    callerRole: UserRole,
    filters?: { status?: DisputeStatus },
  ): Promise<DisputeWithDetails[]> {
    // TEAM_LEAD voit seulement les disputes de son équipe
    const teamIds = await resolveTeamScope(callerId, callerRole, tenantId);

    if (teamIds !== null) {
      // Récupère tous les disputes du tenant puis filtre
      const all = await commissionDisputeRepository.findByTenantId(tenantId, filters);
      // Filtre en récupérant les commissions pour vérifier l'appartenance à l'équipe
      const commissionIds = all.map((d) => d.commissionId);
      if (commissionIds.length === 0) return [];

      const commissions = await import('../config/prisma').then((m) =>
        m.prisma.commission.findMany({
          where: { id: { in: commissionIds }, userId: { in: teamIds } },
          select: { id: true },
        }),
      );
      const validIds = new Set(commissions.map((c) => c.id));
      return all.filter((d) => validIds.has(d.commissionId));
    }

    return commissionDisputeRepository.findByTenantId(tenantId, filters);
  },
};
