import { create } from 'zustand';
import type {
  GeneratedPlanDraft,
  GeneratedPlanComponentDraft,
  PlanSimulationResult,
  PlanSimulationScenario,
} from '@shared/types';

/**
 * Store du Plan de variable : brouillon courant, scénario et résultat de
 * simulation, états loading/error PAR action. Actions pures uniquement —
 * aucun calcul métier ici (tout passe par l'API / le moteur réel).
 */

type AsyncAction = 'generate' | 'simulate' | 'save';

export const DEFAULT_SCENARIO: PlanSimulationScenario = {
  dealAmount: 10000,
  dealMargin: null,
  missionMonthlyAmount: 8000,
  missionMonthlyMargin: 3000,
  consultantCount: 1,
  missionMonths: 12,
  objectiveAchievementPct: 100,
};

interface VariablePlanState {
  draft: GeneratedPlanDraft | null;
  scenario: PlanSimulationScenario;
  simulation: PlanSimulationResult | null;
  loading: Record<AsyncAction, boolean>;
  error: Record<AsyncAction, string | null>;
  savedPlanName: string | null; // nom du dernier plan enregistré (écran de succès)
  editingPlanId: string | null; // id du plan sauvegardé en cours de modification (mode édition)

  setDraft: (draft: GeneratedPlanDraft | null) => void;
  startEditing: (planId: string, draft: GeneratedPlanDraft) => void;
  replaceComponent: (index: number, component: GeneratedPlanComponentDraft) => void;
  addComponent: (component: GeneratedPlanComponentDraft) => void;
  removeComponent: (index: number) => void;
  setPlanMeta: (patch: { name?: string; description?: string }) => void;
  setScenario: (patch: Partial<PlanSimulationScenario>) => void;
  setSimulation: (result: PlanSimulationResult | null) => void;
  setLoading: (action: AsyncAction, value: boolean) => void;
  setError: (action: AsyncAction, message: string | null) => void;
  setSavedPlanName: (name: string | null) => void;
  reset: () => void;
}

const initialState = {
  draft: null,
  scenario: DEFAULT_SCENARIO,
  simulation: null,
  loading: { generate: false, simulate: false, save: false },
  error: { generate: null, simulate: null, save: null },
  savedPlanName: null,
  editingPlanId: null,
};

export const useVariablePlanStore = create<VariablePlanState>((set) => ({
  ...initialState,

  setDraft: (draft) => set({ draft, simulation: null }),

  startEditing: (editingPlanId, draft) =>
    set({ editingPlanId, draft, simulation: null, savedPlanName: null }),

  replaceComponent: (index, component) =>
    set((state) => {
      if (!state.draft) return state;
      const components = state.draft.components.map((c, i) => (i === index ? component : c));
      return { draft: { ...state.draft, components } };
    }),

  addComponent: (component) =>
    set((state) => {
      if (!state.draft) return state;
      return { draft: { ...state.draft, components: [...state.draft.components, component] } };
    }),

  removeComponent: (index) =>
    set((state) => {
      if (!state.draft) return state;
      const components = state.draft.components.filter((_, i) => i !== index);
      return { draft: { ...state.draft, components } };
    }),

  setPlanMeta: (patch) =>
    set((state) => {
      if (!state.draft) return state;
      return { draft: { ...state.draft, ...patch } };
    }),

  setScenario: (patch) => set((state) => ({ scenario: { ...state.scenario, ...patch } })),

  setSimulation: (simulation) => set({ simulation }),

  setLoading: (action, value) =>
    set((state) => ({ loading: { ...state.loading, [action]: value } })),

  setError: (action, message) =>
    set((state) => ({ error: { ...state.error, [action]: message } })),

  setSavedPlanName: (savedPlanName) => set({ savedPlanName }),

  reset: () => set({ ...initialState }),
}));
