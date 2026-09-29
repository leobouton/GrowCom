/**
 * Simulation d'une vente en agence immobilière — fonctions PURES, utilisées par le
 * simulateur public du site marketing. Tout le calcul de commission passe par
 * computeCommission : ce fichier n'ajoute que ce qui est propre à une vente immobilière
 * (honoraires TTC/HT, retenues, part de l'agence, projection annuelle).
 */

import { CommissionRuleType } from '../types';
import type { CommissionRuleConfig, CommissionTier, TierMode } from '../types';
import { computeCommission, findReachedTier, sortTiers } from './compute';
import { allocateByShares, roundCents, SHARES_SUM_TOLERANCE } from './rounding';
import type { CommissionResult, ParticipantInput } from './types';

export type FeesInputMode = 'PERCENT_OF_PRICE' | 'AMOUNT';
/** Les honoraires saisis sont-ils TTC ou HT ? La commission se calcule toujours sur le HT. */
export type FeesTaxBasis = 'TTC' | 'HT';
/** Salarié (VRP) ou agent commercial / mandataire indépendant : change les libellés, pas le calcul. */
export type NegotiatorStatus = 'SALARIED' | 'AGENT';
export type RemunerationMode = 'PERCENTAGE' | 'TIERED' | 'FIXED';
/** Retenue en % de la commission brute, ou en € par vente. */
export type DeductionMode = 'PERCENT_OF_COMMISSION' | 'AMOUNT_PER_SALE';

export const DEFAULT_VAT_RATE = 0.2;
export const MAX_SALES_PER_YEAR = 200;

export interface RemunerationInput {
  mode: RemunerationMode;
  /** PERCENTAGE : part des honoraires HT reversée (0.3 = 30 %). */
  rate?: number;
  /** FIXED : forfait en € par vente. */
  fixedAmount?: number;
  /** TIERED : paliers sur les honoraires HT cumulés dans l'année. */
  tiers?: CommissionTier[];
  tierMode?: TierMode;
}

export interface DeductionInput {
  id: string;
  label: string;
  mode: DeductionMode;
  /** Taux (0.1 = 10 %) si PERCENT_OF_COMMISSION, montant en € si AMOUNT_PER_SALE. */
  value: number;
}

export interface AgencySaleSimulationInput {
  salePrice: number;
  feesMode: FeesInputMode;
  /** Taux appliqué au prix (0.05 = 5 %) si PERCENT_OF_PRICE, montant en € si AMOUNT. */
  feesValue: number;
  feesTaxBasis: FeesTaxBasis;
  /** Défaut 20 %. */
  vatRate?: number;
  status: NegotiatorStatus;
  remuneration: RemunerationInput;
  /** Honoraires HT déjà réalisés depuis le début de l'année (sert aux paliers). */
  priorRevenue: number;
  participants: ParticipantInput[];
  deductions: DeductionInput[];
  /** Nombre de ventes comparables sur une année, pour la projection. */
  salesPerYear: number;
}

export interface FeesBreakdown {
  inclTax: number;
  exclTax: number;
  vat: number;
}

export interface DeductionAmount {
  id: string;
  label: string;
  mode: DeductionMode;
  value: number;
  amount: number;
}

export interface ParticipantNet {
  id: string;
  label?: string;
  share: number;
  gross: number;
  deductions: number;
  net: number;
}

export interface ProjectionSale {
  /** Numéro de la vente dans l'année (1, 2, 3…). */
  index: number;
  /** Honoraires HT cumulés après cette vente. */
  cumulativeFees: number;
  gross: number;
  net: number;
  /** Taux du palier atteint après cette vente (paliers uniquement). */
  reachedRate: number | null;
}

export interface AnnualProjection {
  salesCount: number;
  totalFeesExclTax: number;
  grossCommission: number;
  netCommission: number;
  /** Part moyenne des honoraires HT reversée (brut), de 0 à 1. */
  effectiveRate: number;
  sales: ProjectionSale[];
}

export interface AgencySaleSimulationResult {
  fees: FeesBreakdown;
  config: CommissionRuleConfig;
  /** Commission brute de la vente (tous intervenants), avec détail et progression. */
  commission: CommissionResult;
  deductions: DeductionAmount[];
  totalDeductions: number;
  /** true si les retenues dépassaient la commission (net ramené à 0). */
  deductionsCapped: boolean;
  netCommission: number;
  participants: ParticipantNet[];
  /** Honoraires HT − commission nette : ce qui reste à l'agence (ou au réseau). */
  agencyShare: number;
  projection: AnnualProjection;
}

export interface SimulationIssue {
  field: string;
  message: string;
}

export type SimulationOutcome =
  | { ok: true; result: AgencySaleSimulationResult }
  | { ok: false; issues: SimulationIssue[] };

// ─── Briques ─────────────────────────────────────────────────────────────────

/**
 * Construit des paliers à partir de seuils « à partir de X € → taux ».
 * Chaque palier s'arrête là où commence le suivant ; le dernier est ouvert.
 * Évite par construction les trous et chevauchements entre paliers.
 */
export function tiersFromThresholds(rows: Array<{ from: number; rate: number }>): CommissionTier[] {
  const sorted = [...rows].sort((a, b) => a.from - b.from);
  return sorted.map((row, index) => ({
    min: row.from,
    max: index < sorted.length - 1 ? sorted[index + 1].from : null,
    rate: row.rate,
  }));
}

/** Honoraires TTC / HT / TVA à partir de la saisie. */
export function computeFees(
  input: Pick<AgencySaleSimulationInput, 'salePrice' | 'feesMode' | 'feesValue' | 'feesTaxBasis' | 'vatRate'>,
): FeesBreakdown {
  const vatRate = input.vatRate ?? DEFAULT_VAT_RATE;
  const entered = roundCents(input.feesMode === 'PERCENT_OF_PRICE' ? input.salePrice * input.feesValue : input.feesValue);
  if (input.feesTaxBasis === 'TTC') {
    const exclTax = roundCents(entered / (1 + vatRate));
    return { inclTax: entered, exclTax, vat: roundCents(entered - exclTax) };
  }
  const inclTax = roundCents(entered * (1 + vatRate));
  return { inclTax, exclTax: entered, vat: roundCents(inclTax - entered) };
}

/** Règle de commission équivalente à la rémunération saisie, calculée sur les honoraires HT. */
export function buildRemunerationConfig(remuneration: RemunerationInput): CommissionRuleConfig {
  const base = { description: '', examples: [], calculationBasis: 'REVENUE' as const };
  if (remuneration.mode === 'FIXED') {
    return { ...base, type: CommissionRuleType.FIXED, fixedAmount: remuneration.fixedAmount ?? 0 };
  }
  if (remuneration.mode === 'TIERED') {
    return {
      ...base,
      type: CommissionRuleType.TIERED,
      tiers: remuneration.tiers ?? [],
      tierMode: remuneration.tierMode ?? 'MARGINAL',
    };
  }
  return { ...base, type: CommissionRuleType.PERCENTAGE, rate: remuneration.rate ?? 0 };
}

/** Retenues d'une vente, plafonnées pour que le net ne soit jamais négatif. */
function applyDeductions(
  gross: number,
  deductions: DeductionInput[],
): { lines: DeductionAmount[]; total: number; net: number; capped: boolean } {
  const lines = deductions.map((d) => ({
    id: d.id,
    label: d.label,
    mode: d.mode,
    value: d.value,
    amount: roundCents(d.mode === 'PERCENT_OF_COMMISSION' ? gross * d.value : d.value),
  }));
  const requested = roundCents(lines.reduce((sum, line) => sum + line.amount, 0));
  const capped = requested > gross;
  const total = capped ? gross : requested;
  return { lines, total, net: roundCents(gross - total), capped };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const isNonNegative = (n: number) => Number.isFinite(n) && n >= 0;
const isRate = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

export function validateSimulationInput(input: AgencySaleSimulationInput): SimulationIssue[] {
  const issues: SimulationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  if (!isNonNegative(input.salePrice)) add('salePrice', 'Le prix de vente doit être un montant positif.');
  if (input.feesMode === 'PERCENT_OF_PRICE') {
    if (!isRate(input.feesValue)) add('feesValue', 'Le taux d\'honoraires doit être compris entre 0 et 100 %.');
  } else if (!isNonNegative(input.feesValue)) {
    add('feesValue', 'Le montant des honoraires doit être positif.');
  }
  if (input.vatRate !== undefined && !isRate(input.vatRate)) add('vatRate', 'Le taux de TVA est invalide.');
  if (!isNonNegative(input.priorRevenue)) add('priorRevenue', 'Le CA déjà réalisé doit être un montant positif.');

  const { remuneration } = input;
  if (remuneration.mode === 'PERCENTAGE' && !isRate(remuneration.rate ?? 0)) {
    add('remuneration.rate', 'Le pourcentage doit être compris entre 0 et 100 %.');
  }
  if (remuneration.mode === 'FIXED' && !isNonNegative(remuneration.fixedAmount ?? 0)) {
    add('remuneration.fixedAmount', 'Le forfait doit être un montant positif.');
  }
  if (remuneration.mode === 'TIERED') {
    const tiers = remuneration.tiers ?? [];
    if (tiers.length === 0) add('remuneration.tiers', 'Ajoutez au moins un palier.');
    if (tiers.some((t) => !isNonNegative(t.min))) add('remuneration.tiers', 'Les seuils des paliers doivent être positifs.');
    if (tiers.some((t) => !isRate(t.rate))) add('remuneration.tiers', 'Les taux des paliers doivent être compris entre 0 et 100 %.');
    const mins = tiers.map((t) => t.min);
    if (new Set(mins).size !== mins.length) add('remuneration.tiers', 'Deux paliers ne peuvent pas commencer au même montant.');
  }

  if (input.participants.length === 0) add('participants', 'Au moins un intervenant est requis.');
  if (input.participants.some((p) => !isRate(p.share))) add('participants', 'Chaque part doit être comprise entre 0 et 100 %.');
  const sharesSum = input.participants.reduce((sum, p) => sum + p.share, 0);
  if (input.participants.length > 0 && Math.abs(sharesSum - 1) > SHARES_SUM_TOLERANCE) {
    add('participants', `Les parts doivent totaliser 100 % (actuellement ${roundCents(sharesSum * 100).toLocaleString('fr-FR')} %).`);
  }

  for (const d of input.deductions) {
    const valid = d.mode === 'PERCENT_OF_COMMISSION' ? isRate(d.value) : isNonNegative(d.value);
    if (!valid) add(`deductions.${d.id}`, `La retenue « ${d.label} » est invalide.`);
  }

  if (!Number.isInteger(input.salesPerYear) || input.salesPerYear < 1 || input.salesPerYear > MAX_SALES_PER_YEAR) {
    add('salesPerYear', `Le nombre de ventes par an doit être un entier entre 1 et ${MAX_SALES_PER_YEAR}.`);
  }
  return issues;
}

// ─── Projection annuelle ─────────────────────────────────────────────────────

/**
 * « À ce rythme » : N ventes identiques sur une année complète (en partant de 0 € de CA),
 * chacune calculée avec le CA cumulé des précédentes. Les paliers, rattrapages et
 * retenues s'appliquent vente par vente, exactement comme dans la réalité.
 */
export function projectYear(
  config: CommissionRuleConfig,
  feesExclTax: number,
  deductions: DeductionInput[],
  salesCount: number,
): AnnualProjection {
  const sales: ProjectionSale[] = [];
  let gross = 0;
  let net = 0;
  const sortedTiers = config.type === CommissionRuleType.TIERED ? sortTiers(config.tiers ?? []) : [];

  for (let i = 0; i < salesCount; i++) {
    const prior = roundCents(feesExclTax * i);
    const result = computeCommission({ config, basisAmount: feesExclTax, priorBasisAmount: prior });
    const saleNet = applyDeductions(result.totalAmount, deductions).net;
    gross = roundCents(gross + result.totalAmount);
    net = roundCents(net + saleNet);
    const cumulative = roundCents(prior + feesExclTax);
    sales.push({
      index: i + 1,
      cumulativeFees: cumulative,
      gross: result.totalAmount,
      net: saleNet,
      reachedRate: config.type === CommissionRuleType.TIERED ? (findReachedTier(sortedTiers, cumulative)?.rate ?? 0) : null,
    });
  }

  const totalFeesExclTax = roundCents(feesExclTax * salesCount);
  return {
    salesCount,
    totalFeesExclTax,
    grossCommission: gross,
    netCommission: net,
    effectiveRate: totalFeesExclTax > 0 ? gross / totalFeesExclTax : 0,
    sales,
  };
}

// ─── Simulation complète ─────────────────────────────────────────────────────

export function simulateAgencySale(input: AgencySaleSimulationInput): SimulationOutcome {
  const issues = validateSimulationInput(input);
  if (issues.length > 0) return { ok: false, issues };

  const fees = computeFees(input);
  const config = buildRemunerationConfig(input.remuneration);
  const commission = computeCommission({
    config,
    basisAmount: fees.exclTax,
    priorBasisAmount: input.priorRevenue,
    participants: input.participants,
    basisLabel: 'Honoraires HT',
  });

  const deductions = applyDeductions(commission.totalAmount, input.deductions);
  const shares = input.participants.map((p) => p.share);
  const netByParticipant = allocateByShares(deductions.net, shares);

  const participants: ParticipantNet[] = commission.participants.map((p, i) => ({
    id: p.id,
    label: p.label,
    share: p.share,
    gross: p.amount,
    net: netByParticipant[i],
    deductions: roundCents(p.amount - netByParticipant[i]),
  }));

  return {
    ok: true,
    result: {
      fees,
      config,
      commission,
      deductions: deductions.lines,
      totalDeductions: deductions.total,
      deductionsCapped: deductions.capped,
      netCommission: deductions.net,
      participants,
      agencyShare: roundCents(fees.exclTax - deductions.net),
      projection: projectYear(config, fees.exclTax, input.deductions, input.salesPerYear),
    },
  };
}
