import { Router, RequestHandler } from 'express';
import { objectiveSnapshotController } from '../controllers/objectiveSnapshot.controller';
import { authenticate, checkTenant } from '../middlewares/auth';

const router = Router();

router.use(authenticate, checkTenant);

// Tous les rôles authentifiés peuvent accéder à leurs snapshots
// Les managers peuvent passer ?userId= pour voir un autre utilisateur
router.get('/', objectiveSnapshotController.list as unknown as RequestHandler);

export default router;
