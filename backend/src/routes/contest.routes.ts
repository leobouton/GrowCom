import { Router } from 'express';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';
import { contestController } from '../controllers/contest.controller';

const router = Router();

router.use(authenticate, checkTenant);

// Lecture accessible à tous les rôles (le contrôleur filtre selon le rôle)
router.get('/', contestController.list);
router.get('/:id/leaderboard', contestController.leaderboard);

// Actions réservées aux managers / resp. de secteur
router.post('/', checkRole(UserRole.MANAGER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER), contestController.create);
router.patch('/:id/end', checkRole(UserRole.MANAGER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER), contestController.end);
router.patch('/:id/cancel', checkRole(UserRole.MANAGER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER), contestController.cancel);

export default router;
