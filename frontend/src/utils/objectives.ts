/**
 * Utilitaires d'AFFICHAGE des objectifs commerciaux (périodes, libellés, tri).
 *
 * Lot 1 - RÈGLE ABSOLUE : aucun calcul de progression ni de prime ici.
 * Les montants (actualValue, bonusProjected, pct) viennent exclusivement du
 * moteur backend via objectivesProgress (objectiveProgress.service, point
 * d'entrée unique partagé avec le job snapshot 7h).
 */
import {
  startOfMonth, endOfMonth, startOfQuarter, endOfQuarter,
  startOfYear, endOfYear, isWithinInterval, parseISO,
} from 'date-fns';
import { format } from 'date-fns';
import type { Objective } from '@shared/types';

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

