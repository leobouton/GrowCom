import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { odooService } from '../integrations/odoo.service';
import { tenantRepository } from '../repositories/tenant.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';

const odooConfigSchema = z.object({
  odooUrl: z.string().url('URL Odoo invalide'),
  odooDatabase: z.string().min(1, 'Base de données requise'),
  odooLogin: z.string().email('Email Odoo invalide'),
  odooApiKey: z.string().min(1, 'Clé API requise'),
});

export const odooController = {
  async configure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { odooUrl, odooDatabase, odooLogin, odooApiKey } = odooConfigSchema.parse(req.body);

      const tenant = await tenantRepository.updateOdooConfig(
        user.tenantId!,
        odooUrl,
        odooDatabase,
        odooLogin,
        odooApiKey,
      );

      res.json({
        success: true,
        data: {
          odooUrl: tenant.odooUrl,
          odooDatabase: tenant.odooDatabase,
          odooLogin: tenant.odooLogin,
          configured: true,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async sync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenant = await tenantRepository.findById(user.tenantId!);

      if (!tenant?.odooUrl || !tenant?.odooDatabase || !tenant?.odooLogin || !tenant?.odooApiKey) {
        throw new AppError(400, 'ODOO_NOT_CONFIGURED', 'Odoo n\'est pas configuré. Veuillez renseigner l\'URL, la base de données, l\'email et la clé API.');
      }

      const result = await odooService.sync(
        user.tenantId!,
        user.userId,
        tenant.odooUrl,
        tenant.odooDatabase,
        tenant.odooLogin,
        tenant.odooApiKey,
      );

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenant = await tenantRepository.findById(user.tenantId!);

      res.json({
        success: true,
        data: {
          configured: !!(tenant?.odooUrl && tenant?.odooDatabase && tenant?.odooLogin && tenant?.odooApiKey),
          odooUrl: tenant?.odooUrl ?? null,
          odooDatabase: tenant?.odooDatabase ?? null,
          odooLogin: tenant?.odooLogin ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
