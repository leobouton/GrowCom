import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TruncatedText } from '../ui/TruncatedText';
import { variablePlanApiService } from '../../services/variablePlan.service';
import { ruleAssignmentApiService } from '../../services/ruleAssignment.service';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { getApiErrorMessage, validateComponent } from './planDisplay';
import { ComponentInlineEditor } from './ComponentInlineEditor';
import { PlanRepromptBar } from './PlanRepromptBar';
import { PlanSimulator } from './PlanSimulator';
import { PlanBreakdown } from './PlanBreakdown';
import type { GeneratedPlanComponentDraft } from '@shared/types';
import { CommissionRuleType } from '@shared/types';

const SIMULATE_DEBOUNCE_MS = 400;

type EditTab = 'settings' | 'simulation';

/** Membre assigné au plan, avec l'état de ses personnalisations individuelles. */
interface ImpactedMember {
  id: string;
  name: string;
  /** A un ajustement personnel (taux, montant…) sur une règle du plan — il sera conservé. */
  hasOverride: boolean;
  /** A retiré individuellement une règle du plan — elle ne sera pas réactivée. */
  hasRemovedRule: boolean;
}

/** Composants par défaut pour l'ajout manuel (modifiables ensuite dans l'éditeur). */
function defaultCommissionComponent(): GeneratedPlanComponentDraft {
  return {
    kind: 'COMMISSION_RULE',
    name: 'Nouvelle commission',
    config: {
      type: CommissionRuleType.PERCENTAGE,
      description: 'Commission de 5 % du montant de la vente',
      rate: 0.05,
      appliesToEventType: 'DEAL_WON',
      examples: [{ saleAmount: 10000, commission: 500, explanation: '10 000 € × 5 % = 500 €' }],
    },
  };
}

function defaultTieredCommissionComponent(): GeneratedPlanComponentDraft {
  return {
    kind: 'COMMISSION_RULE',
    name: 'Commission par paliers',
    config: {
      type: CommissionRuleType.TIERED,
      description: 'Commission par paliers sur le montant de la vente',
      tiers: [
        { min: 0, max: 50000, rate: 0.03 },
        { min: 50000, max: null, rate: 0.05 },
      ],
      appliesToEventType: 'DEAL_WON',
      examples: [{ saleAmount: 60000, commission: 2000, explanation: '50 000 € × 3 % + 10 000 € × 5 % = 2 000 €' }],
    },
  };
}

function defaultObjectiveComponent(): GeneratedPlanComponentDraft {
  const now = new Date();
  return {
    kind: 'OBJECTIVE',
    objective: {
      label: 'Nouvel objectif',
      target: 50000,
      unit: '€',
      periodType: 'quarterly',
      quarter: Math.ceil((now.getMonth() + 1) / 3),
      year: now.getFullYear(),
      bonusMode: 'simple',
      bonus: { enabled: true, type: 'fixed', value: 500 },
    },
  };
}

/**
 * Popup d'ÉDITION d'un plan sauvegardé — deux onglets :
 * - ⚙️ Paramétrage : nom/description, composants éditables (valeurs, paliers,
 *   primes, options avancées), ajout/retrait de composants, re-prompt IA.
 * - 📊 Simulation : scénario interactif + décomposition calculée par le moteur réel.
 * La simulation se recalcule en continu, quel que soit l'onglet actif.
 */
export function PlanEditModal() {
  const draft = useVariablePlanStore((s) => s.draft);
  const editingPlanId = useVariablePlanStore((s) => s.editingPlanId);
  const savedPlanName = useVariablePlanStore((s) => s.savedPlanName);
  const scenario = useVariablePlanStore((s) => s.scenario);
  const loading = useVariablePlanStore((s) => s.loading);
  const error = useVariablePlanStore((s) => s.error);
  const setSimulation = useVariablePlanStore((s) => s.setSimulation);
  const setLoading = useVariablePlanStore((s) => s.setLoading);
  const setError = useVariablePlanStore((s) => s.setError);
  const setSavedPlanName = useVariablePlanStore((s) => s.setSavedPlanName);
  const setPlanMeta = useVariablePlanStore((s) => s.setPlanMeta);
  const addComponent = useVariablePlanStore((s) => s.addComponent);
  const reset = useVariablePlanStore((s) => s.reset);

  const [tab, setTab] = useState<EditTab>('settings');

  // Popup de confirmation : liste des membres impactés par la mise à jour
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactedMembers, setImpactedMembers] = useState<ImpactedMember[]>([]);

  const isOpen = editingPlanId !== null;

  // Repartir sur l'onglet Paramétrage à chaque ouverture + mémoriser l'état initial
  // du plan pour détecter les modifications non enregistrées à la fermeture
  const [initialDraftJson, setInitialDraftJson] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen) {
      setTab('settings');
      setInitialDraftJson(JSON.stringify(useVariablePlanStore.getState().draft));
    }
  }, [isOpen, editingPlanId]);

  /** Fermeture avec garde-fou : prévenir si des modifications ne sont pas enregistrées. */
  const handleClose = () => {
    const isDirty = initialDraftJson !== null && JSON.stringify(draft) !== initialDraftJson;
    if (isDirty && !savedPlanName) {
      const ok = window.confirm(
        'Vos modifications ne sont PAS enregistrées.\n\n' +
        'Pour les appliquer aux membres du plan, cliquez sur « Mettre à jour le plan ».\n\n' +
        'Fermer quand même et perdre les modifications ?',
      );
      if (!ok) return;
    }
    reset();
  };

  const runSimulation = useCallback(async () => {
    if (!draft || !isOpen) return;
    if (draft.components.length === 0) return;
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
  }, [draft, scenario, isOpen, setSimulation, setLoading, setError]);

  // Recalcul débouncé à chaque changement du plan ou du scénario
  useEffect(() => {
    if (!draft || !isOpen) return;
    const timer = setTimeout(() => { void runSimulation(); }, SIMULATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, scenario, isOpen, runSimulation]);

  const handleUpdate = async () => {
    if (!editingPlanId || !draft) return;
    setLoading('save', true);
    setError('save', null);
    try {
      const saved = await variablePlanApiService.update(editingPlanId, draft);
      setSavedPlanName(saved.name);
    } catch (err: unknown) {
      setError('save', getApiErrorMessage(err));
    } finally {
      setLoading('save', false);
    }
  };

  /**
   * Avant la mise à jour : construit la liste des membres assignés au plan
   * (avec leurs personnalisations individuelles) et ouvre la popup d'impact.
   */
  const openConfirm = async () => {
    if (!editingPlanId) return;
    setImpactLoading(true);
    setError('save', null);
    try {
      const plans = await variablePlanApiService.getAll();
      const current = plans.find((p) => p.id === editingPlanId);
      const assignedUsers = (current?.assignments ?? []).filter((a) => a.userId && a.user);
      const planRuleIds = new Set(
        (current?.components ?? []).filter((c) => c.ruleId !== null).map((c) => c.ruleId as string),
      );
      const members = await Promise.all(
        assignedUsers.map(async (a): Promise<ImpactedMember> => {
          let hasOverride = false;
          let hasRemovedRule = false;
          try {
            const assignments = await ruleAssignmentApiService.getForUser(a.userId as string);
            for (const ra of assignments) {
              if (!planRuleIds.has(ra.ruleId)) continue;
              if (ra.isActive && ra.overrides && Object.keys(ra.overrides).length > 0) hasOverride = true;
              if (!ra.isActive) hasRemovedRule = true;
            }
          } catch {
            // membre hors périmètre de lecture : on le liste quand même
          }
          return {
            id: a.userId as string,
            name: `${a.user?.firstName ?? ''} ${a.user?.lastName ?? ''}`.trim(),
            hasOverride,
            hasRemovedRule,
          };
        }),
      );
      setImpactedMembers(members);
      setConfirmOpen(true);
    } catch (err: unknown) {
      setError('save', getApiErrorMessage(err));
    } finally {
      setImpactLoading(false);
    }
  };

  if (!isOpen || !draft) return null;

  const hasInvalidComponent = draft.components.some((c) => validateComponent(c) !== null);
  const isEmpty = draft.components.length === 0;

  // Écran de succès après mise à jour
  if (savedPlanName) {
    return (
      <Modal isOpen onClose={reset} title="Plan mis à jour" size="md">
        <div className="text-center py-6">
          <p className="text-4xl mb-3">🎉</p>
          <h3 className="text-lg font-bold text-gray-900">Plan « {savedPlanName} » mis à jour</h3>
          <p className="text-sm text-gray-500 mt-1 mb-6">
            Les règles et objectifs des membres assignés ont été synchronisés,
            et leurs commissions recalculées automatiquement.
          </p>
          <Button onClick={reset}>Fermer</Button>
        </div>
      </Modal>
    );
  }

  return (
    <>
    <Modal isOpen onClose={handleClose} title={`✏️ Modifier « ${draft.name} »`} size="xl">
      <div className="space-y-4">
        {/* Onglets */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([
            ['settings', '⚙️ Paramétrage'],
            ['simulation', '📊 Simulation'],
          ] as [EditTab, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex-1 text-sm font-medium py-2 px-4 rounded-lg transition-colors ${
                tab === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'settings' && (
          <div className="space-y-4">
            {/* Nom + description du plan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">Nom du plan</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setPlanMeta({ name: e.target.value })}
                  className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">Description</span>
                <input
                  type="text"
                  value={draft.description}
                  onChange={(e) => setPlanMeta({ description: e.target.value })}
                  className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                />
              </label>
            </div>

            {/* Composants du plan */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Composants du plan</p>
              {isEmpty && (
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center">
                  <p className="text-sm text-gray-400">Le plan est vide — ajoutez au moins un composant ci-dessous.</p>
                </div>
              )}
              {draft.components.map((component, i) => (
                <ComponentInlineEditor key={i} component={component} index={i} />
              ))}

              {/* Ajout manuel de composants */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => addComponent(defaultCommissionComponent())}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  + Commission (%)
                </button>
                <button
                  type="button"
                  onClick={() => addComponent(defaultTieredCommissionComponent())}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  + Commission par paliers
                </button>
                <button
                  type="button"
                  onClick={() => addComponent(defaultObjectiveComponent())}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border border-dashed border-green-300 text-green-600 hover:bg-green-50 transition-colors"
                >
                  + Objectif avec prime
                </button>
              </div>
            </div>

            {/* Re-prompt IA pour les refontes plus profondes */}
            <PlanRepromptBar />
          </div>
        )}

        {tab === 'simulation' && (
          <div className="space-y-4">
            {hasInvalidComponent && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                La simulation est en pause : corrigez d'abord les valeurs signalées en rouge dans l'onglet Paramétrage.
              </p>
            )}
            <PlanSimulator />
            <PlanBreakdown onRetry={() => void runSimulation()} />
          </div>
        )}

        {/* Pied : erreurs + actions */}
        <div className="pt-3 border-t border-gray-100 space-y-2">
          {error.save && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs text-red-600">{error.save}</p>
            </div>
          )}
          {hasInvalidComponent && tab === 'settings' && (
            <p className="text-xs text-amber-600">
              Corrigez les valeurs signalées en rouge avant de mettre à jour.
            </p>
          )}
          <div className="flex justify-between items-center gap-3">
            <p className="text-[11px] text-gray-400">
              La mise à jour s'applique automatiquement aux membres déjà assignés au plan.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <Button variant="secondary" onClick={handleClose} disabled={loading.save}>
                Annuler
              </Button>
              <Button
                onClick={() => void openConfirm()}
                disabled={loading.save || impactLoading || hasInvalidComponent || isEmpty}
                loading={impactLoading}
              >
                Mettre à jour le plan
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>

    {/* Popup d'impact : qui est concerné par cette mise à jour ? */}
    <Modal
      isOpen={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      title="Qui est impacté par cette mise à jour ?"
      size="md"
    >
      <div className="space-y-4">
        {impactedMembers.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
            <p className="text-sm text-gray-600">
              Personne n'est encore assigné à ce plan — la mise à jour ne change
              la rémunération d'aucun membre.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Ce changement s'appliquera immédiatement à{' '}
              <strong>{impactedMembers.length} personne{impactedMembers.length > 1 ? 's' : ''}</strong>,
              et leurs commissions seront recalculées :
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {impactedMembers.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-100 bg-gray-50">
                  <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary-700 font-semibold text-[10px]">
                      {m.name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <TruncatedText text={m.name} className="text-sm font-medium text-gray-900 flex-1 min-w-0" />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {m.hasOverride && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-100 text-primary-700"
                        title="Ce membre a un ajustement personnel (taux, montant…) sur une règle du plan : il sera conservé et restera prioritaire sur le nouveau barème."
                      >
                        Ajustement personnel conservé
                      </span>
                    )}
                    {m.hasRemovedRule && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800"
                        title="Une règle du plan a été retirée individuellement pour ce membre : elle ne sera pas réactivée par la mise à jour."
                      >
                        Règle retirée non réactivée
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {impactedMembers.some((m) => m.hasOverride || m.hasRemovedRule) && (
              <p className="text-xs text-gray-400">
                Les personnalisations individuelles (ajustements, règles retirées) faites
                depuis la fiche d'un membre restent prioritaires sur le plan.
              </p>
            )}
          </>
        )}
        <div className="flex gap-3 justify-end pt-1">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={loading.save}>
            Annuler
          </Button>
          <Button
            onClick={() => { setConfirmOpen(false); void handleUpdate(); }}
            loading={loading.save}
          >
            Confirmer la mise à jour
          </Button>
        </div>
      </div>
    </Modal>
    </>
  );
}
