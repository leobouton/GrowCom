import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { teamController } from '../controllers/team.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { authRateLimiter } from '../middlewares/rateLimiter';
import { UserRole } from '../../../shared/types';

const router = Router();

// Routes publiques (avec rate limiting renforcé)
router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/accept-invitation', authController.acceptInvitation);
router.post('/verify-email', authController.verifyEmail);
router.post('/forgot-password', authRateLimiter, authController.forgotPassword);
router.post('/reset-password', authRateLimiter, authController.resetPassword);

// Routes protégées
router.get('/me', authenticate, authController.me);
router.post(
  '/invite',
  authenticate,
  checkRole(UserRole.MANAGER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER),
  authController.inviteCommercial,
);

const teamGuard = [authenticate, checkTenant, checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD)];

// Récupérer l'équipe du tenant
router.get('/team', ...teamGuard, teamController.getTeam);

// Modifier les infos d'un membre (salaire, prénom, nom, objectifs)
router.patch('/team/:memberId', ...teamGuard, teamController.updateMember);

// Supprimer un membre de l'équipe
router.delete('/team/:memberId', ...teamGuard, teamController.removeMember);

// Relancer l'invitation d'un membre en attente
router.post('/team/:memberId/resend-invitation', ...teamGuard, authController.resendInvitation);

export default router;
