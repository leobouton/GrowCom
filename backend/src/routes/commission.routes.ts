import { Router } from 'express';
import { commissionController } from '../controllers/commission.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

// Toutes les routes nécessitent une authentification et un tenant
router.use(authenticate, checkTenant);

// Routes manager : MANAGER, BU_MANAGER et TEAM_LEAD (filtrage par équipe géré dans le service)
router.get(
  '/manager/stats',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionController.getManagerStats,
);
router.get(
  '/manager/pending',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionController.getPending,
);
router.patch(
  '/:id/status',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionController.updateStatus,
);
router.post(
  '/:id/mark-client-paid',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionController.markClientPaid,
);
router.post(
  '/:id/cancel',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionController.cancel,
);
router.post(
  '/:id/revert',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionController.revertToPending,
);
router.delete(
  '/:id',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionController.delete,
);

// Routes commerciales : tous les rôles non-admin peuvent voir leurs propres commissions
router.get(
  '/my',
  checkRole(UserRole.COMMERCIAL, UserRole.RECRUITER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER, UserRole.MANAGER),
  commissionController.getMyCommissions,
);
router.get(
  '/commercial/stats',
  checkRole(UserRole.COMMERCIAL, UserRole.RECRUITER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER),
  commissionController.getCommercialStats,
);
// Chantier 3 — Projections : commissions PENDING du commercial (ventes WON en attente de versement)
router.get(
  '/projections',
  checkRole(UserRole.COMMERCIAL, UserRole.RECRUITER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER),
  commissionController.getProjections,
);

export default router;
