import { Router } from 'express';
import { dealAssignmentController } from '../controllers/dealAssignment.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router({ mergeParams: true }); // mergeParams pour récupérer :dealId du parent

router.use(authenticate, checkTenant);

// Lecture : MANAGER, BU_MANAGER, TEAM_LEAD et le commercial concerné (filtrage dans le controller)
router.get(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD, UserRole.COMMERCIAL),
  dealAssignmentController.getAssignments,
);

// Écriture : MANAGER et BU_MANAGER uniquement
router.put(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  dealAssignmentController.putAssignments,
);

export default router;
