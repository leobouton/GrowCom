import { Router } from 'express';
import { hubspotController } from '../controllers/hubspot.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant, checkRole(UserRole.MANAGER));

router.get('/config', hubspotController.getConfig);
router.post('/config', hubspotController.configure);
router.post('/sync', hubspotController.sync);

export default router;
