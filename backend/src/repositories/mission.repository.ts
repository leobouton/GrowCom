import { Mission, MissionStatus, MissionType, DealSource } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface UpsertMissionData {
  tenantId: string;
  dealId: string;
  userId?: string | null;
  type: MissionType;
  monthlyAmount: number;
  consultantCount: number;
  startDate: Date;
  expectedEndDate?: Date | null;
  status: MissionStatus;
  source: DealSource;
  odooId?: string | null;
  hubspotId?: string | null;
  marginAmount?: number | null;
  marginSource?: string | null;
}

export const missionRepository = {
  async findByOdooId(odooId: string, tenantId: string): Promise<Mission | null> {
    return prisma.mission.findUnique({ where: { tenantId_odooId: { tenantId, odooId } } });
  },

  async findByHubspotId(hubspotId: string, tenantId: string): Promise<Mission | null> {
    return prisma.mission.findUnique({ where: { tenantId_hubspotId: { tenantId, hubspotId } } });
  },

  async findByTenantId(tenantId: string): Promise<Mission[]> {
    return prisma.mission.findMany({ where: { tenantId }, orderBy: { startDate: 'desc' } });
  },

  async findActiveByTenantId(tenantId: string): Promise<Mission[]> {
    return prisma.mission.findMany({
      where: { tenantId, status: MissionStatus.ACTIVE },
      orderBy: { startDate: 'desc' },
    });
  },

  async findWithDetailsByTenantId(tenantId: string): Promise<Array<Mission & {
    deal: { title: string; clientName: string | null };
    user: { firstName: string; lastName: string; email: string } | null;
  }>> {
    return prisma.mission.findMany({
      where: { tenantId },
      include: {
        deal: { select: { title: true, clientName: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  },

  async findActiveByUserId(userId: string, tenantId: string): Promise<Mission[]> {
    return prisma.mission.findMany({
      where: { tenantId, userId, status: MissionStatus.ACTIVE },
      orderBy: { startDate: 'desc' },
    });
  },

  async findActiveWithDealByUserId(userId: string, tenantId: string): Promise<Array<Mission & {
    deal: { title: string; clientName: string | null; dealType: string | null };
  }>> {
    return prisma.mission.findMany({
      where: { tenantId, userId, status: MissionStatus.ACTIVE },
      include: { deal: { select: { title: true, clientName: true, dealType: true } } },
      orderBy: { startDate: 'desc' },
    });
  },

  /** Upsert d'une mission Odoo (clé tenantId + odooId). */
  async upsertOdoo(data: UpsertMissionData & { odooId: string }): Promise<Mission> {
    return prisma.mission.upsert({
      where: { tenantId_odooId: { tenantId: data.tenantId, odooId: data.odooId } },
      update: {
        dealId: data.dealId,
        userId: data.userId ?? null,
        type: data.type,
        monthlyAmount: data.monthlyAmount,
        consultantCount: data.consultantCount,
        startDate: data.startDate,
        expectedEndDate: data.expectedEndDate ?? null,
        status: data.status,
        marginAmount: data.marginAmount ?? null,
        marginSource: data.marginSource ?? null,
        syncedAt: new Date(),
      },
      create: {
        tenantId: data.tenantId,
        dealId: data.dealId,
        userId: data.userId ?? null,
        type: data.type,
        monthlyAmount: data.monthlyAmount,
        consultantCount: data.consultantCount,
        startDate: data.startDate,
        expectedEndDate: data.expectedEndDate ?? null,
        status: data.status,
        source: DealSource.ODOO,
        odooId: data.odooId,
        marginAmount: data.marginAmount ?? null,
        marginSource: data.marginSource ?? null,
        syncedAt: new Date(),
      },
    });
  },

  /** Upsert d'une mission HubSpot (clé tenantId + hubspotId). */
  async upsertHubspot(data: UpsertMissionData & { hubspotId: string }): Promise<Mission> {
    return prisma.mission.upsert({
      where: { tenantId_hubspotId: { tenantId: data.tenantId, hubspotId: data.hubspotId } },
      update: {
        dealId: data.dealId,
        userId: data.userId ?? null,
        type: data.type,
        monthlyAmount: data.monthlyAmount,
        consultantCount: data.consultantCount,
        startDate: data.startDate,
        expectedEndDate: data.expectedEndDate ?? null,
        status: data.status,
        marginAmount: data.marginAmount ?? null,
        marginSource: data.marginSource ?? null,
        syncedAt: new Date(),
      },
      create: {
        tenantId: data.tenantId,
        dealId: data.dealId,
        userId: data.userId ?? null,
        type: data.type,
        monthlyAmount: data.monthlyAmount,
        consultantCount: data.consultantCount,
        startDate: data.startDate,
        expectedEndDate: data.expectedEndDate ?? null,
        status: data.status,
        source: DealSource.HUBSPOT,
        hubspotId: data.hubspotId,
        marginAmount: data.marginAmount ?? null,
        marginSource: data.marginSource ?? null,
        syncedAt: new Date(),
      },
    });
  },
};
