import { Router } from 'express';
import { variablePlanController } from '../controllers/variablePlan.controller';
import { authenticate, checkRole, checkTenant } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';

const router = Router();

router.use(authenticate, checkTenant);

// Lecture : MANAGER, BU_MANAGER, TEAM_LEAD
router.get(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  variablePlanController.getAll,
);
router.get(
  '/:id',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  variablePlanController.getById,
);

// Génération IA d'un brouillon de plan (+ mode édition) : MANAGER, BU_MANAGER
router.post(
  '/generate',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  variablePlanController.generate,
);

// Simulation d'un plan sur un scénario — calcul par le moteur réel côté serveur
router.post(
  '/simulate',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER, UserRole.TEAM_LEAD),
  variablePlanController.simulate,
);

// Sauvegarde d'un plan validé (création des règles + assignation simple)
router.post(
  '/',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  variablePlanController.save,
);

// Mise à jour d'un plan existant depuis l'interface de simulation (mode édition)
router.put(
  '/:id',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  variablePlanController.update,
);

// Assignation d'un plan MODÈLE existant à des membres (junior, senior, responsable…)
router.post(
  '/:id/assign',
  checkRole(UserRole.MANAGER, UserRole.BU_MANAGER),
  variablePlanController.assignPlan,
);

export default router;
