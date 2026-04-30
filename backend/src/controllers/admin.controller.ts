import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { env } from '../config/env';

export const adminController = {
  async getTenants(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenants = await prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: true } },
        },
      });

      const tenantsWithMrr = tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        activeUsers: tenant._count.users,
        mrr: tenant._count.users * (env.STRIPE_PRICE_PER_USER / 100),
        stripeCustomerId: tenant.stripeCustomerId,
        createdAt: tenant.createdAt.toISOString(),
      }));

      const totalMrr = tenantsWithMrr.reduce((sum, t) => sum + t.mrr, 0);

      res.json({
        success: true,
        data: {
          tenants: tenantsWithMrr,
          totalMrr,
          totalTenants: tenants.length,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async getTenantDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const tenant = await prisma.tenant.findUnique({
        where: { id },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
              isActive: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              deals: true,
              commissions: true,
            },
          },
        },
      });

      if (!tenant) {
        res.status(404).json({
          success: false,
          error: { code: 'TENANT_NOT_FOUND', message: 'Tenant introuvable' },
        });
        return;
      }

      res.json({ success: true, data: tenant });
    } catch (err) {
      next(err);
    }
  },
};

