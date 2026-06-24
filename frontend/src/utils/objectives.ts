/**
 * Utilitaires partagés pour les objectifs commerciaux.
 * Utilisés par CommercialDashboard (affichage), TeamPage et ParametragePage (édition),
 * et potentiellement par les services de snapshot côté backend.
 */
import {
  startOfMonth, endOfMonth, startOfQuarter, endOfQuarter,
  startOfYear, endOfYear, isWithinInterval, parseISO,
} from 'date-fns';
import { format } from 'date-fns';
import type { Objective, ObjectiveBonusTier } from '@shared/types';

// ─── Date helpers ─────────────────────────────────────────────

/** Retourne [début, fin] de la période d'un objectif. */
export function getObjectiveDateRange(obj: Objective): [Date, Date] | null {
  const y = obj.year ?? new Date().getFullYear();

  if (obj.periodType === 'monthly') {
    const month = (obj.month ?? new Date().getMonth() + 1) - 1;
    const d = new Date(y, month, 1);
    return [startOfMonth(d), endOfMonth(d)];
  }
  if (obj.periodType === 'quarterly') {
    const q = obj.quarter ?? Math.ceil((new Date().getMonth() + 1) / 3);
    const monthStart = (q - 1) * 3;
    const d = new Date(y, monthStart, 1);
    return [startOfQuarter(d), endOfQuarter(d)];
  }
  if (obj.periodType === 'semester') {
    const s = obj.semester ?? 1;
    const startMonth = (s - 1) * 6; // S1 = jan (0), S2 = jul (6)
    const start = new Date(y, startMonth, 1);
    const end = new Date(y, startMonth + 6, 0, 23, 59, 59, 999);
    return [start, end];
  }
  if (obj.periodType === 'annual') {
    return [startOfYear(new Date(y, 0, 1)), endOfYear(new Date(y, 0, 1))];
  }
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return [parseISO(obj.startDate), parseISO(obj.endDate)];
  }
  // Garde-fou : si periodType n'est pas reconnu mais qu'on a des infos de période,
  // tenter de deviner. Évite que null → tous les deals comptés
  if (obj.month && y) {
    const d = new Date(y, obj.month - 1, 1);
    return [startOfMonth(d), endOfMonth(d)];
  }
  if (obj.quarter && y) {
    const monthStart = (obj.quarter - 1) * 3;
    const d = new Date(y, monthStart, 1);
    return [startOfQuarter(d), endOfQuarter(d)];
  }
  return null;
}

/** Indique si la période de l'objectif couvre aujourd'hui. */
export function isObjectiveCurrent(obj: Objective): boolean {
  const range = getObjectiveDateRange(obj);
  if (!range) return false;
  return isWithinInterval(new Date(), { start: range[0], end: range[1] });
}

/** Indique si la période de l'objectif est dans le futur. */
export function isObjectiveFuture(obj: Objective): boolean {
  const range = getObjectiveDateRange(obj);
  if (!range) return false;
  return new Date() < range[0];
}

// ─── Libellé de période ───────────────────────────────────────

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

/** Retourne un libellé lisible pour la période d'un objectif. */
export function formatObjectivePeriod(obj: Objective): string {
  const y = obj.year ?? new Date().getFullYear();
  if (obj.periodType === 'monthly') return `${MONTHS_FR[(obj.month ?? 1) - 1]} ${y}`;
  if (obj.periodType === 'quarterly') return `T${obj.quarter ?? 1} ${y}`;
  if (obj.periodType === 'semester') return `S${obj.semester ?? 1} ${y}`;
  if (obj.periodType === 'annual') return `Année ${y}`;
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return `${format(parseISO(obj.startDate), 'dd/MM/yy')} → ${format(parseISO(obj.endDate), 'dd/MM/yy')}`;
  }
  return 'Période perso.';
}

// ─── Calcul de progression ────────────────────────────────────

export interface WonDealLike {
  amount: number;
  marginAmount?: number | null;
  userShare?: number;
  closedAt: string | null;
  syncedAt: string | null;
}

/**
 * Calcule la valeur actuelle d'un objectif depuis les deals WON.
 * Filtre par période si possible, sinon retourne le total global.
 *
 * Chantier 1 — Règles de calcul :
 * - Se base uniquement sur les deals WON (les deals avec commission CANCELLED sont déjà
 *   exclus côté backend via findWonForObjectives)
 * - Applique userShare (part du DealAssignment) pour les deals splittés
 * - Pour les objectifs marge (unit === 'marge'), utilise marginAmount ; si null → vente non comptée
 * - Pour les objectifs CA (unit === '€'), utilise amount × userShare
 * - Pour les objectifs deals (unit === 'deals'), compte le nombre de deals (1 par deal, même splitté)
 */
export function computeProgress(obj: Objective, wonDeals: WonDealLike[]): number {
  if (wonDeals.length === 0) return 0;

  const range = getObjectiveDateRange(obj);

  const isInPeriod = (d: WonDealLike): boolean => {
    if (!range) return true;
    const dateStr = d.closedAt ?? d.syncedAt;
    // Un deal sans date ne doit PAS être compté dans chaque période —
    // on l'exclut pour éviter de gonfler tous les mois
    if (!dateStr) return false;
    return isWithinInterval(new Date(dateStr), { start: range[0], end: range[1] });
  };

  const filtered = wonDeals.filter(isInPeriod);
  if (filtered.length === 0 && range) {
    // Aucun deal dans la période → retourner 0 plutôt que fallback global
    return 0;
  }

  const dealsToCount = filtered.length > 0 ? filtered : wonDeals;

  if (obj.unit === 'deals') return dealsToCount.length;

  // Objectif marge : utiliser marginAmount, ignorer les deals sans marge
  if (obj.unit === 'marge') {
    return dealsToCount.reduce((sum, d) => {
      if (d.marginAmount === null || d.marginAmount === undefined) return sum;
      const share = d.userShare ?? 1;
      return sum + d.marginAmount * share;
    }, 0);
  }

  // Objectif CA (défaut) : utiliser amount × userShare
  return dealsToCount.reduce((sum, d) => {
    const share = d.userShare ?? 1;
    return sum + d.amount * share;
  }, 0);
}

/**
 * Compte le nombre de deals dont la marge est inconnue dans la période d'un objectif marge.
 * Utilisé pour afficher un warning discret côté commercial.
 */
export function countDealsWithoutMargin(obj: Objective, wonDeals: WonDealLike[]): number {
  if (obj.unit !== 'marge') return 0;
  const range = getObjectiveDateRange(obj);
  const filtered = range
    ? wonDeals.filter((d) => {
        const dateStr = d.closedAt ?? d.syncedAt;
        if (!dateStr) return false;
        return isWithinInterval(new Date(dateStr), { start: range[0], end: range[1] });
      })
    : wonDeals;
  return filtered.filter((d) => d.marginAmount === null || d.marginAmount === undefined).length;
}

// ─── Calcul du bonus ──────────────────────────────────────────

/**
 * Calcule la prime gagnée selon la configuration de l'objectif.
 * Supporte les modes : none, simple (bonus.enabled), tiered (bonusTiers).
 */
export function computeBonus(
  obj: Objective,
  current: number,
): { amount: number; tierReached?: ObjectiveBonusTier } {
  const pctAtteint = obj.target > 0 ? (current / obj.target) * 100 : 0;
  const effectiveBonusMode = obj.bonusMode ?? (obj.bonus?.enabled ? 'simple' : 'none');

  // Mode "none"
  if (effectiveBonusMode === 'none') return { amount: 0 };

  // Mode "tiered" — les paliers atteints sont cumulables
  if (effectiveBonusMode === 'tiered' && obj.bonusTiers && obj.bonusTiers.length > 0) {
    const reachedTiers = [...obj.bonusTiers]
      .filter((tier) => pctAtteint >= tier.threshold)
      .sort((a, b) => a.threshold - b.threshold);

    if (reachedTiers.length === 0) return { amount: 0 };

    let total = 0;
    for (const tier of reachedTiers) {
      total += tier.reward.type === 'fixed'
        ? tier.reward.value
        : current * (tier.reward.value / 100);
    }

    // Le palier le plus élevé atteint (pour l'affichage)
    const highestReached = reachedTiers[reachedTiers.length - 1];
    return { amount: total, tierReached: highestReached };
  }

  // Mode "simple" (comportement d'origine)
  if (!obj.bonus?.enabled || current <= obj.target) return { amount: 0 };
  const excess = current - obj.target;
  const amount =
    obj.bonus.type === 'percentage'
      ? excess * (obj.bonus.value / 100)
      : obj.bonus.value;
  return { amount };
}
