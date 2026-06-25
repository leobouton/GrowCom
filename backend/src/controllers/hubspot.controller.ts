import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { hubspotService } from '../integrations/hubspot.service';
import { tenantRepository } from '../repositories/tenant.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';
import { decrypt } from '../utils/encryption';

const hubspotConfigSchema = z.object({
  hubspotToken: z.string().min(1, 'Token HubSpot requis'),
});

export const hubspotController = {
  async configure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { hubspotToken } = hubspotConfigSchema.parse(req.body);

      // On valide le token avant de l'enregistrer (évite de stocker un token invalide).
      await hubspotService.authenticate(hubspotToken);
      const portalId = await hubspotService.fetchPortalId(hubspotToken);

      const tenant = await tenantRepository.updateHubspotConfig(user.tenantId!, hubspotToken, portalId);

      res.json({
        success: true,
        data: {
          configured: true,
          hubspotPortalId: tenant.hubspotPortalId,
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

      if (!tenant?.hubspotToken) {
        throw new AppError(400, 'HUBSPOT_NOT_CONFIGURED', 'HubSpot n\'est pas configuré. Veuillez renseigner votre token Private App.');
      }

      const result = await hubspotService.sync(
        user.tenantId!,
        user.userId,
        decrypt(tenant.hubspotToken), // Déchiffrement du token stocké chiffré
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
          configured: !!tenant?.hubspotToken,
          hubspotPortalId: tenant?.hubspotPortalId ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
