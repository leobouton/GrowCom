import { Router } from 'express';
import { ruleAssignmentController } from '../controllers/ruleAssignment.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Tous les rôles manager peuvent gérer les assignations (filtrage par périmètre dans le controller)
const managerRoles = [UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD];

router.get('/user/:userId', checkRole(...managerRoles), ruleAssignmentController.getForUser);
router.post('/', checkRole(...managerRoles), ruleAssignmentController.assign);
router.patch('/:id/deactivate', checkRole(...managerRoles), ruleAssignmentController.deactivate);

export default router;
