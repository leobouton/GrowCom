import { api } from './api';
import type {
  CommissionRuleConfig,
  GeneratedPlanDraft,
  Objective,
  PlanSimulationResult,
  PlanSimulationScenario,
  VariablePlan,
} from '@shared/types';

/** Composant d'un plan persisté, avec sa règle (si commission) tel que renvoyé par l'API. */
export interface PlanComponentDetails {
  id: string;
  kind: 'COMMISSION_RULE' | 'OBJECTIVE';
  ruleId: string | null;
  objectiveConfig: Objective | null;
  appliesToEventType: 'DEAL_WON' | 'MISSION_MONTH' | 'MANUAL';
  sortOrder: number;
  rule: { id: string; name: string; type: string; dealType: string | null; config: CommissionRuleConfig } | null;
}

export interface PlanAssignmentDetails {
  id: string;
  userId: string | null;
  user: { id: string; firstName: string; lastName: string; email: string; role: string } | null;
}

/** Plan modèle persisté avec composants et membres assignés. */
export interface VariablePlanDetails extends Omit<VariablePlan, 'components'> {
  components: PlanComponentDetails[];
  assignments: PlanAssignmentDetails[];
}

export const variablePlanApiService = {
  async getAll(): Promise<VariablePlanDetails[]> {
    const res = await api.get<{ success: true; data: VariablePlanDetails[] }>('/variable-plans');
    return res.data.data;
  },

  /** Assigne un plan modèle existant à des membres (règles + objectifs, sans doublon). */
  async assignPlan(planId: string, userIds: string[]): Promise<VariablePlanDetails> {
    const res = await api.post<{ success: true; data: VariablePlanDetails }>(
      `/variable-plans/${planId}/assign`,
      { userIds },
    );
    return res.data.data;
  },

  /**
   * Génère un brouillon de plan depuis une description en langage naturel.
   * Avec `currentPlan` : mode édition (instruction + plan courant → plan mis à jour).
   */
  async generate(description: string, currentPlan?: GeneratedPlanDraft): Promise<GeneratedPlanDraft> {
    const res = await api.post<{ success: true; data: GeneratedPlanDraft }>(
      '/variable-plans/generate',
      currentPlan ? { description, currentPlan } : { description },
    );
    return res.data.data;
  },

  /** Simule le plan sur un scénario — calcul par le moteur réel, côté serveur. */
  async simulate(plan: GeneratedPlanDraft, scenario: PlanSimulationScenario): Promise<PlanSimulationResult> {
    const res = await api.post<{ success: true; data: PlanSimulationResult }>(
      '/variable-plans/simulate',
      { plan, scenario },
    );
    return res.data.data;
  },

  /** Sauvegarde le plan (création des règles réelles + assignation aux membres choisis). */
  async save(plan: GeneratedPlanDraft, assignedUserIds: string[]): Promise<VariablePlan> {
    const res = await api.post<{ success: true; data: VariablePlan }>(
      '/variable-plans',
      { plan, assignedUserIds },
    );
    return res.data.data;
  },

  /**
   * Met à jour un plan existant (mode édition) : règles modifiées en place,
   * composants ajoutés/retirés gérés, objectifs des membres assignés synchronisés.
   */
  async update(planId: string, plan: GeneratedPlanDraft): Promise<VariablePlan> {
    const res = await api.put<{ success: true; data: VariablePlan }>(
      `/variable-plans/${planId}`,
      { plan },
    );
    return res.data.data;
  },
};
