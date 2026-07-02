import { Router } from 'express';
import { payrollReportController } from '../controllers/payrollReport.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Lecture (preview, exports, PDF, historique) : managers et directeurs régionaux.
const canRead = checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.SUPER_ADMIN);

// Verrouillage : action figeant TOUTE la période → managers à scope tenant complet uniquement.
const canLock = checkRole(UserRole.MANAGER, UserRole.SUPER_ADMIN);

// Prévisualisation JSON (preview + drill-down + exclusions + état de verrouillage)
router.get('/preview', canRead, payrollReportController.preview);

// Historique des périodes figées
router.get('/history', canRead, payrollReportController.history);

// Exports fichier paie (CSV / XLSX)
router.get('/export', canRead, payrollReportController.exportFile);

// PDF combiné (un document, une page par commercial)
router.get('/pdf', canRead, payrollReportController.generatePdf);

// PDF individuels regroupés dans un ZIP (un relevé par commercial)
router.get('/pdf/zip', canRead, payrollReportController.generatePdfZip);

// Génération + verrouillage de la période (VALIDATED → PAID, audit)
router.post('/generate', canLock, payrollReportController.generate);

export default router;
