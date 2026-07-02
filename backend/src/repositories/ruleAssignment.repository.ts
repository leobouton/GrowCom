import { RuleAssignment, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AssigneeType } from '../../../shared/types';

export interface RuleAssignmentWithRule extends RuleAssignment {
  rule: {
    id: string;
    name: string;
    type: string;
    dealType: string | null;
    scope: string;
    config: object;
    paymentDelayDays: number | null;
  };
}

export interface CreateAssignmentData {
  tenantId: string;
  ruleId: string;
  assignedToType: AssigneeType;
  userId?: string | null;
  teamName?: string | null;
  overrides?: Record<string, unknown> | null;
  startDate?: Date;
  endDate?: Date | null;
}

export const ruleAssignmentRepository = {
  async findById(id: string, tenantId: string): Promise<RuleAssignmentWithRule | null> {
    return prisma.ruleAssignment.findFirst({
      where: { id, tenantId },
      include: {
        rule: { select: { id: true, name: true, type: true, dealType: true, scope: true, config: true, paymentDelayDays: true } },
      },
    }) as Promise<RuleAssignmentWithRule | null>;
  },

  async findActiveForUser(userId: string, tenantId: string): Promise<RuleAssignmentWithRule[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { group: { select: { name: true } } },
    });

    const now = new Date();

    return prisma.ruleAssignment.findMany({
      where: {
        tenantId,
        isActive: true,
        startDate: { lte: now },
        rule: { isArchived: false },
        AND: [
          { OR: [{ endDate: null }, { endDate: { gte: now } }] },
          {
            OR: [
              { assignedToType: AssigneeType.INDIVIDUAL, userId },
              ...(user?.group?.name
                ? [{ assignedToType: AssigneeType.TEAM, teamName: user.group.name }]
                : []),
            ],
          },
        ],
      },
      include: {
        rule: { select: { id: true, name: true, type: true, dealType: true, scope: true, config: true, paymentDelayDays: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<RuleAssignmentWithRule[]>;
  },

  async findByUserId(userId: string, tenantId: string): Promise<RuleAssignmentWithRule[]> {
    return prisma.ruleAssignment.findMany({
      where: { userId, tenantId },
      include: {
        rule: { select: { id: true, name: true, type: true, dealType: true, scope: true, config: true, paymentDelayDays: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<RuleAssignmentWithRule[]>;
  },

  async findByTenantId(tenantId: string): Promise<RuleAssignmentWithRule[]> {
    return prisma.ruleAssignment.findMany({
      where: { tenantId },
      include: {
        rule: { select: { id: true, name: true, type: true, dealType: true, scope: true, config: true, paymentDelayDays: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<RuleAssignmentWithRule[]>;
  },

  async countActiveForRule(ruleId: string): Promise<number> {
    return prisma.ruleAssignment.count({ where: { ruleId, isActive: true } });
  },

  async assign(data: CreateAssignmentData): Promise<RuleAssignmentWithRule> {
    return prisma.ruleAssignment.create({
      data: {
        tenantId: data.tenantId,
        ruleId: data.ruleId,
        assignedToType: data.assignedToType,
        userId: data.userId ?? null,
        teamName: data.teamName ?? null,
        overrides: (data.overrides ?? undefined) as Prisma.InputJsonValue | undefined,
        startDate: data.startDate ?? new Date(),
        endDate: data.endDate ?? null,
        isActive: true,
      },
      include: {
        rule: { select: { id: true, name: true, type: true, dealType: true, scope: true, config: true, paymentDelayDays: true } },
      },
    }) as Promise<RuleAssignmentWithRule>;
  },

  async deactivate(id: string, tenantId: string): Promise<RuleAssignment> {
    return prisma.ruleAssignment.update({
      where: { id, tenantId },
      data: { isActive: false },
    });
  },

  async removeForRule(ruleId: string, tenantId: string): Promise<void> {
    await prisma.ruleAssignment.deleteMany({ where: { ruleId, tenantId } });
  },
};
