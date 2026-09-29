/**
 * Moteur de calcul de commission — fonctions PURES (aucun accès base, réseau ou Prisma).
 * Source unique du calcul, partagée par le backend, le frontend et le site marketing.
 *
 * Ordre d'application :
 *   1. floor : sous le seuil minimum, pas de commission (skippedReason BELOW_FLOOR)
 *   2. calcul selon le type (forfait par unité > FIXED > PERCENTAGE > TIERED), ligne par ligne,
 *      chaque ligne arrondie au centime
 *   3. cap : plafond absolu sur le montant de la vente
 *   4. borne à 0 : une commission n'est jamais négative
 *   5. répartition entre intervenants, au centime près (la somme retombe sur le total)
 */

import { CommissionRuleType } from '../types';
import type { CommissionRuleConfig, CommissionTier, TierMode } from '../types';
import { roundCents, allocateByShares } from './rounding';
import type {
  CalculationLine,
  CommissionInput,
  CommissionResult,
  CommissionSkippedReason,
  ParticipantInput,
  TierProgress,
} from './types';

// ─── Formatage du détail ─────────────────────────────────────────────────────

const money = (value: number) => `${value.toFixed(2)}€`;

/** Taux lisible : 0.1 → « 10 », 0.025 → « 2.5 » (jamais arrondi à l'entier, contrairement à l'historique). */
export function formatRatePercent(rate: number): string {
  return String(roundCents(rate * 100));
}

function defaultBasisLabel(config: CommissionRuleConfig): string {
  if (config.calculationBasis === 'MARGIN') return 'Marge';
  if (config.calculationBasis === 'PER_UNIT') return 'Forfait';
  return 'CA';
}

function tierLabel(tier: CommissionTier): string {
  return tier.max === null || tier.max === undefined
    ? `Au-delà de ${money(tier.min)}`
    : `De ${money(tier.min)} à ${money(tier.max)}`;
}

// ─── Paliers ─────────────────────────────────────────────────────────────────

export function sortTiers(tiers: CommissionTier[]): CommissionTier[] {
  return [...tiers].sort((a, b) => a.min - b.min);
}

/**
 * Palier atteint pour une base cumulée : le plus haut palier dont le minimum est atteint.
 * Atteindre pile le minimum d'un palier le débloque (10 000 € atteints = palier « dès 10 000 € »).
 */
export function findReachedTier(sortedTiers: CommissionTier[], cumulativeBasis: number): CommissionTier | null {
  let reached: CommissionTier | null = null;
  for (const tier of sortedTiers) {
    if (cumulativeBasis >= tier.min) reached = tier;
    else break;
  }
  return reached;
}

/** Tranches marginales entre deux niveaux de base cumulée : chaque tranche à son taux. */
function marginalLines(sortedTiers: CommissionTier[], start: number, end: number): CalculationLine[] {
  const lines: CalculationLine[] = [];
  for (const tier of sortedTiers) {
    if (end < tier.min) break;
    const tierMax = tier.max ?? Infinity;
    const from = Math.max(start, tier.min);
    const to = Math.min(end, tierMax);
    const applicable = to - from;
    if (applicable <= 0) continue;
    lines.push({
      kind: 'TIER',
      label: tierLabel(tier),
      base: roundCents(applicable),
      rate: tier.rate,
      amount: roundCents(applicable * tier.rate),
      tier,
    });
  }
  return lines;
}

function computeTierLines(
  sortedTiers: CommissionTier[],
  mode: TierMode,
  basis: number,
  prior: number,
): CalculationLine[] {
  const cumulative = prior + basis;

  if (mode === 'MARGINAL') {
    return marginalLines(sortedTiers, prior, cumulative);
  }

  const tierAfter = findReachedTier(sortedTiers, cumulative);
  if (!tierAfter) return [];

  const lines: CalculationLine[] = [
    {
      kind: 'TIER',
      label: `Vente au taux du palier atteint (${tierLabel(tierAfter).toLowerCase()})`,
      base: roundCents(basis),
      rate: tierAfter.rate,
      amount: roundCents(basis * tierAfter.rate),
      tier: tierAfter,
    },
  ];

  if (mode === 'REACHED_RETROACTIVE' && prior > 0) {
    const rateBefore = findReachedTier(sortedTiers, prior)?.rate ?? 0;
    const rateDelta = tierAfter.rate - rateBefore;
    if (rateDelta !== 0) {
      lines.push({
        kind: 'RETROACTIVE_CATCH_UP',
        label: 'Rattrapage rétroactif sur le déjà réalisé',
        base: roundCents(prior),
        rate: rateDelta,
        amount: roundCents(prior * rateDelta),
        tier: tierAfter,
      });
    }
  }
  return lines;
}

export function computeTierProgress(sortedTiers: CommissionTier[], cumulativeBasis: number): TierProgress {
  const cumulative = Math.max(0, cumulativeBasis);
  const currentTier = findReachedTier(sortedTiers, cumulative);
  const nextTier = sortedTiers.find((tier) => tier.min > cumulative) ?? null;
  if (!nextTier) {
    return { cumulativeBasis: roundCents(cumulative), currentTier, nextTier: null, remainingToNextTier: null, progressToNextTier: 1 };
  }
  const floorOfRange = currentTier?.min ?? 0;
  const span = nextTier.min - floorOfRange;
  const progress = span > 0 ? (cumulative - floorOfRange) / span : 0;
  return {
    cumulativeBasis: roundCents(cumulative),
    currentTier,
    nextTier,
    remainingToNextTier: roundCents(nextTier.min - cumulative),
    progressToNextTier: Math.min(1, Math.max(0, progress)),
  };
}

function tierExplanation(
  basisLabel: string,
  basis: number,
  prior: number,
  mode: TierMode,
  lines: CalculationLine[],
  total: number,
): string {
  if (lines.length === 0) return `${basisLabel} ${money(basis)} — aucun palier atteint`;

  const parts = lines.map((line) => {
    const formula = `${money(line.base ?? 0)} × ${formatRatePercent(line.rate ?? 0)}% = ${money(line.amount)}`;
    return line.kind === 'RETROACTIVE_CATCH_UP' ? `rattrapage ${formula}` : formula;
  });
  const priorNote = prior > 0 ? ` (déjà réalisé : ${money(prior)})` : '';

  const header =
    mode === 'MARGINAL'
      ? `${basisLabel} ${money(basis)} par paliers${priorNote}`
      : `${basisLabel} ${money(basis)} au taux du palier atteint${priorNote}`;
  return `${header} : ${parts.join(' + ')} = ${money(total)}`;
}

// ─── Calcul principal ────────────────────────────────────────────────────────

const SOLO: ParticipantInput[] = [{ id: 'main', share: 1 }];

function sumLines(lines: CalculationLine[]): number {
  return roundCents(lines.reduce((sum, line) => sum + line.amount, 0));
}

/**
 * Calcule la commission d'une vente, avec le détail ligne par ligne et la part de chaque intervenant.
 * Lève une RangeError si les parts des intervenants ne font pas 100 %.
 */
export function computeCommission(input: CommissionInput): CommissionResult {
  const { config } = input;
  const basis = input.basisAmount;
  const prior = Math.max(0, input.priorBasisAmount ?? 0);
  const tierMode: TierMode = config.tierMode ?? 'MARGINAL';
  const basisLabel = input.basisLabel ?? defaultBasisLabel(config);
  const participantsInput = input.participants && input.participants.length > 0 ? input.participants : SOLO;
  const shares = participantsInput.map((p) => p.share);

  const sortedTiers =
    config.type === CommissionRuleType.TIERED && config.tiers && config.tiers.length > 0
      ? sortTiers(config.tiers)
      : null;
  const tierProgress = sortedTiers ? computeTierProgress(sortedTiers, prior + basis) : null;

  const finish = (
    totalAmount: number,
    lines: CalculationLine[],
    amountBeforeCap: number,
    capped: boolean,
    explanation: string,
    skippedReason?: CommissionSkippedReason,
  ): CommissionResult => {
    const allocations = allocateByShares(totalAmount, shares);
    return {
      totalAmount,
      basisAmount: basis,
      priorBasisAmount: prior,
      tierMode,
      lines,
      amountBeforeCap,
      capped,
      explanation,
      participants: participantsInput.map((p, i) => ({ id: p.id, label: p.label, share: p.share, amount: allocations[i] })),
      tierProgress,
      ...(skippedReason ? { skippedReason } : {}),
    };
  };

  // 1. Floor — seuil minimum pour déclencher la règle
  // (pour PER_UNIT, basisAmount = nb de consultants ; le floor devient un nb minimum)
  if (config.floor !== undefined && config.floor !== null && basis < config.floor) {
    return finish(
      0,
      [],
      0,
      false,
      `Sous le seuil minimum (${config.floor.toFixed(2)}) : ${basisLabel} ${basis.toFixed(2)}`,
      'BELOW_FLOOR',
    );
  }

  // 2. Calcul selon le type de règle
  let lines: CalculationLine[];
  let explanation: string;

  if (config.calculationBasis === 'PER_UNIT') {
    // Forfait par unité : montant fixe × nb de consultants placés. Prioritaire sur le type de règle.
    const unit = config.fixedAmount ?? 0;
    const amount = roundCents(unit * basis);
    lines = [{ kind: 'PER_UNIT', label: 'Forfait par consultant placé', base: basis, rate: null, amount }];
    explanation = `${basis} consultant${basis > 1 ? 's' : ''} × ${money(unit)} = ${money(amount)}`;
  } else if (config.type === CommissionRuleType.FIXED) {
    const amount = roundCents(config.fixedAmount ?? 0);
    lines = [{ kind: 'FIXED', label: 'Commission fixe', base: null, rate: null, amount }];
    explanation = `Commission fixe : ${money(amount)}`;
  } else if (config.type === CommissionRuleType.PERCENTAGE) {
    const rate = config.rate ?? 0;
    const amount = roundCents(basis * rate);
    lines = [{ kind: 'PERCENTAGE', label: `${formatRatePercent(rate)} % de la base`, base: basis, rate, amount }];
    explanation = `${basisLabel} ${money(basis)} × ${formatRatePercent(rate)}% = ${money(amount)}`;
  } else if (config.type === CommissionRuleType.TIERED && config.tiers) {
    lines = computeTierLines(sortedTiers ?? [], tierMode, basis, prior);
    explanation = tierExplanation(basisLabel, basis, prior, tierMode, lines, sumLines(lines));
  } else {
    return finish(0, [], 0, false, 'Règle non reconnue', 'UNKNOWN_RULE');
  }

  const amountBeforeCap = sumLines(lines);
  let amount = amountBeforeCap;
  let capped = false;

  // 3. Cap — plafond absolu en €
  if (config.cap !== undefined && config.cap !== null && amount > config.cap) {
    explanation = `${explanation} (plafonné à ${money(config.cap)})`;
    amount = roundCents(config.cap);
    capped = true;
  }

  // 4. Une commission n'est jamais négative : une base négative (ex. marge
  // négative sur une affaire à perte) donne 0 €, jamais une retenue.
  if (amount < 0) {
    explanation = `${explanation} → borné à 0€ (base négative)`;
    amount = 0;
  }

  return finish(amount, lines, amountBeforeCap, capped, explanation);
}

/**
 * Forme historique du calcul, utilisée par le backend (commission totale d'une vente, avant split).
 * basisAmount = CA ou marge selon config.calculationBasis (déjà résolu par l'appelant).
 * Seul BELOW_FLOOR est remonté comme skippedReason : une règle non reconnue donne 0 € sans ligne visible.
 */
export function calculateCommissionAmount(
  basisAmount: number,
  config: CommissionRuleConfig,
): { amount: number; explanation: string; skippedReason?: string } {
  const result = computeCommission({ config, basisAmount });
  return {
    amount: result.totalAmount,
    explanation: result.explanation,
    ...(result.skippedReason === 'BELOW_FLOOR' ? { skippedReason: result.skippedReason } : {}),
  };
}
