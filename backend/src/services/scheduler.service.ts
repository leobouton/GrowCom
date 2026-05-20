import cron from 'node-cron';
import { logger } from '../config/logger';
import { tenantRepository } from '../repositories/tenant.repository';
import { odooService } from '../integrations/odoo.service';
import { prisma } from '../config/prisma';
import { decrypt } from '../utils/encryption';
import { UserRole } from '@prisma/client';
import { generateOccurrencesForAllTenants } from './objectiveRecurrence.service';
import { snapshotEndedObjectives } from './objectiveSnapshot.service';

/**
 * Synchronise tous les tenants qui ont Odoo configuré.
 * Appelé automatiquement toutes les heures et au démarrage.
 */
async function syncAllTenants(): Promise<void> {
  logger.info('[Scheduler] Démarrage de la synchronisation automatique Odoo');

  const tenants = await tenantRepository.findAll();
  const configured = tenants.filter(
    (t) => t.odooUrl && t.odooDatabase && t.odooLogin && t.odooApiKey,
  );

  if (configured.length === 0) {
    logger.info('[Scheduler] Aucun tenant avec Odoo configuré — sync ignorée');
    return;
  }

  for (const tenant of configured) {
    try {
      // Utilise un userId système (premier MANAGER actif du tenant)
      const systemUser = await prisma.user.findFirst({
        where: { tenantId: tenant.id, role: { in: [UserRole.MANAGER, UserRole.BU_MANAGER] }, isActive: true },
        select: { id: true },
      });

      if (!systemUser) {
        logger.warn('[Scheduler] Pas de manager actif pour déclencher la sync', { tenantId: tenant.id });
        continue;
      }

      const result = await odooService.sync(
        tenant.id,
        systemUser.id,
        tenant.odooUrl!,
        tenant.odooDatabase!,
        tenant.odooLogin!,
        decrypt(tenant.odooApiKey!), // Déchiffrement de la clé stockée chiffrée
      );

      logger.info('[Scheduler] Sync Odoo réussie', {
        tenantId: tenant.id,
        tenantName: tenant.name,
        synced: result.synced,
        created: result.created,
        updated: result.updated,
        errors: result.errors.length,
      });
    } catch (err) {
      logger.error('[Scheduler] Échec de la sync Odoo pour le tenant', {
        tenantId: tenant.id,
        tenantName: tenant.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[Scheduler] Synchronisation automatique Odoo terminée');
}

/**
 * Valide et paie automatiquement les commissions différées dont la date de paiement est arrivée.
 * Passe toutes les commissions PENDING avec scheduledPaymentAt <= maintenant en PAID (validée = payée).
 */
async function autoValidateDeferredCommissions(): Promise<void> {
  logger.info('[Scheduler] Vérification des commissions différées à valider');

  const now = new Date();

  const result = await prisma.commission.updateMany({
    where: {
      status: 'PENDING',
      scheduledPaymentAt: { lte: now },
    },
    data: {
      status: 'PAID',
      validatedAt: now,
      paidAt: now,
    },
  });

  if (result.count > 0) {
    logger.info('[Scheduler] Commissions différées validées automatiquement', { count: result.count });
  }
}

/**
 * Démarre le planificateur de synchronisation Odoo.
 * - Première sync au démarrage du serveur
 * - Puis toutes les heures (à la minute 0)
 * - Validation des commissions différées tous les jours à 8h
 */
export function startScheduler(): void {
  // Sync immédiate au démarrage (après 10s pour laisser la BDD se stabiliser)
  setTimeout(() => {
    syncAllTenants().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la sync initiale', { error: err }),
    );
  }, 10_000);

  // Sync toutes les heures, à la minute 0
  cron.schedule('0 * * * *', () => {
    syncAllTenants().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la sync planifiée', { error: err }),
    );
  });

  // Validation automatique des commissions différées — tous les jours à 8h00
  cron.schedule('0 8 * * *', () => {
    autoValidateDeferredCommissions().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la validation des commissions différées', { error: err }),
    );
  });

  // Génération des occurrences récurrentes — le 1er de chaque mois à 6h00
  cron.schedule('0 6 1 * *', () => {
    generateOccurrencesForAllTenants().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la génération des occurrences récurrentes', { error: err }),
    );
  });

  // Snapshot des objectifs terminés — tous les jours à 7h00
  cron.schedule('0 7 * * *', () => {
    snapshotEndedObjectives().catch((err) =>
      logger.error('[Scheduler] Erreur lors du snapshot des objectifs', { error: err }),
    );
  });

  logger.info('[Scheduler] Synchronisation automatique Odoo activée (toutes les heures)');
  logger.info('[Scheduler] Validation automatique des commissions différées activée (tous les jours à 8h)');
  logger.info('[Scheduler] Génération occurrences récurrentes activée (1er du mois à 6h)');
  logger.info('[Scheduler] Snapshot objectifs terminés activé (tous les jours à 7h)');
}
