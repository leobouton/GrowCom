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

export interface UpsertHubspotDealData {
  tenantId: string;
  hubspotId: string; // Requis pour les deals HubSpot
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
  async findById(id: string, tenantId: string): Promise<Deal | null> {
    return prisma.deal.findFirst({ where: { id, tenantId } });
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

  /**
   * Retourne les deals WON attribués à un commercial, en excluant ceux dont la commission
   * de CE commercial est CANCELLED. Inclut le share du DealAssignment si présent.
   *
   * Règle métier : un deal WON alimente les objectifs/concours SAUF si la commission
   * du commercial a été annulée par le manager (ex: paiement client non reçu).
   * Pour les deals splittés, seule la part du commercial concerné est retirée.
   */
  async findWonForObjectives(userId: string, tenantId: string): Promise<Array<Deal & { userShare: number }>> {
    // 1. Deals attribués via DealAssignment (split)
    const assignedDeals = await prisma.dealAssignment.findMany({
      where: { userId, tenantId },
      include: {
        deal: {
          include: {
            commissions: {
              where: { userId, tenantId },
              select: { status: true },
            },
          },
        },
      },
    });

    // 2. Deals attribués via assignedToId (fallback rétrocompat) sans DealAssignment
    const assignedDealIds = new Set(assignedDeals.map((da) => da.dealId));
    const legacyDeals = await prisma.deal.findMany({
      where: {
        assignedToId: userId,
        tenantId,
        status: DealStatus.WON,
        id: { notIn: [...assignedDealIds] },
      },
      include: {
        commissions: {
          where: { userId, tenantId },
          select: { status: true },
        },
      },
    });

    const results: Array<Deal & { userShare: number }> = [];

    // Traitement des deals via DealAssignment
    for (const da of assignedDeals) {
      const deal = da.deal;
      if (deal.status !== DealStatus.WON) continue;
      // Exclure si TOUTES les commissions de ce user sur ce deal sont CANCELLED
      const hasNonCancelledCommission = deal.commissions.length === 0 ||
        deal.commissions.some((c) => c.status !== 'CANCELLED');
      if (!hasNonCancelledCommission) continue;
      // Extraire le deal sans les commissions incluses (Prisma)
      const { commissions: _, ...dealData } = deal;
      results.push({ ...dealData, userShare: da.share });
    }

    // Traitement des deals legacy (pas de DealAssignment)
    for (const deal of legacyDeals) {
      const hasNonCancelledCommission = deal.commissions.length === 0 ||
        deal.commissions.some((c) => c.status !== 'CANCELLED');
      if (!hasNonCancelledCommission) continue;
      const { commissions: _, ...dealData } = deal;
      results.push({ ...dealData, userShare: 1.0 });
    }

    return results.sort((a, b) => {
      const dateA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const dateB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      return dateB - dateA;
    });
  },

  async findByHubspotId(hubspotId: string, tenantId: string): Promise<Deal | null> {
    return prisma.deal.findUnique({ where: { tenantId_hubspotId: { tenantId, hubspotId } } });
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

  async deleteByHubspotId(hubspotId: string, tenantId: string): Promise<void> {
    await prisma.deal.delete({ where: { tenantId_hubspotId: { tenantId, hubspotId } } });
  },

  async upsertHubspot(data: UpsertHubspotDealData): Promise<Deal> {
    return prisma.deal.upsert({
      where: { tenantId_hubspotId: { tenantId: data.tenantId, hubspotId: data.hubspotId } },
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
        tenantId: data.tenantId,
        hubspotId: data.hubspotId,
        source: 'HUBSPOT',
        title: data.title,
        clientName: data.clientName ?? null,
        amount: data.amount,
        status: data.status,
        probability: data.probability,
        assignedToId: data.assignedToId ?? null,
        closedAt: data.closedAt ?? null,
        costAmount: data.costAmount ?? null,
        marginAmount: data.marginAmount ?? null,
        marginSource: data.marginSource ?? null,
        syncedAt: new Date(),
      },
    });
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

  async updateStatus(id: string, tenantId: string, status: DealStatus): Promise<Deal> {
    return prisma.deal.update({ where: { id, tenantId }, data: { status } });
  },

  async updateDeal(
    id: string,
    tenantId: string,
    data: {
      title?: string;
      clientName?: string | null;
      amount?: number;
      dealType?: string | null;
      notes?: string | null;
      costAmount?: number | null;
      marginAmount?: number | null;
    },
  ): Promise<Deal> {
    return prisma.deal.update({ where: { id, tenantId }, data });
  },
};
