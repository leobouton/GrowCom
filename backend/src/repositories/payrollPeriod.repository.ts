import { PayrollPeriod } from '@prisma/client';
import { prisma } from '../config/prisma';

export const payrollPeriodRepository = {
  /** Recherche le verrouillage existant pour une période donnée (ou null). */
  async findForPeriod(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<PayrollPeriod | null> {
    return prisma.payrollPeriod.findUnique({
      where: {
        tenantId_periodStart_periodEnd: { tenantId, periodStart, periodEnd },
      },
    });
  },

  /** Historique des périodes figées du tenant, plus récentes en premier. */
  async findByTenant(tenantId: string, limit = 36): Promise<PayrollPeriod[]> {
    return prisma.payrollPeriod.findMany({
      where: { tenantId },
      orderBy: { generatedAt: 'desc' },
      take: limit,
    });
  },
};
