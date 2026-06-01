import { Router } from 'express';
import { payrollReportController } from '../controllers/payrollReport.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Prévisualisation JSON (avant génération PDF)
router.get(
  '/preview',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  payrollReportController.preview,
);

// Génération et téléchargement du PDF
router.get(
  '/pdf',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  payrollReportController.generatePdf,
);

export default router;
