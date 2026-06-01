import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { objectiveSnapshotController } from '../controllers/objectiveSnapshot.controller';
import { authenticate, checkTenant, checkRole } from '../middlewares/auth';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';
import { generateOccurrences } from '../services/objectiveRecurrence.service';
import { userRepository } from '../repositories/user.repository';
import { logger } from '../config/logger';

const router = Router();

router.use(authenticate, checkTenant);

// Tous les rôles authentifiés peuvent accéder à leurs snapshots
// Les managers peuvent passer ?userId= pour voir un autre utilisateur
router.get('/', objectiveSnapshotController.list as unknown as RequestHandler);

// Route admin : déclenchement manuel de la génération d'occurrences récurrentes
// POST /api/objective-snapshots/run-recurrence-generation
router.post(
  '/run-recurrence-generation',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER) as unknown as RequestHandler,
  (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenantId = user.tenantId!;

      logger.info('[Admin] Déclenchement manuel de la génération d\'occurrences récurrentes', {
        triggeredBy: user.userId,
        tenantId,
      });

      // Générer pour tous les utilisateurs actifs du tenant
      const users = await userRepository.findByTenantId(tenantId);
      let totalGenerated = 0;
      let errors = 0;

      for (const u of users) {
        try {
          const count = await generateOccurrences(u.id, tenantId);
          totalGenerated += count;
        } catch (err) {
          errors++;
          logger.error('[Admin] Erreur génération occurrence pour user', { userId: u.id, err });
        }
      }

      res.json({
        success: true,
        data: {
          usersProcessed: users.length,
          occurrencesGenerated: totalGenerated,
          errors,
        },
      });
    } catch (err) {
      next(err);
    }
  }) as unknown as RequestHandler,
);

export default router;
