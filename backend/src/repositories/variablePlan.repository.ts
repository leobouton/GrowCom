import { VariablePlan, PlanComponent } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface PlanComponentWithRule extends PlanComponent {
  rule: { id: string; name: string; type: string; config: unknown } | null;
}

export interface VariablePlanWithComponents extends VariablePlan {
  components: PlanComponentWithRule[];
}

export const variablePlanRepository = {
  async findByTenantId(tenantId: string): Promise<VariablePlanWithComponents[]> {
    return prisma.variablePlan.findMany({
      where: { tenantId },
      include: {
        components: {
          include: { rule: { select: { id: true, name: true, type: true, config: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<VariablePlanWithComponents[]>;
  },

  async findById(id: string, tenantId: string): Promise<VariablePlanWithComponents | null> {
    return prisma.variablePlan.findFirst({
      where: { id, tenantId },
      include: {
        components: {
          include: { rule: { select: { id: true, name: true, type: true, config: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    }) as Promise<VariablePlanWithComponents | null>;
  },
};
