import { Router } from 'express';
import { groupController } from '../controllers/group.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

const guard = [authenticate, checkTenant, checkRole(UserRole.MANAGER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER)];

router.get('/', ...guard, groupController.list);
router.post('/', ...guard, groupController.create);
router.patch('/:groupId', ...guard, groupController.update);
router.delete('/:groupId', ...guard, groupController.remove);
router.patch('/:groupId/members/:memberId', ...guard, groupController.assignMember);
router.patch('/:groupId/lead', ...guard, groupController.assignLead);

export default router;
