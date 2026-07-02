import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  buildPayrollReport,
  buildPayrollPdf,
  buildPayrollPdfZip,
  buildPayrollExport,
  lockPayrollPeriod,
  getPayrollHistory,
} from '../services/payrollReport.service';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';
import { UserRole } from '../../../shared/types';

// Accepte soit year+month, soit periodStart+periodEnd (ISO), + sélection optionnelle.
const periodSchema = z
  .object({
    year: z.coerce.number().int().min(2020).max(2099).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
    userIds: z.string().optional(),
  })
  .refine(
    (d) => (d.year !== undefined && d.month !== undefined) || (d.periodStart && d.periodEnd),
    { message: 'Fournir year+month ou periodStart+periodEnd' },
  );

const exportSchema = periodSchema.and(
  z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }),
);

const generateSchema = z
  .object({
    year: z.coerce.number().int().min(2020).max(2099).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
  })
  .refine(
    (d) => (d.year !== undefined && d.month !== undefined) || (d.periodStart && d.periodEnd),
    { message: 'Fournir year+month ou periodStart+periodEnd' },
  );

function resolvePeriod(d: {
  year?: number;
  month?: number;
  periodStart?: string;
  periodEnd?: string;
}): { periodStart: Date; periodEnd: Date } {
  if (d.year !== undefined && d.month !== undefined) {
    return {
      periodStart: new Date(d.year, d.month - 1, 1),
      periodEnd: new Date(d.year, d.month, 0, 23, 59, 59),
    };
  }
  const periodStart = new Date(d.periodStart!);
  const periodEnd = new Date(d.periodEnd!);
  if (periodStart > periodEnd) {
    throw new AppError(400, 'INVALID_PERIOD', 'La date de début doit précéder la date de fin');
  }
  return { periodStart, periodEnd };
}

function parseUserIds(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export const payrollReportController = {
  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const parsed = periodSchema.parse(req.query);
      const { periodStart, periodEnd } = resolvePeriod(parsed);

      const preview = await buildPayrollReport({
        tenantId: user.tenantId!,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        periodStart,
        periodEnd,
        userIds: parseUserIds(parsed.userIds),
      });

      res.json({ success: true, data: preview });
    } catch (err) {
      next(err);
    }
  },

  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const parsed = generateSchema.parse(req.body);
      const { periodStart, periodEnd } = resolvePeriod(parsed);

      const lock = await lockPayrollPeriod({
        tenantId: user.tenantId!,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        periodStart,
        periodEnd,
      });

      res.json({ success: true, data: lock });
    } catch (err) {
      next(err);
    }
  },

  async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const data = await getPayrollHistory(user.tenantId!);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async exportFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const parsed = exportSchema.parse(req.query);
      const { periodStart, periodEnd } = resolvePeriod(parsed);

      const { buffer, filename, contentType } = await buildPayrollExport({
        tenantId: user.tenantId!,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        periodStart,
        periodEnd,
        userIds: parseUserIds(parsed.userIds),
        format: parsed.format,
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    } catch (err) {
      next(err);
    }
  },

  async generatePdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const parsed = periodSchema.parse(req.query);
      const { periodStart, periodEnd } = resolvePeriod(parsed);

      const { buffer, filename } = await buildPayrollPdf({
        tenantId: user.tenantId!,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        periodStart,
        periodEnd,
        userIds: parseUserIds(parsed.userIds),
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    } catch (err) {
      next(err);
    }
  },

  async generatePdfZip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const parsed = periodSchema.parse(req.query);
      const { periodStart, periodEnd } = resolvePeriod(parsed);

      const { buffer, filename } = await buildPayrollPdfZip({
        tenantId: user.tenantId!,
        callerId: user.userId,
        callerRole: user.role as UserRole,
        periodStart,
        periodEnd,
        userIds: parseUserIds(parsed.userIds),
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    } catch (err) {
      next(err);
    }
  },
};
