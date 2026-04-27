import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { authenticate, checkRole } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkRole(UserRole.SUPER_ADMIN));

router.get('/tenants', adminController.getTenants);
router.get('/tenants/:id', adminController.getTenantDetails);

export default router;
