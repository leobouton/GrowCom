import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { componentBadge, humanizeComponent } from './planDisplay';

/**
 * Volet 2 — Bloc explicatif pas-à-pas : « voici ce que j'ai compris : 1) … 2) … »,
 * un point par composant, en français métier (jamais de JSON).
 */
export function PlanExplainer() {
  const draft = useVariablePlanStore((s) => s.draft);
  if (!draft) return null;

  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Voici ce que j'ai compris de votre plan</h3>
      <p className="text-xs text-gray-400 mb-4">{draft.description}</p>
      <ol className="space-y-3">
        {draft.components.map((component, i) => {
          const badge = componentBadge(component);
          return (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0">
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <p className="text-sm text-gray-700 mt-1">{humanizeComponent(component)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
