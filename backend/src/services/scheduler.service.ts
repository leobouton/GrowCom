import cron from 'node-cron';
import { logger } from '../config/logger';
import { tenantRepository } from '../repositories/tenant.repository';
import { odooService } from '../integrations/odoo.service';
import { hubspotService } from '../integrations/hubspot.service';
import { prisma } from '../config/prisma';
import { decrypt } from '../utils/encryption';
import { UserRole } from '@prisma/client';
import { generateOccurrencesForAllTenants } from './objectiveRecurrence.service';
import { snapshotEndedObjectives } from './objectiveSnapshot.service';
import { generateRecurringMissionCommissions } from './missionRecurrence.service';

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
 * Synchronise tous les tenants qui ont HubSpot configuré.
 * Appelé automatiquement toutes les heures et au démarrage, en miroir de la sync Odoo.
 */
async function syncAllTenantsHubspot(): Promise<void> {
  logger.info('[Scheduler] Démarrage de la synchronisation automatique HubSpot');

  const tenants = await tenantRepository.findAll();
  const configured = tenants.filter((t) => t.hubspotToken);

  if (configured.length === 0) {
    logger.info('[Scheduler] Aucun tenant avec HubSpot configuré — sync ignorée');
    return;
  }

  for (const tenant of configured) {
    try {
      const systemUser = await prisma.user.findFirst({
        where: { tenantId: tenant.id, role: { in: [UserRole.MANAGER, UserRole.BU_MANAGER] }, isActive: true },
        select: { id: true },
      });

      if (!systemUser) {
        logger.warn('[Scheduler] Pas de manager actif pour déclencher la sync HubSpot', { tenantId: tenant.id });
        continue;
      }

      const result = await hubspotService.sync(
        tenant.id,
        systemUser.id,
        decrypt(tenant.hubspotToken!), // Déchiffrement du token stocké chiffré
      );

      logger.info('[Scheduler] Sync HubSpot réussie', {
        tenantId: tenant.id,
        tenantName: tenant.name,
        synced: result.synced,
        created: result.created,
        updated: result.updated,
        errors: result.errors.length,
      });
    } catch (err) {
      logger.error('[Scheduler] Échec de la sync HubSpot pour le tenant', {
        tenantId: tenant.id,
        tenantName: tenant.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[Scheduler] Synchronisation automatique HubSpot terminée');
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
    syncAllTenantsHubspot().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la sync HubSpot initiale', { error: err }),
    );
    // Générer les occurrences manquantes au démarrage
    generateOccurrencesForAllTenants().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la génération initiale des occurrences', { error: err }),
    );
    // Rattrapage des commissions récurrentes de mission du mois en cours (idempotent)
    generateRecurringMissionCommissions().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la génération initiale des commissions récurrentes', { error: err }),
    );
  }, 10_000);

  // Sync toutes les heures, à la minute 0
  cron.schedule('0 * * * *', () => {
    syncAllTenants().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la sync planifiée', { error: err }),
    );
    syncAllTenantsHubspot().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la sync HubSpot planifiée', { error: err }),
    );
  });

  // Validation automatique des commissions différées — tous les jours à 8h00
  cron.schedule('0 8 * * *', () => {
    autoValidateDeferredCommissions().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la validation des commissions différées', { error: err }),
    );
  });

  // Génération des occurrences récurrentes — tous les jours à 6h00
  // (idempotent : ne crée que les occurrences manquantes pour la période en cours)
  cron.schedule('0 6 * * *', () => {
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

  // Commissions récurrentes de mission — le 1er de chaque mois à 5h00 (heure de Paris).
  // Idempotent : réexécutable sans doublon (upserts sur clés uniques).
  cron.schedule('0 5 1 * *', () => {
    generateRecurringMissionCommissions().catch((err) =>
      logger.error('[Scheduler] Erreur lors de la génération des commissions récurrentes', { error: err }),
    );
  }, { timezone: 'Europe/Paris' });

  const cronJobs = [
    'Odoo + HubSpot sync: toutes les heures (0 * * * *)',
    'Commissions différées: tous les jours à 8h (0 8 * * *)',
    'Occurrences récurrentes: tous les jours à 6h (0 6 * * *)',
    'Snapshot objectifs: tous les jours à 7h (0 7 * * *)',
    'Commissions récurrentes mission: le 1er du mois à 5h Paris (0 5 1 * *)',
  ];
  logger.info('[Scheduler] Cron jobs initialized:', { jobs: cronJobs });
}
