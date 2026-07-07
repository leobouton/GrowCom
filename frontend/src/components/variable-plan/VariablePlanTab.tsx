import { useCallback, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { TruncatedText } from '../ui/TruncatedText';
import { variablePlanApiService } from '../../services/variablePlan.service';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { getApiErrorMessage, validateComponent } from './planDisplay';
import { PlanPromptPanel } from './PlanPromptPanel';
import { PlanExplainer } from './PlanExplainer';
import { PlanSimulator } from './PlanSimulator';
import { PlanBreakdown } from './PlanBreakdown';
import { ComponentInlineEditor } from './ComponentInlineEditor';
import { PlanRepromptBar } from './PlanRepromptBar';
import { PlanSavePanel } from './PlanSavePanel';

const SIMULATE_DEBOUNCE_MS = 400;

/**
 * Page unifiée « Plan de variable » — boucle complète :
 * décrire → générer → comprendre (pas-à-pas) → simuler interactivement →
 * éditer inline → re-simuler → (si besoin) re-prompter → sauvegarder.
 * RÈGLE ABSOLUE : aucun calcul de variable côté front, tout passe par l'API.
 */
export function VariablePlanTab() {
  const draft = useVariablePlanStore((s) => s.draft);
  const scenario = useVariablePlanStore((s) => s.scenario);
  const savedPlanName = useVariablePlanStore((s) => s.savedPlanName);
  const editingPlanId = useVariablePlanStore((s) => s.editingPlanId);
  const setSimulation = useVariablePlanStore((s) => s.setSimulation);
  const setLoading = useVariablePlanStore((s) => s.setLoading);
  const setError = useVariablePlanStore((s) => s.setError);
  const reset = useVariablePlanStore((s) => s.reset);

  const runSimulation = useCallback(async () => {
    if (!draft || editingPlanId) return; // en mode édition, la popup gère la simulation
    // Ne pas simuler un plan incohérent (édition inline en cours)
    if (draft.components.some((c) => validateComponent(c) !== null)) return;
    setLoading('simulate', true);
    setError('simulate', null);
    try {
      const result = await variablePlanApiService.simulate(draft, scenario);
      setSimulation(result);
    } catch (err: unknown) {
      setError('simulate', getApiErrorMessage(err));
    } finally {
      setLoading('simulate', false);
    }
  }, [draft, scenario, setSimulation, setLoading, setError]);

  // Recalcul débouncé à chaque changement du plan ou du scénario
  useEffect(() => {
    if (!draft || editingPlanId) return;
    const timer = setTimeout(() => { void runSimulation(); }, SIMULATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, scenario, editingPlanId, runSimulation]);

  // Mode ÉDITION d'un plan sauvegardé : tout se passe dans la popup (PlanEditModal),
  // la page reste sur le volet de création.
  if (editingPlanId) {
    return <PlanPromptPanel />;
  }

  // Écran de succès après sauvegarde
  if (savedPlanName) {
    return (
      <Card className="text-center py-10">
        <p className="text-4xl mb-3">🎉</p>
        <h3 className="text-lg font-bold text-gray-900">Plan « {savedPlanName} » enregistré</h3>
        <p className="text-sm text-gray-500 mt-1 mb-6">
          Les règles de commission sont actives et les objectifs sont en place pour les membres assignés.
        </p>
        <Button onClick={reset}>Créer un nouveau plan</Button>
      </Card>
    );
  }

  // Volet 1 : pas encore de brouillon → saisie texte
  if (!draft) {
    return <PlanPromptPanel />;
  }

  // Volet 2 : dashboard de vérification
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <TruncatedText text={`📋 ${draft.name}`} className="text-base font-bold text-gray-900" as="h2" />
          <p className="text-xs text-gray-400">Vérifiez, ajustez, simulez — puis enregistrez.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={reset}>Repartir de zéro</Button>
      </div>

      <PlanExplainer />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ajuster les valeurs</p>
          {draft.components.map((component, i) => (
            <ComponentInlineEditor key={i} component={component} index={i} />
          ))}
          <PlanRepromptBar />
        </div>
        <div className="space-y-4">
          <PlanSimulator />
          <PlanBreakdown onRetry={() => void runSimulation()} />
        </div>
      </div>

      <PlanSavePanel />
    </div>
  );
}
