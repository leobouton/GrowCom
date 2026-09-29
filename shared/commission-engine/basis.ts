/**
 * Préparation du calcul : base (CA / marge / unités), surcharges d'assignation,
 * agrégation des composants d'un plan. Fonctions pures.
 */

import type { CommissionRuleConfig } from '../types';
import { calculateCommissionAmount } from './compute';
import { applyShare, roundCents } from './rounding';

/**
 * Entrée générique du moteur : facts d'un CommissionableEvent, qu'il vienne d'un
 * deal WON (amount/margin) ou d'un mois de mission (monthlyAmount/margin/consultants).
 */
export interface CommissionBasisInput {
  amount: number;             // base CA/revenu (deal.amount ou mission.monthlyAmount)
  marginAmount?: number | null;
  costAmount?: number | null;
  unitCount?: number | null;  // nb de consultants placés (forfait)
}

/**
 * Résout la base de calcul selon config.calculationBasis.
 * - PER_UNIT : nb de consultants placés
 * - MARGIN   : marge fournie, sinon amount - coût, sinon 0 (décision Léo
 *   2026-07-06 : marge inconnue = commission à 0, JAMAIS de repli sur le CA —
 *   un % de marge calculé sur le CA entier surpayait systématiquement)
 * - REVENUE  : amount
 */
export function resolveBasisAmount(
  config: CommissionRuleConfig,
  input: CommissionBasisInput,
): { basisAmount: number; basisLabel: string } {
  if (config.calculationBasis === 'PER_UNIT') {
    return { basisAmount: input.unitCount ?? 0, basisLabel: 'consultants' };
  }
  if (config.calculationBasis === 'MARGIN') {
    let margin: number;
    if (input.marginAmount !== null && input.marginAmount !== undefined) {
      margin = input.marginAmount;
    } else if (input.costAmount !== null && input.costAmount !== undefined) {
      margin = input.amount - input.costAmount;
    } else {
      margin = 0;
    }
    return { basisAmount: margin, basisLabel: 'marge' };
  }
  return { basisAmount: input.amount, basisLabel: 'CA' };
}

/**
 * Paramètres surchargeables par assignation. Les champs sémantiques (type,
 * calculationBasis, tierMode, appliesToEventType, description, examples) ne le sont PAS :
 * un override ne change que les valeurs numériques du barème.
 */
const OVERRIDABLE_KEYS = ['rate', 'fixedAmount', 'cap', 'floor', 'tiers'] as const;

/**
 * Applique un override d'assignation sur la config de base d'une règle.
 * Retourne une NOUVELLE config (ne mute pas la base). Seuls les champs surchargeables
 * présents dans l'override sont remplacés.
 */
export function resolveEffectiveConfig(
  baseConfig: CommissionRuleConfig,
  overrides?: Partial<CommissionRuleConfig> | null,
): CommissionRuleConfig {
  if (!overrides) return baseConfig;
  const effective: CommissionRuleConfig = { ...baseConfig };
  for (const key of OVERRIDABLE_KEYS) {
    const value = overrides[key];
    if (value !== undefined && value !== null) {
      // Réaffectation champ à champ ; les clés sont contraintes à OVERRIDABLE_KEYS
      (effective as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return effective;
}

/**
 * Agrégation d'un plan = SOMME de ses composants (v1). L'opérateur est isolé ici
 * pour rester extensible (max, moyenne pondérée…) sans toucher aux appelants.
 * Chaque composant est calculé sur la base résolue puis multiplié par la part (share).
 * Cap appliqué par composant avant le share (Option A, cohérent avec l'existant).
 */
export function computePlanComponentsAmount(
  configs: CommissionRuleConfig[],
  input: CommissionBasisInput,
  share = 1,
): { total: number; breakdown: Array<{ amount: number; explanation: string; skippedReason?: string }> } {
  let total = 0;
  const breakdown: Array<{ amount: number; explanation: string; skippedReason?: string }> = [];
  for (const config of configs) {
    const { basisAmount } = resolveBasisAmount(config, input);
    const res = calculateCommissionAmount(basisAmount, config);
    const amount = applyShare(res.amount, share);
    total += amount;
    breakdown.push({ amount, explanation: res.explanation, skippedReason: res.skippedReason });
  }
  return { total: roundCents(total), breakdown };
}
