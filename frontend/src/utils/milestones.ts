/**
 * Étape 1 — « Prochain palier ».
 *
 * Repère, parmi les objectifs EN COURS d'un commercial, le jalon (palier de prime
 * ou cible à 100 %) le PLUS PROCHE d'être débloqué, pour l'afficher comme élément
 * motivant en haut du tableau de bord : « Plus que X pour débloquer +Y ».
 *
 * RÈGLE ARCHITECTURE : on ne recalcule AUCUN montant de variable ici. La progression
 * (actualValue, pct) vient du moteur backend (ObjectiveProgressItem). On ne fait que
 * mesurer une DISTANCE (combien il reste avant le prochain seuil) — la même opération
 * d'affichage que les cartes d'objectif existantes. Le libellé de récompense reprend
 * la définition brute de l'objectif (montant fixe en € ou pourcentage), jamais un
 * montant de prime « officiel ».
 */
import type { Objective, ObjectiveProgressItem } from '@shared/types';

export interface NextMilestone {
  objectiveId: string;
  objectiveLabel: string;
  unit: string;
  /** Distance restante, exprimée dans l'unité de l'objectif (€, deals…). */
  remaining: number;
  /** Écart en points de % vers le seuil — sert à comparer entre objectifs. */
  pctGap: number;
  /** Libellé de la récompense au déblocage : « +500 € » ou « +8 % du CA ». */
  rewardLabel: string;
  /** 'tier' = palier intermédiaire ; 'target' = atteinte de la cible (100 %). */
  kind: 'tier' | 'target';
  /** Seuil visé en % (100 pour la cible). */
  threshold: number;
}

function effectiveBonusMode(obj: Objective): 'none' | 'simple' | 'tiered' {
  return obj.bonusMode ?? (obj.bonus?.enabled ? 'simple' : 'none');
}

/**
 * Jalon le plus proche pour UN objectif, ou null si aucun (pas de prime, ou tout
 * déjà débloqué). `progress` provient du backend.
 */
export function milestoneForObjective(
  obj: Objective,
  progress: ObjectiveProgressItem | undefined,
): NextMilestone | null {
  const target = obj.target;
  if (!progress || target <= 0) return null;

  const current = progress.actualValue;
  const pct = progress.pct;
  const mode = effectiveBonusMode(obj);
  if (mode === 'none') return null;

  if (mode === 'tiered' && obj.bonusTiers && obj.bonusTiers.length > 0) {
    // Prochain palier non encore atteint (le plus bas au-dessus du % actuel).
    const next = [...obj.bonusTiers]
      .filter((t) => pct < t.threshold)
      .sort((a, b) => a.threshold - b.threshold)[0];
    if (!next) return null;
    const remaining = (next.threshold / 100) * target - current;
    if (remaining <= 0) return null;
    return {
      objectiveId: obj.id,
      objectiveLabel: obj.label || 'Objectif',
      unit: obj.unit,
      remaining,
      pctGap: next.threshold - pct,
      rewardLabel:
        next.reward.type === 'fixed'
          ? `+${formatEur(next.reward.value)}`
          : `+${next.reward.value} % du CA`,
      kind: 'tier',
      threshold: next.threshold,
    };
  }

  // Mode simple : le jalon est l'atteinte de la cible (100 %).
  if (mode === 'simple' && obj.bonus?.enabled && pct < 100) {
    const remaining = target - current;
    if (remaining <= 0) return null;
    return {
      objectiveId: obj.id,
      objectiveLabel: obj.label || 'Objectif',
      unit: obj.unit,
      remaining,
      pctGap: 100 - pct,
      rewardLabel:
        obj.bonus.type === 'fixed'
          ? `+${formatEur(obj.bonus.value)}`
          : `prime de +${obj.bonus.value} % au-delà`,
      kind: 'target',
      threshold: 100,
    };
  }

  return null;
}

/**
 * Parmi tous les objectifs en cours, retourne le jalon le plus proche d'être
 * débloqué (plus petit écart en % vers le seuil) — le plus motivant à afficher.
 */
export function computeNextMilestone(
  currentObjectives: Objective[],
  progressById: Map<string, ObjectiveProgressItem>,
): NextMilestone | null {
  const milestones = currentObjectives
    .map((obj) => milestoneForObjective(obj, progressById.get(obj.id)))
    .filter((m): m is NextMilestone => m !== null);
  if (milestones.length === 0) return null;
  return milestones.sort((a, b) => a.pctGap - b.pctGap)[0];
}

function formatEur(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

/** Formate une distance restante selon l'unité de l'objectif. */
export function formatMilestoneRemaining(m: NextMilestone): string {
  if (m.unit === '€' || m.unit === 'marge') return formatEur(m.remaining);
  if (m.unit === '%') return `${m.remaining.toFixed(1)} %`;
  const n = Math.ceil(m.remaining);
  return `${n} deal${n > 1 ? 's' : ''}`;
}
