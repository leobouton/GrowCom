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
  // Avancement vers le seuil visé (affichage seulement : % actuel = seuil − écart)
  const progressPct = Math.min(100, Math.max(0, ((milestone.threshold - milestone.pctGap) / milestone.threshold) * 100));

  // Même encadré que le bordereau du site : fond anis, barre encre, point vert au bout
  return (
    <div className="bg-lime-soft rounded-2xl px-5 py-5 sm:px-6">
      <p className="eyebrow text-ink-soft">Prochain palier à débloquer</p>
      <p className="mt-2 text-lg font-semibold text-ink leading-snug">
        Plus que <strong className="num font-bold">{remaining}</strong> pour débloquer{' '}
        <strong className="font-bold text-growth">{milestone.rewardLabel}</strong>
      </p>
      <p className="text-xs text-muted mt-0.5">
        sur votre objectif « {milestone.objectiveLabel} »
        {milestone.kind === 'tier' ? ` — palier ${milestone.threshold} %` : ' — objectif atteint à 100 %'}
      </p>
      <div
        className="relative mt-4 h-2.5 rounded-full bg-[#dfe6c4]"
        role="img"
        aria-label={`Progression vers le prochain palier : ${Math.round(progressPct)} %`}
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${Math.max(6, progressPct)}%` }}>
          <div className="h-full w-full rounded-full bg-ink" />
          <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-ink bg-lime" />
        </div>
      </div>
    </div>
  );
}
