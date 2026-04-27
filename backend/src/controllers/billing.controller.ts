import { Request, Response, NextFunction } from 'express';
import { stripeService } from '../integrations/stripe.service';
import { AuthenticatedRequest } from '../middlewares/auth';

export const billingController = {
  async getBillingInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const info = await stripeService.getBillingInfo(user.tenantId!);
      res.json({ success: true, data: info });
    } catch (err) {
      next(err);
    }
  },

  async createSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const subscription = await stripeService.createOrUpdateSubscription(user.tenantId!);
      res.json({ success: true, data: { subscriptionId: subscription.id } });
    } catch (err) {
      next(err);
    }
  },

  async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_SIGNATURE', message: 'Signature Stripe manquante' },
        });
        return;
      }

      await stripeService.handleWebhook(req.body as Buffer, signature);
      res.json({ received: true });
    } catch (err) {
      next(err);
    }
  },
};
