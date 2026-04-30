import { Commission, CommissionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CommissionWithRelations extends Commission {
  deal: { title: string; clientName: string | null; amount: number; status: string };
  rule: { name: string; config: unknown };
  user: { firstName: string; lastName: string; email: string };
}

export const commissionRepository = {
  async findById(id: string): Promise<CommissionWithRelations | null> {
    return prisma.commission.findUnique({
      where: { id },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    }) as Promise<CommissionWithRelations | null>;
  },

  async findByTenantId(tenantId: string): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: { tenantId },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findByUserIds(userIds: string[], tenantId: string): Promise<CommissionWithRelations[]> {
    if (userIds.length === 0) return [];
    return prisma.commission.findMany({
      where: { userId: { in: userIds }, tenantId },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findPendingByUserIds(userIds: string[], tenantId: string): Promise<CommissionWithRelations[]> {
    if (userIds.length === 0) return [];
    return prisma.commission.findMany({
      where: { userId: { in: userIds }, tenantId, status: CommissionStatus.PENDING },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findByUserId(userId: string, tenantId: string): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: { userId, tenantId },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findPendingByTenantId(tenantId: string): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: { tenantId, status: CommissionStatus.PENDING },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async create(data: {
    tenantId: string;
    userId: string;
    dealId: string;
    ruleId: string;
    amount: number;
  }): Promise<Commission> {
    return prisma.commission.create({ data });
  },

  async updateStatus(
    id: string,
    status: CommissionStatus,
    tenantId: string,
  ): Promise<Commission> {
    return prisma.commission.update({
      where: { id, tenantId },
      data: {
        status,
        ...(status === CommissionStatus.VALIDATED ? { validatedAt: new Date() } : {}),
        ...(status === CommissionStatus.PAID ? { paidAt: new Date() } : {}),
      },
    });
  },

  async sumByUserAndMonth(
    userId: string,
    tenantId: string,
    startOfMonth: Date,
    endOfMonth: Date,
  ): Promise<number> {
    // Utilise validatedAt comme date effective : une commission différée validée en avril
    // apparaît dans les gains d'avril, pas dans ceux de janvier (date de la vente).
    const result = await prisma.commission.aggregate({
      where: {
        userId,
        tenantId,
        status: { in: [CommissionStatus.VALIDATED, CommissionStatus.PAID] },
        validatedAt: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  },

  async findByUserIdsInPeriod(
    userIds: string[],
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<CommissionWithRelations[]> {
    if (userIds.length === 0) return [];
    return prisma.commission.findMany({
      where: {
        userId: { in: userIds },
        tenantId,
        calculatedAt: { gte: startDate, lte: endDate },
      },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findByUserIdInPeriod(
    userId: string,
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: {
        userId,
        tenantId,
        calculatedAt: { gte: startDate, lte: endDate },
      },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true } },
        rule: { select: { name: true, config: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async getManagerStats(tenantId: string): Promise<{
    totalPending: number;
    totalValidated: number;
    totalPaid: number;
  }> {
    const [pending, validated, paid] = await Promise.all([
      prisma.commission.aggregate({
        where: { tenantId, status: CommissionStatus.PENDING },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: { tenantId, status: CommissionStatus.VALIDATED },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: { tenantId, status: CommissionStatus.PAID },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalPending: pending._sum.amount ?? 0,
      totalValidated: validated._sum.amount ?? 0,
      totalPaid: paid._sum.amount ?? 0,
    };
  },

  async upsertForDeal(
    tenantId: string,
    userId: string,
    dealId: string,
    ruleId: string,
    amount: number,
    calculationDetail?: string,
    scheduledPaymentAt?: Date | null,
  ): Promise<Commission> {
    return prisma.commission.upsert({
      where: { dealId_userId_ruleId: { dealId, userId, ruleId } },
      update: { amount, calculatedAt: new Date(), calculationDetail: calculationDetail ?? null, scheduledPaymentAt: scheduledPaymentAt ?? null },
      create: { tenantId, userId, dealId, ruleId, amount, calculationDetail: calculationDetail ?? null, scheduledPaymentAt: scheduledPaymentAt ?? null },
    });
  },
};
