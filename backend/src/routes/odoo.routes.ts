import { Router } from 'express';
import { odooController } from '../controllers/odoo.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant, checkRole(UserRole.MANAGER));

router.get('/config', odooController.getConfig);
router.post('/config', odooController.configure);
router.post('/sync', odooController.sync);

export default router;
