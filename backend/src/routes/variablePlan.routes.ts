import { Router } from 'express';
import { variablePlanController } from '../controllers/variablePlan.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Lecture : MANAGER, BU_MANAGER, TEAM_LEAD
router.get(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  variablePlanController.getAll,
);
router.get(
  '/:id',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  variablePlanController.getById,
);

// Génération IA d'un brouillon de plan : MANAGER, BU_MANAGER
router.post(
  '/generate',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  variablePlanController.generate,
);

export default router;
