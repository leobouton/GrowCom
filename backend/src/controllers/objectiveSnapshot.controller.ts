import { Response, NextFunction } from 'express';
import { objectiveSnapshotRepository } from '../repositories/objectiveSnapshot.repository';
import { AppError } from '../middlewares/errorHandler';
import { AuthenticatedRequest } from '../middlewares/auth';

const MANAGER_ROLES = ['MANAGER', 'BU_MANAGER', 'TEAM_LEAD'];

export const objectiveSnapshotController = {
  /**
   * GET /api/objective-snapshots
   * Commercial : retourne ses propres snapshots.
   * Manager / Team Lead / BU Manager : peut passer ?userId=<id> pour voir un membre.
   */
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const caller = req.user!;
      const tenantId = caller.tenantId!;

      let targetUserId = caller.userId;

      if (req.query.userId) {
        if (MANAGER_ROLES.includes(caller.role)) {
          targetUserId = req.query.userId as string;
        } else {
          throw new AppError(403, 'FORBIDDEN', 'Accès refusé');
        }
      }

      const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string), 100) : 24;

      const snapshots = await objectiveSnapshotRepository.findByUserId(targetUserId, tenantId, limit);

      res.json({ success: true, data: snapshots });
    } catch (err) {
      next(err);
    }
  },
};
