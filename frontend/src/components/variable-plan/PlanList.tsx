import { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { api } from '../../services/api';
import { variablePlanApiService, type VariablePlanDetails, type PlanComponentDetails } from '../../services/variablePlan.service';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { PlanEditModal } from './PlanEditModal';
import { getApiErrorMessage, humanizeCommission, humanizeObjective } from './planDisplay';
import type { PublicUser, PlanObjectiveInput, GeneratedPlanDraft, GeneratedPlanComponentDraft, Objective } from '@shared/types';

/**
 * Convertit un plan SAUVEGARDÉ en brouillon éditable dans l'interface de
 * simulation. Les composants commission gardent le `ruleId` de leur règle
 * réelle : à l'enregistrement, la règle est mise à jour en place (les membres
 * assignés suivent automatiquement).
 */
function planToDraft(plan: VariablePlanDetails): GeneratedPlanDraft {
  const components: GeneratedPlanComponentDraft[] = [];
  for (const c of plan.components) {
    if (c.kind === 'COMMISSION_RULE' && c.rule) {
      components.push({ kind: 'COMMISSION_RULE', ruleId: c.rule.id, name: c.rule.name, config: c.rule.config });
    } else if (c.kind === 'OBJECTIVE' && c.objectiveConfig) {
      const { id: _id, ...objective } = c.objectiveConfig as Objective & { id?: string };
      components.push({ kind: 'OBJECTIVE', objective: objective as unknown as PlanObjectiveInput });
    }
  }
  return { name: plan.name, description: plan.description, components };
}

function componentChip(component: PlanComponentDetails): { label: string; variant: 'blue' | 'purple' | 'green' } {
  if (component.kind === 'OBJECTIVE') {
    return { label: `🎯 ${component.objectiveConfig?.label ?? 'Objectif'}`, variant: 'green' };
  }
  const recurring = component.appliesToEventType === 'MISSION_MONTH';
  return {
    label: `${recurring ? '🔁' : '💰'} ${component.rule?.name ?? 'Règle'}`,
    variant: recurring ? 'purple' : 'blue',
  };
}

function componentTitle(component: PlanComponentDetails): string {
  if (component.kind === 'OBJECTIVE' && component.objectiveConfig) {
    return humanizeObjective(component.objectiveConfig as unknown as PlanObjectiveInput);
  }
  if (component.rule) {
    return humanizeCommission(component.rule.name, component.rule.config);
  }
  return '';
}

/**
 * « Plans de commission » : la bibliothèque des plans MODÈLES (Commercial junior,
 * senior, Responsable de secteur…). Remplace les anciennes listes séparées de
 * règles et d'objectifs. Un plan s'assigne à des membres en un clic ; les
 * ajustements par personne (taux, paliers…) se font ensuite dans Équipes.
 */
export function PlanList() {
  const [plans, setPlans] = useState<VariablePlanDetails[]>([]);
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigningPlanId, setAssigningPlanId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Re-charger quand un plan vient d'être enregistré depuis le volet de création
  const savedPlanName = useVariablePlanStore((s) => s.savedPlanName);
  const startEditing = useVariablePlanStore((s) => s.startEditing);

  // Ouvre le plan dans la popup d'édition (paramétrage + simulation)
  const openEdit = (plan: VariablePlanDetails) => {
    startEditing(plan.id, planToDraft(plan));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [planList, teamRes] = await Promise.all([
        variablePlanApiService.getAll(),
        api.get<{ success: true; data: PublicUser[] }>('/auth/team'),
      ]);
      setPlans(planList);
      setMembers(teamRes.data.data.filter((m) =>
        m.role === 'COMMERCIAL' || m.role === 'RECRUITER' || m.role === 'TEAM_LEAD',
      ));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, savedPlanName]);

  const openAssign = (planId: string) => {
    setAssigningPlanId(planId);
    setAssignError(null);
    const plan = plans.find((p) => p.id === planId);
    setSelectedIds(new Set(
      (plan?.assignments ?? []).map((a) => a.userId).filter((id): id is string => id !== null),
    ));
  };

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAssign = async () => {
    if (!assigningPlanId || selectedIds.size === 0) return;
    setAssignLoading(true);
    setAssignError(null);
    try {
      await variablePlanApiService.assignPlan(assigningPlanId, [...selectedIds]);
      setAssigningPlanId(null);
      await load();
    } catch (err: unknown) {
      setAssignError(getApiErrorMessage(err));
    } finally {
      setAssignLoading(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-900">📚 Vos plans de commission</h3>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Actualiser
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Vos modèles par profil (junior, senior, responsable de secteur…). Assignez un plan à un
        membre ici, puis ajustez ses valeurs (taux, paliers, objectifs) directement sur sa fiche
        dans <span className="font-medium">Équipes</span>.
      </p>

      {loading && (
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-red-600">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => void load()}>Réessayer</Button>
        </div>
      )}

      {!loading && !error && plans.length === 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-400">Aucun plan de commission pour le moment</p>
          <p className="text-xs text-gray-300 mt-1">
            Décrivez votre premier plan dans le bloc ci-dessus (ex : « Plan commercial senior : … »)
          </p>
        </div>
      )}

      <div className="space-y-3">
        {plans.map((plan) => (
          <div key={plan.id} className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">📋 {plan.name}</p>
                {plan.description && <p className="text-xs text-gray-400 mt-0.5">{plan.description}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button size="sm" variant="secondary" onClick={() => openEdit(plan)}>
                  ✏️ Modifier
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openAssign(plan.id)}>
                  Assigner
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {plan.components.map((component) => {
                const chip = componentChip(component);
                return (
                  <span key={component.id} title={componentTitle(component)}>
                    <Badge variant={chip.variant}>{chip.label}</Badge>
                  </span>
                );
              })}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-gray-400">Assigné à :</span>
              {plan.assignments.length === 0 ? (
                <span className="text-xs text-gray-300 italic">personne pour le moment</span>
              ) : (
                plan.assignments.map((a) => a.user && (
                  <span key={a.id} className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                    {a.user.firstName} {a.user.lastName}
                  </span>
                ))
              )}
            </div>

            {assigningPlanId === plan.id && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[11px] font-medium text-gray-500 mb-2">Choisissez les membres :</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {members.map((m) => {
                    const selected = selectedIds.has(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                          selected
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {selected ? '✓ ' : ''}{m.firstName} {m.lastName}
                      </button>
                    );
                  })}
                </div>
                {assignError && <p className="text-xs text-red-600 mb-2">{assignError}</p>}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAssigningPlanId(null)} disabled={assignLoading}>
                    Annuler
                  </Button>
                  <Button size="sm" onClick={() => void handleAssign()} disabled={selectedIds.size === 0 || assignLoading} loading={assignLoading}>
                    Assigner le plan
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Popup d'édition (paramétrage + simulation) */}
      <PlanEditModal />
    </Card>
  );
}
