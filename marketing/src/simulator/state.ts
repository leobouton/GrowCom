/**
 * État du simulateur (saisie de l'utilisateur, en unités « humaines » : 5 pour 5 %)
 * + conversion vers le moteur partagé + encodage dans l'URL.
 * Aucun calcul de commission ici : tout passe par simulateAgencySale (shared/commission-engine).
 */

import { tiersFromThresholds } from '@shared/commission-engine';
import type { AgencySaleSimulationInput, DeductionMode, TierMode } from '@shared/commission-engine';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeesUnit = 'pct' | 'eur';
export type TaxBasis = 'ttc' | 'ht';
export type Status = 'agent' | 'salarie';
export type RemMode = 'pal' | 'pct' | 'fix';
export type TierModeKey = 'tranche' | 'atteint' | 'retro';
export type DeductionUnit = 'pct' | 'eur';

/** Rôles proposés pour les intervenants : pas de nom libre, donc aucune donnée personnelle dans l'URL. */
export const ROLES = {
  nego: 'Négociateur',
  mandat: 'Prise de mandat',
  vente: 'Vente',
  apporteur: 'Apporteur',
  hunter: 'Hunter',
  closer: 'Closer',
  autre: 'Autre intervenant',
} as const;
export type Role = keyof typeof ROLES;

export const DEDUCTION_KINDS = {
  reseau: 'Redevance réseau',
  pack: 'Pack / abonnement',
  autre: 'Autre retenue',
} as const;
export type DeductionKind = keyof typeof DEDUCTION_KINDS;

export interface TierRow {
  from: number;
  /** en % (30 = 30 %) */
  rate: number;
}

export interface ParticipantRow {
  role: Role;
  /** en % (40 = 40 %) */
  share: number;
}

export interface DeductionRow {
  kind: DeductionKind;
  unit: DeductionUnit;
  /** % de la commission si unit = pct, € par vente si unit = eur */
  value: number;
}

export interface SimulatorState {
  price: number;
  fees: number;
  feesUnit: FeesUnit;
  tax: TaxBasis;
  status: Status;
  rem: RemMode;
  /** % des honoraires HT (mode pct) */
  rate: number;
  /** € par vente (mode fix) */
  fixed: number;
  tiers: TierRow[];
  tierMode: TierModeKey;
  prior: number;
  participants: ParticipantRow[];
  deductions: DeductionRow[];
  salesPerYear: number;
}

export const MAX_PARTICIPANTS = 3;
export const MAX_DEDUCTIONS = 3;
export const MAX_TIERS = 6;

const TIER_MODES: Record<TierModeKey, TierMode> = {
  tranche: 'MARGINAL',
  atteint: 'REACHED',
  retro: 'REACHED_RETROACTIVE',
};
const DEDUCTION_MODES: Record<DeductionUnit, DeductionMode> = {
  pct: 'PERCENT_OF_COMMISSION',
  eur: 'AMOUNT_PER_SALE',
};

// ─── Valeurs par défaut et scénarios ─────────────────────────────────────────

/** Valeurs d'exemple, à adapter : ce ne sont pas des moyennes de marché. */
export const DEFAULT_STATE: SimulatorState = {
  price: 285000,
  fees: 5,
  feesUnit: 'pct',
  tax: 'ttc',
  status: 'agent',
  rem: 'pal',
  rate: 30,
  fixed: 1500,
  tiers: [
    { from: 0, rate: 30 },
    { from: 40000, rate: 35 },
    { from: 60000, rate: 40 },
  ],
  tierMode: 'tranche',
  prior: 36500,
  participants: [{ role: 'nego', share: 100 }],
  deductions: [],
  salesPerYear: 10,
};

export interface Scenario {
  id: string;
  label: string;
  description: string;
  state: SimulatorState;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'agence',
    label: 'Agence classique',
    description: 'Un négociateur, grille à trois paliers par tranche',
    state: DEFAULT_STATE,
  },
  {
    id: 'reseau',
    label: 'Réseau de mandataires',
    description: 'Mandataire indépendant, paliers au taux atteint, frais retenus par vente',
    state: {
      ...DEFAULT_STATE,
      price: 240000,
      fees: 12000,
      feesUnit: 'eur',
      status: 'agent',
      rem: 'pal',
      tiers: [
        { from: 0, rate: 70 },
        { from: 50000, rate: 80 },
        { from: 100000, rate: 90 },
      ],
      tierMode: 'atteint',
      prior: 42000,
      deductions: [{ kind: 'pack', unit: 'eur', value: 150 }],
      salesPerYear: 12,
    },
  },
  {
    id: 'equipe',
    label: 'Équipe mandat / vente',
    description: 'Vente partagée entre la prise de mandat et la vente',
    state: {
      ...DEFAULT_STATE,
      price: 320000,
      fees: 4.5,
      status: 'salarie',
      rem: 'pct',
      rate: 20,
      prior: 0,
      participants: [
        { role: 'mandat', share: 40 },
        { role: 'vente', share: 60 },
      ],
      salesPerYear: 14,
    },
  },
];

export function cloneState(state: SimulatorState): SimulatorState {
  return {
    ...state,
    tiers: state.tiers.map((t) => ({ ...t })),
    participants: state.participants.map((p) => ({ ...p })),
    deductions: state.deductions.map((d) => ({ ...d })),
  };
}

// ─── Conversion vers le moteur ───────────────────────────────────────────────

const pct = (value: number) => value / 100;

export function toSimulationInput(state: SimulatorState): AgencySaleSimulationInput {
  return {
    salePrice: state.price,
    feesMode: state.feesUnit === 'pct' ? 'PERCENT_OF_PRICE' : 'AMOUNT',
    feesValue: state.feesUnit === 'pct' ? pct(state.fees) : state.fees,
    feesTaxBasis: state.tax === 'ttc' ? 'TTC' : 'HT',
    status: state.status === 'salarie' ? 'SALARIED' : 'AGENT',
    remuneration: {
      mode: state.rem === 'pal' ? 'TIERED' : state.rem === 'pct' ? 'PERCENTAGE' : 'FIXED',
      rate: pct(state.rate),
      fixedAmount: state.fixed,
      tiers: tiersFromThresholds(state.tiers.map((t) => ({ from: t.from, rate: pct(t.rate) }))),
      tierMode: TIER_MODES[state.tierMode],
    },
    priorRevenue: state.prior,
    participants: state.participants.map((p, i) => ({ id: `p${i + 1}`, label: ROLES[p.role], share: pct(p.share) })),
    deductions: state.deductions.map((d, i) => ({
      id: `r${i + 1}`,
      label: DEDUCTION_KINDS[d.kind],
      mode: DEDUCTION_MODES[d.unit],
      value: d.unit === 'pct' ? pct(d.value) : d.value,
    })),
    salesPerYear: state.salesPerYear,
  };
}

/** Parts égales qui totalisent exactement 100 (ex. 3 intervenants → 33,34 / 33,33 / 33,33). */
export function evenShares(count: number): number[] {
  const base = Math.floor(10000 / count) / 100;
  const shares = Array.from({ length: count }, () => base);
  shares[0] = Math.round((100 - base * (count - 1)) * 100) / 100;
  return shares;
}

// ─── URL ─────────────────────────────────────────────────────────────────────
// Clés courtes et lisibles, séparateurs non encodés (« - » et « _ ») :
// ?prix=285000&hon=5&honu=pct&tva=ttc&statut=agent&rem=pal&pal=0-30_40000-35_60000-40&mode=tranche&ca=36500&parts=nego-100&ventes=10

const num = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const oneOf = <T extends string>(raw: string | null | undefined, allowed: readonly T[]): T | null =>
  raw !== null && raw !== undefined && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

const fmt = (value: number) => String(Math.round(value * 100) / 100);

export function encodeState(state: SimulatorState): string {
  const params = new URLSearchParams();
  params.set('prix', fmt(state.price));
  params.set('hon', fmt(state.fees));
  params.set('honu', state.feesUnit);
  params.set('tva', state.tax);
  params.set('statut', state.status);
  params.set('rem', state.rem);
  if (state.rem === 'pct') params.set('taux', fmt(state.rate));
  if (state.rem === 'fix') params.set('forfait', fmt(state.fixed));
  if (state.rem === 'pal') {
    params.set('pal', state.tiers.map((t) => `${fmt(t.from)}-${fmt(t.rate)}`).join('_'));
    params.set('mode', state.tierMode);
  }
  params.set('ca', fmt(state.prior));
  params.set('parts', state.participants.map((p) => `${p.role}-${fmt(p.share)}`).join('_'));
  if (state.deductions.length > 0) {
    params.set('ret', state.deductions.map((d) => `${d.kind}-${d.unit}-${fmt(d.value)}`).join('_'));
  }
  params.set('ventes', String(state.salesPerYear));
  return params.toString();
}

/** Lit l'URL de façon tolérante : tout paramètre absent ou invalide reprend la valeur par défaut. */
export function decodeState(search: string, fallback: SimulatorState = DEFAULT_STATE): SimulatorState {
  const params = new URLSearchParams(search);
  const state = cloneState(fallback);
  if (![...params.keys()].some((key) => ['prix', 'hon', 'rem', 'pal', 'parts'].includes(key))) return state;

  state.price = num(params.get('prix')) ?? state.price;
  state.fees = num(params.get('hon')) ?? state.fees;
  state.feesUnit = oneOf(params.get('honu'), ['pct', 'eur'] as const) ?? state.feesUnit;
  state.tax = oneOf(params.get('tva'), ['ttc', 'ht'] as const) ?? state.tax;
  state.status = oneOf(params.get('statut'), ['agent', 'salarie'] as const) ?? state.status;
  state.rem = oneOf(params.get('rem'), ['pal', 'pct', 'fix'] as const) ?? state.rem;
  state.rate = num(params.get('taux')) ?? state.rate;
  state.fixed = num(params.get('forfait')) ?? state.fixed;
  state.tierMode = oneOf(params.get('mode'), ['tranche', 'atteint', 'retro'] as const) ?? state.tierMode;
  state.prior = num(params.get('ca')) ?? state.prior;
  state.salesPerYear = num(params.get('ventes')) ?? state.salesPerYear;

  const tiers = (params.get('pal') ?? '')
    .split('_')
    .map((chunk) => chunk.split('-'))
    .map(([from, rate]) => ({ from: num(from), rate: num(rate) }))
    .filter((t): t is TierRow => t.from !== null && t.rate !== null)
    .slice(0, MAX_TIERS);
  if (tiers.length > 0) state.tiers = tiers;

  const roles = Object.keys(ROLES) as Role[];
  const participants = (params.get('parts') ?? '')
    .split('_')
    .map((chunk) => chunk.split('-'))
    .map(([role, share]) => ({ role: oneOf(role, roles), share: num(share) }))
    .filter((p): p is ParticipantRow => p.role !== null && p.share !== null)
    .slice(0, MAX_PARTICIPANTS);
  if (participants.length > 0) state.participants = participants;

  const kinds = Object.keys(DEDUCTION_KINDS) as DeductionKind[];
  state.deductions = (params.get('ret') ?? '')
    .split('_')
    .map((chunk) => chunk.split('-'))
    .map(([kind, unit, value]) => ({ kind: oneOf(kind, kinds), unit: oneOf(unit, ['pct', 'eur'] as const), value: num(value) }))
    .filter((d): d is DeductionRow => d.kind !== null && d.unit !== null && d.value !== null)
    .slice(0, MAX_DEDUCTIONS);

  return state;
}
