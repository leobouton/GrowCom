import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { generatePayrollReport, generatePayrollPreview } from '../services/payrollReport.service';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const reportParamsSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2099),
  month: z.coerce.number().int().min(1).max(12),
  userId: z.string().optional(),
});

export const payrollReportController = {
  async generatePdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { year, month, userId } = reportParamsSchema.parse(req.query);

      const periodStart = new Date(year, month - 1, 1);
      const periodEnd = new Date(year, month, 0, 23, 59, 59);

      const { buffer, filename } = await generatePayrollReport({
        tenantId: user.tenantId!,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        periodStart,
        periodEnd,
        userId,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    } catch (err) {
      next(err);
    }
  },

  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { year, month, userId } = reportParamsSchema.parse(req.query);

      const periodStart = new Date(year, month - 1, 1);
      const periodEnd = new Date(year, month, 0, 23, 59, 59);

      const preview = await generatePayrollPreview({
        tenantId: user.tenantId!,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        periodStart,
        periodEnd,
        userId,
      });

      res.json({ success: true, data: preview });
    } catch (err) {
      next(err);
    }
  },
};
