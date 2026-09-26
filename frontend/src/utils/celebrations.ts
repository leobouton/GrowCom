/**
 * Étape 2 — Célébrations (« le plaisir de venir au travail »).
 *
 * Détecte les « victoires » d'un commercial à partir des données déjà chargées sur
 * son tableau de bord — SANS aucun changement de base de données :
 *  - une commission qui vient d'être validée / payée ;
 *  - un objectif qui vient d'atteindre 100 %.
 *
 * L'état « déjà célébré » est mémorisé dans le navigateur (localStorage), par
 * utilisateur. À la toute première visite, on « ensemence » silencieusement l'état
 * (on marque l'existant comme vu sans déclencher de fête) pour éviter une pluie de
 * confettis sur l'historique. Ensuite, seules les vraies nouveautés sont fêtées.
 *
 * Réversible et sans risque : on pourra passer plus tard à une vraie table
 * Notification côté backend (persistance multi-appareils) sans rien casser ici.
 */
import type { CommissionWithDetails, Objective, ObjectiveProgressItem } from '@shared/types';

export type WinKind = 'commission' | 'objective';

export interface Win {
  /** Identifiant stable et unique (id de commission, ou clé objectif+période). */
  id: string;
  kind: WinKind;
  title: string;
  /** Montant à afficher (€) — null si non pertinent. */
  amount: number | null;
  /** Date ISO de l'événement (validation, atteinte…). */
  date: string;
}

// On ne remonte pas d'événements trop anciens (évite de fêter un vieil historique
// si le stockage local est vidé). 45 jours couvre largement un cycle de paie.
const MAX_AGE_DAYS = 45;

function isRecent(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/** Victoires issues des commissions validées / payées récemment. */
export function deriveCommissionWins(commissions: CommissionWithDetails[]): Win[] {
  return commissions
    .filter((c) => c.status === 'VALIDATED' || c.status === 'PAID')
    .filter((c) => isRecent(c.validatedAt ?? c.paidAt))
    .map((c) => ({
      id: `com:${c.id}`,
      kind: 'commission' as const,
      title: c.deal.title,
      amount: c.amount,
      date: (c.validatedAt ?? c.paidAt)!,
    }));
}

/**
 * Victoires issues des objectifs EN COURS atteints (pct >= 100).
 * `period` sert à rendre l'id unique par occurrence récurrente (un même objectif
 * atteint sur deux mois = deux victoires distinctes).
 */
export function deriveObjectiveWins(
  currentObjectives: Objective[],
  progressById: Map<string, ObjectiveProgressItem>,
  periodLabelOf: (obj: Objective) => string,
): Win[] {
  const wins: Win[] = [];
  for (const obj of currentObjectives) {
    const progress = progressById.get(obj.id);
    if (!progress || progress.pct < 100) continue;
    wins.push({
      id: `obj:${obj.id}:${periodLabelOf(obj)}`,
      kind: 'objective',
      title: obj.label || 'Objectif',
      amount: progress.bonusProjected > 0 ? progress.bonusProjected : null,
      date: new Date().toISOString(),
    });
  }
  return wins;
}

// ─── Persistance navigateur ───────────────────────────────────────────────────

function storageKey(userId: string): string {
  return `growcom_seen_wins_${userId}`;
}

/** Ids déjà vus, ou null si l'utilisateur n'a jamais rien eu de mémorisé. */
export function loadSeenWinIds(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export function saveSeenWinIds(userId: string, ids: string[]): void {
  try {
    // Borne la taille pour ne pas laisser enfler le stockage indéfiniment.
    const capped = ids.slice(-500);
    localStorage.setItem(storageKey(userId), JSON.stringify(capped));
  } catch {
    // Stockage indisponible (navigation privée pleine…) : on ignore silencieusement.
  }
}

export function formatWinAmount(amount: number | null): string | null {
  if (amount === null) return null;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}
