import { VariablePlan, PlanComponent, PlanAssignment } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface PlanComponentWithRule extends PlanComponent {
  rule: { id: string; name: string; type: string; dealType: string | null; config: unknown } | null;
}

export interface PlanAssignmentWithUser extends PlanAssignment {
  user: { id: string; firstName: string; lastName: string; email: string; role: string } | null;
}

export interface VariablePlanWithComponents extends VariablePlan {
  components: PlanComponentWithRule[];
  assignments: PlanAssignmentWithUser[];
}

const PLAN_INCLUDE = {
  components: {
    include: { rule: { select: { id: true, name: true, type: true, dealType: true, config: true } } },
    orderBy: { sortOrder: 'asc' as const },
  },
  assignments: {
    where: { isActive: true },
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
};

export const variablePlanRepository = {
  async findByTenantId(tenantId: string): Promise<VariablePlanWithComponents[]> {
    // isTemplate = vrais plans/modèles créés par le manager ; les wrappers
    // techniques historiques (1 plan par règle, isTemplate=false) sont exclus.
    return prisma.variablePlan.findMany({
      where: { tenantId, isActive: true, isTemplate: true },
      include: PLAN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    }) as Promise<VariablePlanWithComponents[]>;
  },

  async findById(id: string, tenantId: string): Promise<VariablePlanWithComponents | null> {
    return prisma.variablePlan.findFirst({
      where: { id, tenantId },
      include: PLAN_INCLUDE,
    }) as Promise<VariablePlanWithComponents | null>;
  },

  /** Trace l'assignation d'un plan à une personne (idempotent : réactive si déjà présent). */
  async recordAssignment(planId: string, tenantId: string, userId: string): Promise<PlanAssignment> {
    const existing = await prisma.planAssignment.findFirst({
      where: { planId, tenantId, userId },
    });
    if (existing) {
      return prisma.planAssignment.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return prisma.planAssignment.create({
      data: { tenantId, planId, assignedToType: 'INDIVIDUAL', userId },
    });
  },

  /** Persiste un plan validé et ses composants (les règles doivent déjà exister). */
  async create(data: {
    tenantId: string;
    name: string;
    description: string;
    createdBy: string;
    components: Array<{
      kind: 'COMMISSION_RULE' | 'OBJECTIVE';
      ruleId: string | null;
      objectiveConfig: Record<string, unknown> | null;
      appliesToEventType: 'DEAL_WON' | 'MISSION_MONTH';
      sortOrder: number;
    }>;
  }): Promise<VariablePlanWithComponents> {
    const plan = await prisma.variablePlan.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        description: data.description,
        createdBy: data.createdBy,
        isTemplate: true, // plan/modèle visible dans la bibliothèque
        components: {
          create: data.components.map((c) => ({
            tenantId: data.tenantId,
            kind: c.kind,
            ruleId: c.ruleId,
            objectiveConfig: c.objectiveConfig === null ? undefined : (c.objectiveConfig as object),
            appliesToEventType: c.appliesToEventType,
            sortOrder: c.sortOrder,
          })),
        },
      },
    });
    return (await this.findById(plan.id, data.tenantId))!;
  },

  /** Met à jour un plan existant : méta (nom, description) + remplacement complet des composants. */
  async update(
    id: string,
    tenantId: string,
    data: {
      name: string;
      description: string;
      components: Array<{
        kind: 'COMMISSION_RULE' | 'OBJECTIVE';
        ruleId: string | null;
        objectiveConfig: Record<string, unknown> | null;
        appliesToEventType: 'DEAL_WON' | 'MISSION_MONTH';
        sortOrder: number;
      }>;
    },
  ): Promise<VariablePlanWithComponents> {
    await prisma.$transaction([
      prisma.planComponent.deleteMany({ where: { planId: id, tenantId } }),
      prisma.variablePlan.update({
        where: { id, tenantId },
        data: {
          name: data.name,
          description: data.description,
          components: {
            create: data.components.map((c) => ({
              tenantId,
              kind: c.kind,
              ruleId: c.ruleId,
              objectiveConfig: c.objectiveConfig === null ? undefined : (c.objectiveConfig as object),
              appliesToEventType: c.appliesToEventType,
              sortOrder: c.sortOrder,
            })),
          },
        },
      }),
    ]);
    return (await this.findById(id, tenantId))!;
  },
};
