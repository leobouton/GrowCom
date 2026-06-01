import { CommissionDispute, DisputeStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateDisputeData {
  tenantId: string;
  commissionId: string;
  raisedBy: string;
  reason: string;
}

/** Include standard pour avoir raiser + commission + deal */
const DISPUTE_INCLUDE = {
  raiser: { select: { id: true, firstName: true, lastName: true, email: true } },
  commission: {
    include: {
      deal: true,
      rule: { select: { id: true, name: true, config: true } },
    },
  },
} as const;

export type DisputeWithDetails = CommissionDispute & {
  raiser: { id: string; firstName: string; lastName: string; email: string };
  commission: {
    id: string;
    userId: string;
    dealId: string;
    ruleId: string;
    amount: number;
    status: string;
    deal: {
      id: string;
      title: string;
      clientName: string | null;
      amount: number;
      currency: string;
      status: string;
      dealType: string | null;
      closedAt: Date | null;
      notes: string | null;
    };
    rule: { id: string; name: string; config: unknown };
  };
};

export const commissionDisputeRepository = {
  async create(data: CreateDisputeData): Promise<DisputeWithDetails> {
    return prisma.commissionDispute.create({
      data,
      include: DISPUTE_INCLUDE,
    }) as unknown as Promise<DisputeWithDetails>;
  },

  async findById(id: string): Promise<DisputeWithDetails | null> {
    return prisma.commissionDispute.findUnique({
      where: { id },
      include: DISPUTE_INCLUDE,
    }) as unknown as Promise<DisputeWithDetails | null>;
  },

  async findByCommissionId(commissionId: string, tenantId: string): Promise<DisputeWithDetails[]> {
    return prisma.commissionDispute.findMany({
      where: { commissionId, tenantId },
      orderBy: { createdAt: 'desc' },
      include: DISPUTE_INCLUDE,
    }) as unknown as Promise<DisputeWithDetails[]>;
  },

  async findOpenByCommissionId(commissionId: string, tenantId: string): Promise<CommissionDispute | null> {
    return prisma.commissionDispute.findFirst({
      where: { commissionId, tenantId, status: 'OPEN' },
    });
  },

  async findByTenantId(
    tenantId: string,
    filters?: { status?: DisputeStatus; raisedBy?: string; limit?: number },
  ): Promise<DisputeWithDetails[]> {
    return prisma.commissionDispute.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.raisedBy ? { raisedBy: filters.raisedBy } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 100,
      include: DISPUTE_INCLUDE,
    }) as unknown as Promise<DisputeWithDetails[]>;
  },

  async countOpen(tenantId: string): Promise<number> {
    return prisma.commissionDispute.count({ where: { tenantId, status: 'OPEN' } });
  },

  async resolve(
    id: string,
    tenantId: string,
    resolvedBy: string,
    status: 'RESOLVED_ACCEPTED' | 'RESOLVED_REJECTED',
    managerResponse: string,
  ): Promise<DisputeWithDetails> {
    return prisma.commissionDispute.update({
      where: { id, tenantId },
      data: {
        status,
        resolvedBy,
        managerResponse,
        resolvedAt: new Date(),
      },
      include: DISPUTE_INCLUDE,
    }) as unknown as Promise<DisputeWithDetails>;
  },
};
