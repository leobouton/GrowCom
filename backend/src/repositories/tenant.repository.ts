import { Tenant, TenantStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateTenantData {
  name: string;
  slug: string;
  stripeCustomerId?: string;
}

export const tenantRepository = {
  async findById(id: string): Promise<Tenant | null> {
    return prisma.tenant.findUnique({ where: { id } });
  },

  async findBySlug(slug: string): Promise<Tenant | null> {
    return prisma.tenant.findUnique({ where: { slug } });
  },

  async findAll(): Promise<Tenant[]> {
    return prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async create(data: CreateTenantData): Promise<Tenant> {
    return prisma.tenant.create({ data });
  },

  async update(id: string, data: Partial<Tenant>): Promise<Tenant> {
    return prisma.tenant.update({ where: { id }, data });
  },

  async updateStripe(
    id: string,
    stripeCustomerId: string,
    stripeSubscriptionId?: string,
  ): Promise<Tenant> {
    return prisma.tenant.update({
      where: { id },
      data: { stripeCustomerId, ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}) },
    });
  },

  async updateStatus(id: string, status: TenantStatus): Promise<Tenant> {
    return prisma.tenant.update({ where: { id }, data: { status } });
  },

  async updateOdooConfig(
    id: string,
    odooUrl: string,
    odooDatabase: string,
    odooLogin: string,
    odooApiKey: string,
  ): Promise<Tenant> {
    return prisma.tenant.update({
      where: { id },
      data: { odooUrl, odooDatabase, odooLogin, odooApiKey },
    });
  },

  async findByStripeCustomerId(stripeCustomerId: string): Promise<Tenant | null> {
    return prisma.tenant.findFirst({ where: { stripeCustomerId } });
  },

  async findByStripeSubscriptionId(stripeSubscriptionId: string): Promise<Tenant | null> {
    return prisma.tenant.findFirst({ where: { stripeSubscriptionId } });
  },
};
