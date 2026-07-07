import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { TruncatedText } from '../ui/TruncatedText';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { formatEur } from './planDisplay';

const KIND_LABELS: Record<string, string> = {
  ONE_SHOT: 'À la vente',
  RECURRING: 'Chaque mois',
  OBJECTIVE_BONUS: 'Prime d\'objectif',
};

/**
 * Volet 2 — Résultat de la simulation : le variable décomposé composant par
 * composant, avec les totaux. Tout vient de l'API (moteur réel).
 */
export function PlanBreakdown({ onRetry }: { onRetry: () => void }) {
  const simulation = useVariablePlanStore((s) => s.simulation);
  const loading = useVariablePlanStore((s) => s.loading.simulate);
  const error = useVariablePlanStore((s) => s.error.simulate);
  const scenario = useVariablePlanStore((s) => s.scenario);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">💶 Ce que toucherait votre commercial</h3>
        {loading && (
          <span className="flex items-center gap-2 text-xs text-gray-400">
            <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Calcul en cours…
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 flex items-center justify-between gap-3">
          <p className="text-xs text-red-600">{error}</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>
        </div>
      )}

      {!simulation && !error && (
        <p className="text-sm text-gray-400">La simulation s'affichera ici dès le premier calcul.</p>
      )}

      {simulation && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="space-y-2 mb-4">
            {simulation.lines.map((line) => (
              <div key={`${line.componentIndex}-${line.kind}`} className="border border-gray-100 rounded-lg px-3 py-2 bg-gray-50/50">
                <div className="flex items-center justify-between gap-3">
                  <TruncatedText text={line.componentName} className="text-sm font-medium text-gray-800" />
                  <p className="text-sm font-bold text-gray-900 whitespace-nowrap">
                    {formatEur(line.amount)}
                    {line.kind === 'RECURRING' && <span className="text-xs font-medium text-gray-400"> /mois</span>}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 mt-0.5">
                  <TruncatedText
                    text={`${KIND_LABELS[line.kind]} — ${line.explanation}`}
                    className="text-xs text-gray-500"
                  />
                  {line.kind === 'RECURRING' && line.projectedTotal !== undefined && (
                    <p className="text-xs text-gray-500 whitespace-nowrap">
                      × {line.months} mois = <span className="font-semibold text-gray-700">{formatEur(line.projectedTotal)}</span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="rounded-lg bg-blue-50 px-3 py-2">
              <p className="text-[11px] font-medium text-blue-600">One-shot</p>
              <p className="text-sm font-bold text-blue-800">{formatEur(simulation.totalOneShot)}</p>
            </div>
            <div className="rounded-lg bg-purple-50 px-3 py-2">
              <p className="text-[11px] font-medium text-purple-600">Récurrent / mois</p>
              <p className="text-sm font-bold text-purple-800">{formatEur(simulation.totalMonthly)}</p>
            </div>
            <div className="rounded-lg bg-green-50 px-3 py-2">
              <p className="text-[11px] font-medium text-green-600">Primes d'objectifs</p>
              <p className="text-sm font-bold text-green-800">{formatEur(simulation.totalObjectiveBonus)}</p>
            </div>
          </div>

          <div className="rounded-xl bg-primary-600 text-white px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-medium">Total sur {scenario.missionMonths} mois simulés</p>
            <p className="text-xl font-bold">{formatEur(simulation.grandTotal)}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
