import { Request, Response, NextFunction } from 'express';
import { missionRepository } from '../repositories/mission.repository';
import { commissionRepository } from '../repositories/commission.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import type { MissionWithDetails, RecurringCommissionDTO } from '../../../shared/types';

export const missionController = {
  /** Liste les missions récurrentes du tenant, enrichies (deal + commercial). */
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const missions = await missionRepository.findWithDetailsByTenantId(user.tenantId!);

      const data: MissionWithDetails[] = missions.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        dealId: m.dealId,
        userId: m.userId,
        type: m.type,
        monthlyAmount: m.monthlyAmount,
        consultantCount: m.consultantCount,
        startDate: m.startDate.toISOString(),
        expectedEndDate: m.expectedEndDate ? m.expectedEndDate.toISOString() : null,
        status: m.status,
        source: m.source as MissionWithDetails['source'],
        odooId: m.odooId,
        hubspotId: m.hubspotId,
        marginAmount: m.marginAmount,
        marginSource: m.marginSource as MissionWithDetails['marginSource'],
        syncedAt: m.syncedAt.toISOString(),
        createdAt: m.createdAt.toISOString(),
        deal: { title: m.deal.title, clientName: m.deal.clientName },
        commercial: m.user ? { firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email } : null,
      }));

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  /** Commissions récurrentes (issues de missions) du tenant. */
  async getRecurringCommissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const commissions = await commissionRepository.findRecurringByTenantId(user.tenantId!);

      const data: RecurringCommissionDTO[] = commissions.map((c) => ({
        id: c.id,
        userId: c.userId,
        missionId: c.missionId,
        periodMonth: c.periodMonth.toISOString(),
        amount: c.amount,
        status: c.status as RecurringCommissionDTO['status'],
        calculationDetail: c.calculationDetail,
        dealTitle: c.deal.title,
        clientName: c.deal.clientName,
        ruleName: c.rule.name,
      }));

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
};
