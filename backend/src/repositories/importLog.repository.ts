import { ImportLog, ImportStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateImportLogData {
  tenantId: string;
  uploadedBy: string;
  fileName: string;
  totalRows: number;
  errorRows: number;
  errors: unknown[];
  pendingRows: unknown[];
}

export interface UpdateImportLogData {
  status: ImportStatus;
  successRows?: number;
  skippedRows?: number;
  errorRows?: number;
  errors?: unknown[];
  completedAt?: Date;
  pendingRows?: null; // null pour nettoyer après confirmation
}

export const importLogRepository = {
  async create(data: CreateImportLogData): Promise<ImportLog> {
    return prisma.importLog.create({
      data: {
        tenantId: data.tenantId,
        uploadedBy: data.uploadedBy,
        fileName: data.fileName,
        status: 'PENDING',
        totalRows: data.totalRows,
        errorRows: data.errorRows,
        errors: data.errors as never,
        pendingRows: data.pendingRows as never,
      },
    });
  },

  async update(id: string, data: UpdateImportLogData): Promise<ImportLog> {
    return prisma.importLog.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.successRows !== undefined && { successRows: data.successRows }),
        ...(data.skippedRows !== undefined && { skippedRows: data.skippedRows }),
        ...(data.errorRows !== undefined && { errorRows: data.errorRows }),
        ...(data.errors !== undefined && { errors: data.errors as never }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
        ...('pendingRows' in data && { pendingRows: data.pendingRows as never }),
      },
    });
  },

  async findById(id: string): Promise<ImportLog | null> {
    return prisma.importLog.findUnique({ where: { id } });
  },

  async findLastByTenantId(tenantId: string, limit = 5): Promise<ImportLog[]> {
    return prisma.importLog.findMany({
      where: { tenantId, status: { not: 'PENDING' } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};
