import { Deal, DealStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface UpsertDealData {
  tenantId: string;
  odooId: string; // Requis pour les deals Odoo
  title: string;
  clientName?: string | null;
  amount: number;
  status: DealStatus;
  probability: number;
  assignedToId?: string | null;
  closedAt?: Date | null;
  costAmount?: number | null;
  marginAmount?: number | null;
  marginSource?: string | null;
}

export interface CreateFileImportDealData {
  tenantId: string;
  fileExternalId: string;
  title: string;
  clientName?: string | null;
  amount: number;
  currency: string;
  status: DealStatus;
  assignedToId?: string | null;
  closedAt?: Date | null;
  dealType?: string | null;
  notes?: string | null;
  importLogId: string;
  costAmount?: number | null;
  marginAmount?: number | null;
  marginSource?: string | null;
}

export const dealRepository = {
  async findById(id: string): Promise<Deal | null> {
    return prisma.deal.findUnique({ where: { id } });
  },

  async findByOdooId(odooId: string, tenantId: string): Promise<Deal | null> {
    return prisma.deal.findUnique({ where: { tenantId_odooId: { tenantId, odooId } } });
  },

  async findByTenantId(tenantId: string): Promise<Deal[]> {
    return prisma.deal.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findOpenByUserId(userId: string, tenantId: string): Promise<Deal[]> {
    return prisma.deal.findMany({
      where: { assignedToId: userId, tenantId, status: DealStatus.OPEN },
      orderBy: { amount: 'desc' },
    });
  },

  async findWonByTenantId(tenantId: string): Promise<Deal[]> {
    return prisma.deal.findMany({
      where: { tenantId, status: DealStatus.WON },
      orderBy: { closedAt: 'desc' },
    });
  },

  async findWonByUserId(userId: string, tenantId: string): Promise<Deal[]> {
    return prisma.deal.findMany({
      where: { assignedToId: userId, tenantId, status: DealStatus.WON },
      orderBy: { closedAt: 'desc' },
    });
  },

  async findByFileExternalId(fileExternalId: string, tenantId: string): Promise<Deal | null> {
    return prisma.deal.findUnique({
      where: { tenantId_fileExternalId: { tenantId, fileExternalId } },
    });
  },

  async createFromFileImport(data: CreateFileImportDealData): Promise<Deal> {
    return prisma.deal.create({
      data: {
        tenantId: data.tenantId,
        fileExternalId: data.fileExternalId,
        source: 'FILE',
        title: data.title,
        clientName: data.clientName ?? null,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        probability: data.status === DealStatus.WON ? 100 : 0,
        assignedToId: data.assignedToId ?? null,
        closedAt: data.closedAt ?? null,
        dealType: data.dealType ?? null,
        notes: data.notes ?? null,
        importLogId: data.importLogId,
        costAmount: data.costAmount ?? null,
        marginAmount: data.marginAmount ?? null,
        marginSource: data.marginSource ?? null,
        syncedAt: new Date(),
      },
    });
  },

  async deleteByOdooId(odooId: string, tenantId: string): Promise<void> {
    await prisma.deal.delete({ where: { tenantId_odooId: { tenantId, odooId } } });
  },

  async upsert(data: UpsertDealData): Promise<Deal> {
    return prisma.deal.upsert({
      where: { tenantId_odooId: { tenantId: data.tenantId, odooId: data.odooId } },
      update: {
        title: data.title,
        clientName: data.clientName ?? null,
        amount: data.amount,
        status: data.status,
        probability: data.probability,
        assignedToId: data.assignedToId,
        closedAt: data.closedAt,
        costAmount: data.costAmount ?? null,
        marginAmount: data.marginAmount ?? null,
        marginSource: data.marginSource ?? null,
        syncedAt: new Date(),
      },
      create: {
        ...data,
        syncedAt: new Date(),
      },
    });
  },
};
