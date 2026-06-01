import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';
import { previewImport, confirmImport } from '../services/fileImport.service';
import { importLogRepository } from '../repositories/importLog.repository';

export const fileImportController = {
  /**
   * POST /api/sync/file-import/upload
   * Reçoit le fichier, parse, valide, retourne un aperçu sans rien écrire définitivement.
   */
  async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user.tenantId) throw new AppError(403, 'TENANT_REQUIRED', 'Tenant requis');

      if (!req.file) throw new AppError(400, 'FILE_MISSING', 'Aucun fichier reçu');

      const allowed = ['.csv', '.xlsx', '.xls'];
      const ext = '.' + (req.file.originalname.split('.').pop()?.toLowerCase() ?? '');
      if (!allowed.includes(ext)) {
        throw new AppError(
          400,
          'INVALID_FILE_FORMAT',
          `Format non supporté. Extensions acceptées : ${allowed.join(', ')}`,
        );
      }

      // Mapping custom envoyé par le frontend en cas de fallback manuel
      let customMapping: Record<string, string> | undefined;
      const customMappingRaw = (req.body as Record<string, unknown>)?.customMapping;
      if (typeof customMappingRaw === 'string') {
        try { customMapping = JSON.parse(customMappingRaw); } catch { /* ignore */ }
      } else if (customMappingRaw && typeof customMappingRaw === 'object') {
        customMapping = customMappingRaw as Record<string, string>;
      }

      const preview = await previewImport(
        user.tenantId,
        user.userId,
        req.file.buffer,
        req.file.originalname,
        customMapping,
      );

      res.json({ success: true, data: preview });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/sync/file-import/confirm
   * Confirme l'import après prévisualisation. Crée les deals et déclenche les commissions.
   */
  async confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user.tenantId) throw new AppError(403, 'TENANT_REQUIRED', 'Tenant requis');

      const { importLogId } = req.body as { importLogId?: string };
      if (!importLogId) throw new AppError(400, 'IMPORT_LOG_ID_REQUIRED', 'importLogId requis');

      const result = await confirmImport(importLogId, user.tenantId);

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/sync/file-import/history
   * Retourne les 5 derniers imports terminés.
   */
  async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user.tenantId) throw new AppError(403, 'TENANT_REQUIRED', 'Tenant requis');

      const logs = await importLogRepository.findLastByTenantId(user.tenantId, 5);

      res.json({ success: true, data: logs });
    } catch (err) {
      next(err);
    }
  },
};
