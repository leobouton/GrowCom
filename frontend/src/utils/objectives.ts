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
    const month = (obj.month ?? 1) - 1;
    const d = new Date(y, month, 1);
    return [startOfMonth(d), endOfMonth(d)];
  }
  if (obj.periodType === 'quarterly') {
    const q = obj.quarter ?? 1;
    const monthStart = (q - 1) * 3;
    const d = new Date(y, monthStart, 1);
    return [startOfQuarter(d), endOfQuarter(d)];
  }
  if (obj.periodType === 'annual') {
    return [startOfYear(new Date(y, 0, 1)), endOfYear(new Date(y, 0, 1))];
  }
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return [parseISO(obj.startDate), parseISO(obj.endDate)];
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
  if (obj.periodType === 'annual') return `Année ${y}`;
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return `${format(parseISO(obj.startDate), 'dd/MM/yy')} → ${format(parseISO(obj.endDate), 'dd/MM/yy')}`;
  }
  return 'Période perso.';
}

// ─── Calcul de progression ────────────────────────────────────

interface WonDealLike {
  amount: number;
  closedAt: string | null;
  syncedAt: string | null;
}

/**
 * Calcule la valeur actuelle d'un objectif depuis les deals WON.
 * Filtre par période si possible, sinon retourne le total global.
 */
export function computeProgress(obj: Objective, wonDeals: WonDealLike[]): number {
  if (wonDeals.length === 0) return 0;

  const range = getObjectiveDateRange(obj);

  if (range) {
    const [start, end] = range;
    const filtered = wonDeals.filter((d) => {
      const dateStr = d.closedAt ?? d.syncedAt;
      if (!dateStr) return true;
      return isWithinInterval(new Date(dateStr), { start, end });
    });
    if (filtered.length > 0) {
      if (obj.unit === 'deals') return filtered.length;
      return filtered.reduce((sum, d) => sum + d.amount, 0);
    }
  }

  if (obj.unit === 'deals') return wonDeals.length;
  return wonDeals.reduce((sum, d) => sum + d.amount, 0);
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

  // Mode "tiered"
  if (effectiveBonusMode === 'tiered' && obj.bonusTiers && obj.bonusTiers.length > 0) {
    // Trouver le palier le plus élevé atteint
    const reached = [...obj.bonusTiers]
      .sort((a, b) => b.threshold - a.threshold)
      .find((tier) => pctAtteint >= tier.threshold);

    if (!reached) return { amount: 0 };

    const amount =
      reached.reward.type === 'fixed'
        ? reached.reward.value
        : current * (reached.reward.value / 100);

    return { amount, tierReached: reached };
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
