import { Router } from 'express';
import { commissionDisputeController } from '../controllers/commissionDispute.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Commerciaux : soulever une contestation sur leur commission
router.post(
  '/commissions/:commissionId/raise',
  checkRole(UserRole.COMMERCIAL),
  commissionDisputeController.raise,
);

// Commerciaux + managers : voir les disputes d'une commission
router.get(
  '/commissions/:commissionId',
  checkRole(UserRole.COMMERCIAL, UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionDisputeController.listByCommission,
);

// Managers : liste de toutes les disputes du tenant (avec filtre status)
router.get(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionDisputeController.listByTenant,
);

// Managers : résoudre un dispute
router.post(
  '/:id/resolve',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionDisputeController.resolve,
);

export default router;
