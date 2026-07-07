import { Card } from '../ui/Card';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { formatEur } from './planDisplay';

interface ScenarioControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  format?: (v: number) => string;
}

function ScenarioControl({ label, value, min, max, step, unit, onChange, format }: ScenarioControlProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-600">{label}</label>
        <span className="text-xs font-semibold text-primary-700">{format ? format(value) : `${value} ${unit}`}</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-primary-600"
        />
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) onChange(v);
          }}
          className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
        />
      </div>
    </div>
  );
}

/**
 * Volet 2 — Scénarios paramétrables. Les contrôles affichés dépendent des
 * composants du plan (one-shot / récurrent / forfait consultant / objectifs).
 * Chaque changement redéclenche la simulation via l'API (debounce dans le parent).
 */
export function PlanSimulator() {
  const draft = useVariablePlanStore((s) => s.draft);
  const scenario = useVariablePlanStore((s) => s.scenario);
  const setScenario = useVariablePlanStore((s) => s.setScenario);
  if (!draft) return null;

  const rules = draft.components.filter((c) => c.kind === 'COMMISSION_RULE');
  const hasOneShot = rules.some((c) => c.kind === 'COMMISSION_RULE' && c.config.appliesToEventType !== 'MISSION_MONTH');
  const oneShotUsesMargin = rules.some(
    (c) => c.kind === 'COMMISSION_RULE' && c.config.appliesToEventType !== 'MISSION_MONTH' && c.config.calculationBasis === 'MARGIN',
  );
  const recurring = rules.filter((c) => c.kind === 'COMMISSION_RULE' && c.config.appliesToEventType === 'MISSION_MONTH');
  const hasRecurring = recurring.length > 0;
  const recurringUsesMargin = recurring.some((c) => c.kind === 'COMMISSION_RULE' && c.config.calculationBasis === 'MARGIN');
  const hasPerUnit = recurring.some((c) => c.kind === 'COMMISSION_RULE' && c.config.calculationBasis === 'PER_UNIT');
  const hasObjectives = draft.components.some((c) => c.kind === 'OBJECTIVE');

  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">🧪 Testez votre plan sur un scénario</h3>
      <p className="text-xs text-gray-400 mb-4">
        Faites varier les curseurs : le variable est recalculé par le moteur réel de GrowCom,
        exactement comme il le sera en production.
      </p>

      <div className="space-y-4">
        {hasOneShot && (
          <ScenarioControl
            label="Montant d'une vente one-shot"
            value={scenario.dealAmount}
            min={0} max={100000} step={500} unit="€"
            format={formatEur}
            onChange={(v) => setScenario({ dealAmount: v })}
          />
        )}
        {hasOneShot && oneShotUsesMargin && (
          <ScenarioControl
            label="Marge de cette vente"
            value={scenario.dealMargin ?? 0}
            min={0} max={100000} step={500} unit="€"
            format={formatEur}
            onChange={(v) => setScenario({ dealMargin: v })}
          />
        )}
        {hasRecurring && recurringUsesMargin && (
          <ScenarioControl
            label="Marge mensuelle de la mission"
            value={scenario.missionMonthlyMargin ?? 0}
            min={0} max={50000} step={250} unit="€"
            format={formatEur}
            onChange={(v) => setScenario({ missionMonthlyMargin: v })}
          />
        )}
        {hasRecurring && !recurringUsesMargin && !hasPerUnit && (
          <ScenarioControl
            label="CA mensuel de la mission"
            value={scenario.missionMonthlyAmount}
            min={0} max={100000} step={500} unit="€"
            format={formatEur}
            onChange={(v) => setScenario({ missionMonthlyAmount: v })}
          />
        )}
        {hasPerUnit && (
          <ScenarioControl
            label="Consultants placés"
            value={scenario.consultantCount}
            min={0} max={20} step={1} unit="consultant(s)"
            onChange={(v) => setScenario({ consultantCount: Math.round(v) })}
          />
        )}
        {hasRecurring && (
          <ScenarioControl
            label="Durée de la mission"
            value={scenario.missionMonths}
            min={1} max={36} step={1} unit="mois"
            onChange={(v) => setScenario({ missionMonths: Math.round(v) })}
          />
        )}
        {hasObjectives && (
          <ScenarioControl
            label="Atteinte des objectifs"
            value={scenario.objectiveAchievementPct}
            min={0} max={200} step={5} unit="%"
            onChange={(v) => setScenario({ objectiveAchievementPct: v })}
          />
        )}
      </div>
    </Card>
  );
}
