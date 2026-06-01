import { Router } from 'express';
import { importBatchController } from '../controllers/importBatch.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

// Toutes les routes nécessitent d'être authentifié, MANAGER ou BU_MANAGER
router.use(authenticate, checkTenant, checkRole(UserRole.MANAGER, UserRole.BU_MANAGER));

router.get('/', importBatchController.list);
router.get('/:id', importBatchController.getById);
router.get('/:id/cancel-preview', importBatchController.cancelPreview);
router.post('/:id/cancel', importBatchController.cancel);

export default router;
