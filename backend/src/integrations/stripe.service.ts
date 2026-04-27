import Stripe from 'stripe';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { tenantRepository } from '../repositories/tenant.repository';
import { userRepository } from '../repositories/user.repository';
import { AppError } from '../middlewares/errorHandler';
import { TenantStatus } from '../../../shared/types';
import { TenantStatus as PrismaTenantStatus } from '@prisma/client';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export const stripeService = {
  async createCustomer(tenantId: string, email: string, name: string): Promise<Stripe.Customer> {
    try {
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: { tenantId },
      });

      await tenantRepository.updateStripe(tenantId, customer.id);
      logger.info('Customer Stripe créé', { tenantId, customerId: customer.id });
      return customer;
    } catch (err) {
      logger.error('Erreur création customer Stripe', { tenantId, error: err });
      throw new AppError(500, 'STRIPE_ERROR', 'Erreur lors de la création du compte facturation');
    }
  },

  async createOrUpdateSubscription(tenantId: string): Promise<Stripe.Subscription> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant introuvable');
    if (!tenant.stripeCustomerId) {
      throw new AppError(400, 'NO_STRIPE_CUSTOMER', 'Aucun compte facturation configuré');
    }

    const activeUsers = await userRepository.countActiveByTenantId(tenantId);

    try {
      if (tenant.stripeSubscriptionId) {
        // Mettre à jour l'abonnement existant
        const subscription = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
        const updated = await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
          items: [
            {
              id: subscription.items.data[0]?.id,
              quantity: Math.max(activeUsers, 1),
            },
          ],
          metadata: { tenantId },
        });
        return updated;
      } else {
        // Créer un nouvel abonnement
        const subscription = await stripe.subscriptions.create({
          customer: tenant.stripeCustomerId,
          items: [
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              price_data: {
                currency: 'eur',
                product_data: { name: 'GrowCom — Abonnement' },
                unit_amount: env.STRIPE_PRICE_PER_USER,
                recurring: { interval: 'month' },
              } as any,
              quantity: Math.max(activeUsers, 1),
            },
          ],
          payment_behavior: 'default_incomplete',
          metadata: { tenantId },
        });

        await tenantRepository.updateStripe(tenantId, tenant.stripeCustomerId, subscription.id);
        return subscription;
      }
    } catch (err) {
      logger.error('Erreur Stripe subscription', { tenantId, error: err });
      throw new AppError(500, 'STRIPE_ERROR', 'Erreur lors de la gestion de l\'abonnement');
    }
  },

  async getBillingInfo(tenantId: string) {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant introuvable');

    const activeUsers = await userRepository.countActiveByTenantId(tenantId);
    const monthlyAmount = activeUsers * (env.STRIPE_PRICE_PER_USER / 100);

    const invoices: Array<{
      id: string;
      amount: number;
      status: string;
      date: string;
      pdfUrl: string | null;
    }> = [];

    if (tenant.stripeCustomerId) {
      try {
        const stripeInvoices = await stripe.invoices.list({
          customer: tenant.stripeCustomerId,
          limit: 10,
        });

        for (const inv of stripeInvoices.data) {
          invoices.push({
            id: inv.id,
            amount: (inv.amount_paid ?? inv.total) / 100,
            status: inv.status ?? 'unknown',
            date: new Date((inv.created) * 1000).toISOString(),
            pdfUrl: inv.invoice_pdf ?? null,
          });
        }
      } catch (err) {
        logger.warn('Impossible de récupérer les factures Stripe', { tenantId, error: err });
      }
    }

    let nextBillingDate: string | null = null;
    if (tenant.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
        nextBillingDate = new Date(sub.current_period_end * 1000).toISOString();
      } catch {
        // Ignoré
      }
    }

    return {
      plan: tenant.plan,
      status: tenant.status,
      activeUsers,
      monthlyAmount,
      nextBillingDate,
      invoices,
    };
  },

  async handleWebhook(body: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Signature webhook invalide');
    }

    logger.info('Webhook Stripe reçu', { type: event.type });

    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenant = await tenantRepository.findByStripeSubscriptionId(subscription.id);
        if (tenant) {
          const newStatus =
            subscription.status === 'active'
              ? PrismaTenantStatus.ACTIVE
              : subscription.status === 'canceled'
                ? PrismaTenantStatus.CANCELLED
                : PrismaTenantStatus.SUSPENDED;
          await tenantRepository.updateStatus(tenant.id, newStatus);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenant = await tenantRepository.findByStripeSubscriptionId(subscription.id);
        if (tenant) {
          await tenantRepository.updateStatus(tenant.id, PrismaTenantStatus.CANCELLED);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) {
          const tenant = await tenantRepository.findByStripeCustomerId(
            typeof invoice.customer === 'string' ? invoice.customer : invoice.customer.id,
          );
          if (tenant) {
            await tenantRepository.updateStatus(tenant.id, PrismaTenantStatus.SUSPENDED);
          }
        }
        break;
      }

      default:
        logger.debug('Webhook Stripe non géré', { type: event.type });
    }
  },
};

void TenantStatus; // evite unused import warning
