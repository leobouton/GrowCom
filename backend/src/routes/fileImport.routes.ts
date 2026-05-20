import { Router } from 'express';
import multer from 'multer';
import { fileImportController } from '../controllers/fileImport.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

// Multer en mémoire — le fichier brut n'est jamais persisté sur disque (RGPD)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Toutes les routes nécessitent d'être authentifié et MANAGER
router.use(authenticate, checkTenant, checkRole(UserRole.MANAGER));

router.post('/upload', upload.single('file'), fileImportController.upload);
router.post('/confirm', fileImportController.confirm);
router.get('/history', fileImportController.history);

export default router;
