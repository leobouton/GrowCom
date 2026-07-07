/**
 * POINT D'ENTRÉE UNIQUE du calcul de progression et de prime des objectifs.
 *
 * Consommateurs :
 * - le dashboard commercial (progression live, via getCommercialStats) ;
 * - le job snapshot quotidien 7h (objectiveSnapshot.service) ;
 * - la simulation de plan (variablePlanSimulation.service, computeBonus).
 *
 * RÈGLE ABSOLUE : le front n'effectue aucun calcul de variable, il affiche les
 * nombres produits ici. Deux chemins de calcul = interdit.
 *
 * Périmètre d'un objectif (règle métier existante, conservée) :
 * - deals WON dont la commission du commercial est VALIDATED ou PAID
 *   (via dealRepository.findWonForObjectives : DealAssignment + rétrocompat
 *   assignedToId, part userShare appliquée) ;
 * - CA récurrent des missions (events MISSION_MONTH à commission VALIDATED/PAID).
 *
 * Les fonctions de calcul sont PURES (aucun accès BDD) et testables unitairement.
 */
import type { Objective, ObjectiveBonusTier, ObjectiveProgressItem } from '../../../shared/types';

// ─── Helpers période (canonique, sans date-fns) ──────────────────────────────

export function getObjectiveDateRange(obj: Objective): [Date, Date] | null {
  const y = obj.year ?? new Date().getFullYear();

  if (obj.periodType === 'monthly') {
    const m = (obj.month ?? 1) - 1;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return [start, end];
  }
  if (obj.periodType === 'quarterly') {
    const q = obj.quarter ?? 1;
    const startMonth = (q - 1) * 3;
    const start = new Date(y, startMonth, 1);
    const end = new Date(y, startMonth + 3, 0, 23, 59, 59, 999);
    return [start, end];
  }
  if (obj.periodType === 'semester') {
    const s = obj.semester ?? 1;
    const startMonth = (s - 1) * 6; // S1 = 0 (jan), S2 = 6 (juil)
    const start = new Date(y, startMonth, 1);
    const end = new Date(y, startMonth + 6, 0, 23, 59, 59, 999);
    return [start, end];
  }
  if (obj.periodType === 'annual') {
    return [new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59, 999)];
  }
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return [new Date(obj.startDate), new Date(obj.endDate + 'T23:59:59.999Z')];
  }
  // Garde-fou : periodType non reconnu mais des infos de période existent -> on
  // devine, pour éviter que null fasse compter TOUS les deals de l'historique.
  if (obj.month && y) {
    const m = obj.month - 1;
    return [new Date(y, m, 1), new Date(y, m + 1, 0, 23, 59, 59, 999)];
  }
  if (obj.quarter && y) {
    const startMonth = (obj.quarter - 1) * 3;
    return [new Date(y, startMonth, 1), new Date(y, startMonth + 3, 0, 23, 59, 59, 999)];
  }
  return null;
}

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** Libellé de période stable (clé d'idempotence des snapshots). */
export function formatObjectivePeriod(obj: Objective): string {
  const y = obj.year ?? new Date().getFullYear();
  if (obj.periodType === 'monthly') return `${MONTHS_FR[(obj.month ?? 1) - 1]} ${y}`;
  if (obj.periodType === 'quarterly') return `T${obj.quarter ?? 1} ${y}`;
  if (obj.periodType === 'semester') return `S${obj.semester ?? 1} ${y}`;
  if (obj.periodType === 'annual') return `Année ${y}`;
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    const fmt = (d: string) => {
      const [yy, mm, dd] = d.split('-');
      return `${dd}/${mm}/${yy.slice(2)}`;
    };
    return `${fmt(obj.startDate)} → ${fmt(obj.endDate)}`;
  }
  return 'Période perso.';
}

export function isObjectiveEnded(obj: Objective): boolean {
  const range = getObjectiveDateRange(obj);
  if (!range) return false;
  return new Date() > range[1];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Entrées du calcul (indépendantes de Prisma, pures) ──────────────────────

/** Deal WON éligible aux objectifs (commission VALIDATED/PAID), avec sa part. */
export interface ObjectiveWonDeal {
  amount: number;
  marginAmount?: number | null;
  costAmount?: number | null;
  userShare?: number;
  closedAt: Date | null;
  syncedAt: Date | null;
}

/**
 * RÈGLE UNIQUE de résolution de la marge pour les MÉTRIQUES (objectifs, concours) :
 * - marginAmount si renseigné ;
 * - sinon amount - costAmount si le coût est connu ;
 * - sinon null = le deal est EXCLU de la métrique (jamais de repli sur le CA :
 *   compter un CA entier comme de la marge fausserait objectifs et classements).
 * Même philosophie que le moteur de COMMISSION (resolveBasisAmount) : marge
 * inconnue = base 0, jamais de repli sur le CA (décision Léo 2026-07-06).
 */
export function resolveMarginForMetrics(d: {
  amount: number;
  marginAmount?: number | null;
  costAmount?: number | null;
}): number | null {
  if (d.marginAmount !== null && d.marginAmount !== undefined) return d.marginAmount;
  if (d.costAmount !== null && d.costAmount !== undefined) return d.amount - d.costAmount;
  return null;
}

/** Mois de mission éligible (event MISSION_MONTH à commission VALIDATED/PAID). */
export interface ObjectiveMissionMonth {
  amount: number;
  marginAmount?: number | null;
  periodMonth: Date | null;
}

// ─── Calcul de la valeur atteinte ─────────────────────────────────────────────

/**
 * Valeur actuelle d'un objectif :
 * - unité 'deals' : nombre de ventes one-shot de la période (les mois de mission
 *   ne comptent pas comme des ventes) ;
 * - unité 'marge' : somme des marges × part (deals sans marge exclus)
 *   + marges mensuelles des missions ;
 * - unité '€' (défaut) : somme des montants × part + CA mensuel des missions.
 * Un deal sans date (closedAt et syncedAt nuls) n'est jamais compté.
 */
export function computeObjectiveActual(
  obj: Objective,
  wonDeals: ObjectiveWonDeal[],
  missionMonths: ObjectiveMissionMonth[] = [],
): number {
  const range = getObjectiveDateRange(obj);

  const isInPeriod = (d: ObjectiveWonDeal): boolean => {
    if (!range) return true;
    const date = d.closedAt ?? d.syncedAt;
    if (!date) return false;
    const t = date.getTime();
    return t >= range[0].getTime() && t <= range[1].getTime();
  };

  const dealsToCount = wonDeals.filter(isInPeriod);

  if (obj.unit === 'deals') return dealsToCount.length;

  const missionsInPeriod = missionMonths.filter((m) => {
    if (m.periodMonth === null) return false;
    if (!range) return true;
    const t = m.periodMonth.getTime();
    return t >= range[0].getTime() && t <= range[1].getTime();
  });

  if (obj.unit === 'marge') {
    const dealsMargin = dealsToCount.reduce((sum, d) => {
      const margin = resolveMarginForMetrics(d);
      if (margin === null) return sum;
      return sum + margin * (d.userShare ?? 1);
    }, 0);
    const missionsMargin = missionsInPeriod.reduce((sum, m) => sum + (m.marginAmount ?? 0), 0);
    return dealsMargin + missionsMargin;
  }

  // Unité '€' et repli par défaut : chiffre d'affaires
  const dealsRevenue = dealsToCount.reduce((sum, d) => sum + d.amount * (d.userShare ?? 1), 0);
  const missionsRevenue = missionsInPeriod.reduce((sum, m) => sum + m.amount, 0);
  return dealsRevenue + missionsRevenue;
}

/** Nombre de deals de la période dont la marge est inconnue (objectifs marge). */
export function countDealsWithoutMargin(obj: Objective, wonDeals: ObjectiveWonDeal[]): number {
  if (obj.unit !== 'marge') return 0;
  const range = getObjectiveDateRange(obj);
  const filtered = wonDeals.filter((d) => {
    if (!range) return true;
    const date = d.closedAt ?? d.syncedAt;
    if (!date) return false;
    const t = date.getTime();
    return t >= range[0].getTime() && t <= range[1].getTime();
  });
  return filtered.filter((d) => resolveMarginForMetrics(d) === null).length;
}

// ─── Calcul de la prime ───────────────────────────────────────────────────────

/**
 * Prime d'un objectif selon son mode :
 * - none : 0 ;
 * - tiered : cumul de tous les paliers atteints (fixe ou % du réalisé) ;
 * - simple : fixe ou % de l'excédent au-delà de la cible.
 */
export function computeBonus(obj: Objective, current: number): number {
  const bonus = obj.bonus ?? { enabled: false, type: 'percentage' as const, value: 0 };
  const pct = obj.target > 0 ? (current / obj.target) * 100 : 0;
  const mode = obj.bonusMode ?? (bonus.enabled ? 'simple' : 'none');

  if (mode === 'none') return 0;

  if (mode === 'tiered' && obj.bonusTiers && obj.bonusTiers.length > 0) {
    const reachedTiers = [...obj.bonusTiers]
      .filter((tier: ObjectiveBonusTier) => pct >= tier.threshold)
      .sort((a: ObjectiveBonusTier, b: ObjectiveBonusTier) => a.threshold - b.threshold);
    if (reachedTiers.length === 0) return 0;
    let total = 0;
    for (const tier of reachedTiers) {
      total += tier.reward.type === 'fixed'
        ? tier.reward.value
        : current * (tier.reward.value / 100);
    }
    return total;
  }

  if (!bonus.enabled || current <= obj.target) return 0;
  const excess = current - obj.target;
  return bonus.type === 'percentage' ? excess * (bonus.value / 100) : bonus.value;
}

// ─── Assemblage : progression de tous les objectifs d'un commercial ──────────

/** Snapshot minimal nécessaire pour servir les objectifs passés sans recalcul. */
export interface ObjectiveSnapshotLike {
  objectiveId: string;
  periodLabel: string;
  actualValue: number;
  bonusEarned: number;
}

/**
 * Construit la progression de chaque objectif :
 * - objectif terminé ET déjà figé -> valeurs du snapshot (JAMAIS recalculées) ;
 * - sinon -> calcul live par les fonctions ci-dessus.
 * Montants arrondis à 2 décimales au point de sortie.
 */
export function buildObjectivesProgress(
  objectives: Objective[],
  wonDeals: ObjectiveWonDeal[],
  missionMonths: ObjectiveMissionMonth[],
  snapshots: ObjectiveSnapshotLike[],
): ObjectiveProgressItem[] {
  const snapshotByKey = new Map<string, ObjectiveSnapshotLike>();
  for (const s of snapshots) {
    snapshotByKey.set(`${s.objectiveId}|${s.periodLabel}`, s);
  }

  return objectives.map((obj) => {
    const snapshot = snapshotByKey.get(`${obj.id}|${formatObjectivePeriod(obj)}`);
    if (snapshot && isObjectiveEnded(obj)) {
      const actualValue = round2(snapshot.actualValue);
      return {
        objectiveId: obj.id,
        actualValue,
        pct: obj.target > 0 ? round2((actualValue / obj.target) * 100) : 0,
        bonusProjected: round2(snapshot.bonusEarned),
        dealsWithoutMargin: 0,
        source: 'SNAPSHOT' as const,
      };
    }

    const actualValue = round2(computeObjectiveActual(obj, wonDeals, missionMonths));
    // Transparence : part du récurrent = total − (même calcul sans les missions).
    // Répond au « d'où vient ce chiffre ? » du commercial sur son dashboard.
    const dealsOnlyValue = round2(computeObjectiveActual(obj, wonDeals, []));
    return {
      objectiveId: obj.id,
      actualValue,
      pct: obj.target > 0 ? round2((actualValue / obj.target) * 100) : 0,
      bonusProjected: round2(computeBonus(obj, actualValue)),
      dealsWithoutMargin: countDealsWithoutMargin(obj, wonDeals),
      source: 'LIVE' as const,
      recurringValue: round2(actualValue - dealsOnlyValue),
    };
  });
}
