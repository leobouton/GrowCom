import { Router } from 'express';
import { missionController } from '../controllers/mission.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Lecture : MANAGER, BU_MANAGER, TEAM_LEAD
router.get(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  missionController.getAll,
);
router.get(
  '/recurring-commissions',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  missionController.getRecurringCommissions,
);

export default router;
