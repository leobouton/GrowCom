/**
 * Étape 1 — Bannière « Prochain palier ».
 *
 * Met en avant, en haut du tableau de bord commercial, le jalon le plus proche
 * d'être débloqué : « Plus que X pour débloquer +Y ». C'est le levier de motivation
 * immédiate. Le calcul de distance vient de utils/milestones (aucun montant de
 * variable recalculé côté front — la progression provient du moteur backend).
 */
import type { NextMilestone } from '../../utils/milestones';
import { formatMilestoneRemaining } from '../../utils/milestones';

export function NextMilestoneBanner({ milestone }: { milestone: NextMilestone | null }) {
  if (!milestone) return null;

  const remaining = formatMilestoneRemaining(milestone);

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-2xl">
        🚀
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Prochain palier à débloquer</p>
        <p className="text-lg font-bold text-gray-900 leading-snug">
          Plus que <span className="text-amber-700">{remaining}</span> pour débloquer{' '}
          <span className="text-green-600">{milestone.rewardLabel}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          sur votre objectif « {milestone.objectiveLabel} »
          {milestone.kind === 'tier' ? ` — palier ${milestone.threshold} %` : ' — objectif atteint à 100 %'}
        </p>
      </div>
    </div>
  );
}
