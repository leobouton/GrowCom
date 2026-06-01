import { prisma } from '../config/prisma';
import type { ImportBatch, Prisma } from '@prisma/client';

export const importBatchRepository = {
  async findById(id: string, tenantId: string): Promise<ImportBatch | null> {
    return prisma.importBatch.findFirst({
      where: { id, tenantId },
    });
  },

  async findByTenantWithImporter(
    tenantId: string,
    limit = 20,
    offset = 0,
  ) {
    const [rawBatches, total] = await Promise.all([
      prisma.importBatch.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.importBatch.count({ where: { tenantId } }),
    ]);

    // Enrichir avec les infos de l'importeur
    const importerIds = [...new Set(rawBatches.map((b) => b.importedBy))];
    const importers = await prisma.user.findMany({
      where: { id: { in: importerIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const importerMap = new Map(importers.map((u) => [u.id, u]));

    const batches = rawBatches.map((b) => ({
      ...b,
      importer: importerMap.get(b.importedBy) ?? { firstName: '?', lastName: '?', email: '?' },
    }));

    return { batches, total };
  },

  async getDealsWithCommissions(batchId: string, tenantId: string) {
    return prisma.deal.findMany({
      where: { importBatchId: batchId, tenantId },
      include: {
        commissions: {
          select: {
            id: true,
            status: true,
            amount: true,
            userId: true,
            ruleId: true,
            scheduledPaymentAt: true,
          },
        },
      },
    });
  },

  async update(id: string, data: Prisma.ImportBatchUpdateInput): Promise<ImportBatch> {
    return prisma.importBatch.update({
      where: { id },
      data,
    });
  },
};
