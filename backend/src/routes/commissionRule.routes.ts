import { Router } from 'express';
import { commissionRuleController } from '../controllers/commissionRule.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Lecture : MANAGER, BU_MANAGER et TEAM_LEAD peuvent voir la bibliothèque de règles
router.get(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  commissionRuleController.getAll,
);

// Écriture : MANAGER et BU_MANAGER uniquement (création et archivage)
router.post(
  '/generate',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  commissionRuleController.generate,
);
router.patch(
  '/:id',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  commissionRuleController.update,
);
router.patch(
  '/:id/archive',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  commissionRuleController.archive,
);
router.patch(
  '/:id/unarchive',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  commissionRuleController.unarchive,
);

export default router;
