import { Router } from 'express';
import express from 'express';
import { billingController } from '../controllers/billing.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

// Webhook Stripe — doit recevoir le raw body (pas de JSON parse)
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  billingController.handleWebhook,
);

// Routes protégées
router.use(authenticate, checkTenant);
router.get('/', checkRole(UserRole.MANAGER), billingController.getBillingInfo);
router.post('/subscribe', checkRole(UserRole.MANAGER), billingController.createSubscription);

export default router;
