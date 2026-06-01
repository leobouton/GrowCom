/**
 * importBatch.service.ts
 * Service de gestion des ImportBatch : listing, détail, annulation.
 */

import { prisma } from '../config/prisma';
import { CommissionStatus as PrismaCommissionStatus, DealStatus as PrismaDealStatus } from '@prisma/client';
import { importBatchRepository } from '../repositories/importBatch.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { commissionService } from './commission.service';
import { AppError } from '../middlewares/errorHandler';
import { UserRole, CommissionStatus } from '../../../shared/types';
import { logger } from '../config/logger';

// ─── Types internes ─────────────────────────────────────────────────────────

interface DealSnapshot {
  dealId: string;
  previousValues: Record<string, unknown>;
  previousImportBatchId: string | null;
}

interface CancelResult {
  status: 'CANCELLED' | 'PARTIALLY_CANCELLED';
  deletedDeals: number;
  keptDeals: number;
  restoredDeals: number;
  blockedReason?: string;
}

interface CancelPreview {
  toBeDeleted: number;
  toBeRestored: number;
  toBeKept: number;
  affectedCommissions: {
    pending: number;
    validated: number;
    paid: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Détermine si un deal est "du mois en cours" côté serveur.
 */
function isDealInCurrentMonth(deal: { closedAt: Date | null; createdAt: Date }): boolean {
  const now = new Date();
  const ref = deal.closedAt ?? deal.createdAt;
  return ref.getFullYear() === now.getFullYear() && ref.getMonth() === now.getMonth();
}

/**
 * Vérifie si toutes les commissions d'un deal sont annulables (PENDING ou CANCELLED).
 */
function allCommissionsCancellable(
  commissions: Array<{ status: string }>,
): boolean {
  return commissions.every(
    (c) => c.status === CommissionStatus.PENDING || c.status === CommissionStatus.CANCELLED,
  );
}

/**
 * Trouve le snapshot d'un deal dans les updatedDealSnapshots du batch.
 */
function findSnapshot(
  snapshots: DealSnapshot[] | null,
  dealId: string,
): DealSnapshot | undefined {
  if (!snapshots) return undefined;
  return snapshots.find((s) => s.dealId === dealId);
}

// ─── Service ────────────────────────────────────────────────────────────────

export const importBatchService = {
  async list(tenantId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    return importBatchRepository.findByTenantWithImporter(tenantId, limit, offset);
  },

  async getById(batchId: string, tenantId: string) {
    const batch = await importBatchRepository.findById(batchId, tenantId);
    if (!batch) throw new AppError(404, 'BATCH_NOT_FOUND', 'Import introuvable');

    const deals = await importBatchRepository.getDealsWithCommissions(batchId, tenantId);

    // Enrichir avec l'importeur
    const importer = await prisma.user.findUnique({
      where: { id: batch.importedBy },
      select: { firstName: true, lastName: true, email: true },
    });

    return {
      ...batch,
      importer: importer ?? { firstName: '?', lastName: '?', email: '?' },
      deals,
    };
  },

  /**
   * Calcule un aperçu de l'impact d'une annulation SANS rien modifier.
   */
  async cancelPreview(batchId: string, tenantId: string): Promise<CancelPreview> {
    const batch = await importBatchRepository.findById(batchId, tenantId);
    if (!batch) throw new AppError(404, 'BATCH_NOT_FOUND', 'Import introuvable');
    if (batch.status !== 'COMPLETED') {
      throw new AppError(400, 'ALREADY_CANCELLED', 'Cet import a déjà été annulé');
    }

    const deals = await importBatchRepository.getDealsWithCommissions(batchId, tenantId);
    const snapshots = (batch.updatedDealSnapshots as DealSnapshot[] | null) ?? [];

    let toBeDeleted = 0;
    let toBeRestored = 0;
    let toBeKept = 0;
    let pendingCommissions = 0;
    let validatedCommissions = 0;
    let paidCommissions = 0;

    for (const deal of deals) {
      // Compter les commissions par statut
      for (const comm of deal.commissions) {
        if (comm.status === CommissionStatus.PENDING) pendingCommissions++;
        else if (comm.status === CommissionStatus.VALIDATED) validatedCommissions++;
        else if (comm.status === CommissionStatus.PAID) paidCommissions++;
      }

      const snapshot = findSnapshot(snapshots, deal.id);
      const canCancel = isDealInCurrentMonth(deal) || allCommissionsCancellable(deal.commissions);

      if (canCancel) {
        if (snapshot) {
          toBeRestored++;
        } else {
          toBeDeleted++;
        }
      } else {
        toBeKept++;
      }
    }

    return {
      toBeDeleted,
      toBeRestored,
      toBeKept,
      affectedCommissions: {
        pending: pendingCommissions,
        validated: validatedCommissions,
        paid: paidCommissions,
      },
    };
  },

  /**
   * Annule un import : supprime les deals créés, restaure les deals mis à jour.
   * Toute la logique est dans une transaction Prisma.
   */
  async cancelImport(params: {
    batchId: string;
    tenantId: string;
    callerId: string;
    callerRole: UserRole;
    reason: string;
  }): Promise<CancelResult> {
    const { batchId, tenantId, callerId, callerRole, reason } = params;

    // Validations préliminaires
    if (![UserRole.MANAGER, UserRole.BU_MANAGER].includes(callerRole)) {
      throw new AppError(403, 'FORBIDDEN', 'Seuls les managers peuvent annuler un import');
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10) {
      throw new AppError(400, 'REASON_TOO_SHORT', 'Le motif doit contenir au moins 10 caractères');
    }
    if (trimmedReason.length > 500) {
      throw new AppError(400, 'REASON_TOO_LONG', 'Le motif ne peut pas dépasser 500 caractères');
    }

    const batch = await importBatchRepository.findById(batchId, tenantId);
    if (!batch) throw new AppError(404, 'BATCH_NOT_FOUND', 'Import introuvable');
    if (batch.status === 'CANCELLED') {
      throw new AppError(400, 'ALREADY_CANCELLED', 'Cet import est déjà annulé');
    }
    if (batch.status === 'PARTIALLY_CANCELLED') {
      throw new AppError(400, 'ALREADY_CANCELLED', 'Cet import a déjà été partiellement annulé');
    }

    const deals = await importBatchRepository.getDealsWithCommissions(batchId, tenantId);
    const snapshots = (batch.updatedDealSnapshots as DealSnapshot[] | null) ?? [];

    // Exécuter dans une transaction
    const result = await prisma.$transaction(async (tx) => {
      let deletedDeals = 0;
      let keptDeals = 0;
      let restoredDeals = 0;

      for (const deal of deals) {
        const snapshot = findSnapshot(snapshots, deal.id);
        const canCancel = isDealInCurrentMonth(deal) || allCommissionsCancellable(deal.commissions);

        if (!canCancel) {
          // Deal du mois passé avec commissions validées/payées → on ne touche pas
          await tx.deal.update({
            where: { id: deal.id },
            data: { importBatchId: null },
          });
          keptDeals++;
          continue;
        }

        if (snapshot) {
          // Deal mis à jour par cet import → restaurer les anciennes valeurs
          const prev = snapshot.previousValues;

          // Warning si le deal a été modifié manuellement après l'import
          // (syncedAt est mis à jour à chaque modification du deal)
          if (deal.syncedAt && batch.createdAt && deal.syncedAt > batch.createdAt) {
            logger.warn('Deal modifié manuellement après import, restauration des anciennes valeurs', {
              dealId: deal.id,
              batchId,
              dealSyncedAt: deal.syncedAt,
              batchCreatedAt: batch.createdAt,
            });
          }

          await tx.deal.update({
            where: { id: deal.id },
            data: {
              title: prev.title as string,
              clientName: prev.clientName as string | null,
              amount: prev.amount as number,
              currency: prev.currency as string ?? 'EUR',
              status: prev.status as PrismaDealStatus,
              assignedToId: prev.assignedToId as string | null,
              closedAt: prev.closedAt ? new Date(prev.closedAt as string) : null,
              dealType: prev.dealType as string | null,
              notes: prev.notes as string | null,
              costAmount: prev.costAmount as number | null,
              marginAmount: prev.marginAmount as number | null,
              marginSource: prev.marginSource as string | null,
              fileExternalId: prev.fileExternalId as string | null,
              importBatchId: snapshot.previousImportBatchId,
            },
          });

          // Supprimer les commissions associées à ce deal qui sont PENDING
          await tx.commission.deleteMany({
            where: { dealId: deal.id, tenantId, status: PrismaCommissionStatus.PENDING },
          });

          restoredDeals++;
        } else {
          // Deal créé par cet import → suppression complète

          // D'abord supprimer les commissions
          await tx.commission.deleteMany({
            where: { dealId: deal.id, tenantId },
          });

          // Supprimer les deal assignments
          await tx.dealAssignment.deleteMany({
            where: { dealId: deal.id, tenantId },
          });

          // Supprimer le deal
          await tx.deal.delete({
            where: { id: deal.id },
          });

          deletedDeals++;
        }
      }

      // Déterminer le statut final du batch
      const finalStatus = keptDeals === 0 ? 'CANCELLED' : 'PARTIALLY_CANCELLED';

      // Mettre à jour le batch
      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: finalStatus as 'CANCELLED' | 'PARTIALLY_CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: callerId,
          cancellationReason: trimmedReason,
          cancellationSummary: {
            deletedDeals,
            keptDeals,
            restoredDeals,
            reason: keptDeals > 0
              ? 'Certains deals ont des commissions validées/payées sur un mois passé'
              : 'Tous les deals ont été supprimés ou restaurés',
          },
        },
      });

      return { status: finalStatus as 'CANCELLED' | 'PARTIALLY_CANCELLED', deletedDeals, keptDeals, restoredDeals };
    });

    // Recalculer les commissions pour les deals restaurés (hors transaction pour ne pas bloquer)
    for (const deal of deals) {
      const snapshot = findSnapshot(snapshots, deal.id);
      const canCancel = isDealInCurrentMonth(deal) || allCommissionsCancellable(deal.commissions);
      if (canCancel && snapshot && deal.assignedToId) {
        try {
          await commissionService.recalculateForDeal(deal.id, tenantId);
        } catch (err) {
          logger.warn('Erreur recalcul commission après restauration deal', {
            dealId: deal.id,
            error: err,
          });
        }
      }
    }

    // Audit log
    await auditLogRepository.create({
      tenantId,
      userId: callerId,
      action: 'IMPORT_CANCELLED',
      entity: 'ImportBatch',
      entityId: batchId,
      metadata: {
        batchId,
        deletedDeals: result.deletedDeals,
        keptDeals: result.keptDeals,
        restoredDeals: result.restoredDeals,
        reason: trimmedReason,
      },
    });

    return {
      ...result,
      blockedReason: result.keptDeals > 0
        ? `${result.keptDeals} deal(s) conservé(s) car ils ont des commissions validées ou payées sur un mois passé. Utilisez l'annulation individuelle pour ces commissions.`
        : undefined,
    };
  },
};
