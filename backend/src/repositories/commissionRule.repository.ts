import { CommissionRule } from '@prisma/client';
import { prisma } from '../config/prisma';
import { CommissionRuleConfig, CommissionRuleType, RuleScope } from '../../../shared/types';

export interface CreateRuleData {
  tenantId: string;
  name: string;
  description: string;
  type: CommissionRuleType;
  config: CommissionRuleConfig;
  createdBy: string;
  scope?: RuleScope;
  dealType?: string | null;
  paymentDelayDays?: number | null;
}

export const commissionRuleRepository = {
  async findById(id: string, tenantId: string): Promise<CommissionRule | null> {
    return prisma.commissionRule.findFirst({ where: { id, tenantId } });
  },

  async findByTenantId(tenantId: string, filter?: { isArchived?: boolean }): Promise<CommissionRule[]> {
    return prisma.commissionRule.findMany({
      where: {
        tenantId,
        ...(filter?.isArchived !== undefined ? { isArchived: filter.isArchived } : {}),
        // Exclure les règles système (placeholder TEAM_LEAD)
        name: { not: { startsWith: '__SYSTEM_' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findActiveByTenantId(tenantId: string): Promise<CommissionRule | null> {
    return prisma.commissionRule.findFirst({
      where: { tenantId, isActive: true, isArchived: false },
      orderBy: { createdAt: 'desc' },
    });
  },

  async create(data: CreateRuleData): Promise<CommissionRule> {
    return prisma.commissionRule.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        description: data.description,
        type: data.type,
        config: data.config as object,
        createdBy: data.createdBy,
        scope: data.scope ?? 'GLOBAL',
        dealType: data.dealType ?? null,
        paymentDelayDays: data.paymentDelayDays ?? null,
        isActive: true,
        isArchived: false,
      },
    });
  },

  async updateMeta(
    id: string,
    tenantId: string,
    data: { name: string; dealType?: string | null; paymentDelayDays?: number | null; description: string; config?: CommissionRuleConfig; type?: CommissionRuleType },
  ): Promise<CommissionRule> {
    return prisma.commissionRule.update({
      where: { id, tenantId },
      data: {
        name: data.name,
        dealType: data.dealType ?? null,
        paymentDelayDays: data.paymentDelayDays ?? null,
        description: data.description,
        ...(data.config ? { config: data.config as object } : {}),
        ...(data.type ? { type: data.type } : {}),
      },
    });
  },

  async archive(id: string, tenantId: string): Promise<CommissionRule> {
    return prisma.commissionRule.update({
      where: { id, tenantId },
      data: { isArchived: true, isActive: false },
    });
  },

  async unarchive(id: string, tenantId: string): Promise<CommissionRule> {
    return prisma.commissionRule.update({
      where: { id, tenantId },
      data: { isArchived: false, isActive: true },
    });
  },

  async delete(id: string, tenantId: string): Promise<void> {
    const rule = await prisma.commissionRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new Error('Regle introuvable');
    await prisma.commissionRule.delete({ where: { id } });
  },
};
