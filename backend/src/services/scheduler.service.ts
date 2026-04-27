import cron from 'node-cron';
import { logger } from '../config/logger';
import { tenantRepository } from '../repositories/tenant.repository';
import { odooService } from '../integrations/odoo.service';
import { prisma } from '../config/prisma';

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
        where: { tenantId: tenant.id, role: { in: ['MANAGER', 'BU_MANAGER'] }, isActive: true },
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
        tenant.odooApiKey!,
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
 * Démarre le planificateur de synchronisation Odoo.
 * - Première sync au démarrage du serveur
 * - Puis toutes les heures (à la minute 0)
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

  logger.info('[Scheduler] Synchronisation automatique Odoo activée (toutes les heures)');
}
