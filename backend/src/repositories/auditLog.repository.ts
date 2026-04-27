import { AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateAuditLogData {
  tenantId: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export const auditLogRepository = {
  async create(data: CreateAuditLogData): Promise<AuditLog> {
    return prisma.auditLog.create({
      data: {
        ...data,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  },

  async findByTenantId(tenantId: string, limit = 50): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async findByEntity(tenantId: string, entity: string, entityId: string): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { tenantId, entity, entityId },
      orderBy: { createdAt: 'desc' },
    });
  },
};
