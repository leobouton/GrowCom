/**
 * Tests de la simulation de vente immobilière (simulateur public).
 * Lancés par la suite de tests du backend : cd backend && npm test
 */

import { describe, it, expect } from 'vitest';
import {
  simulateAgencySale,
  validateSimulationInput,
  computeFees,
  tiersFromThresholds,
  computeCommission,
  buildRemunerationConfig,
} from './index';
import type { AgencySaleSimulationInput, AgencySaleSimulationResult } from './index';

const TIERS = tiersFromThresholds([
  { from: 0, rate: 0.3 },
  { from: 40000, rate: 0.35 },
  { from: 60000, rate: 0.4 },
]);

/** L'exemple de la page d'accueil : 285 000 €, 5 % TTC, 36 500 € déjà réalisés. */
const baseInput = (overrides: Partial<AgencySaleSimulationInput> = {}): AgencySaleSimulationInput => ({
  salePrice: 285000,
  feesMode: 'PERCENT_OF_PRICE',
  feesValue: 0.05,
  feesTaxBasis: 'TTC',
  status: 'AGENT',
  remuneration: { mode: 'TIERED', tiers: TIERS, tierMode: 'MARGINAL' },
  priorRevenue: 36500,
  participants: [{ id: 'main', label: 'Négociateur', share: 1 }],
  deductions: [],
  salesPerYear: 10,
  ...overrides,
});

function run(input: AgencySaleSimulationInput): AgencySaleSimulationResult {
  const outcome = simulateAgencySale(input);
  if (!outcome.ok) throw new Error(outcome.issues.map((i) => i.message).join(' / '));
  return outcome.result;
}

const sumCents = (amounts: number[]) => Math.round(amounts.reduce((s, a) => s + a * 100, 0));

describe('tiersFromThresholds', () => {
  it('chaque palier s\'arrête où commence le suivant, le dernier est ouvert', () => {
    expect(TIERS).toEqual([
      { min: 0, max: 40000, rate: 0.3 },
      { min: 40000, max: 60000, rate: 0.35 },
      { min: 60000, max: null, rate: 0.4 },
    ]);
  });

  it('seuils saisis dans le désordre : triés', () => {
    const tiers = tiersFromThresholds([{ from: 50000, rate: 0.4 }, { from: 0, rate: 0.3 }]);
    expect(tiers.map((t) => [t.min, t.max])).toEqual([[0, 50000], [50000, null]]);
  });
});

describe('computeFees — honoraires TTC / HT', () => {
  it('5 % TTC de 285 000 € → 14 250 € TTC, 11 875 € HT', () => {
    expect(computeFees(baseInput())).toEqual({ inclTax: 14250, exclTax: 11875, vat: 2375 });
  });

  it('montant saisi HT → TTC recalculé', () => {
    expect(computeFees({ salePrice: 0, feesMode: 'AMOUNT', feesValue: 10000, feesTaxBasis: 'HT' })).toEqual({
      inclTax: 12000, exclTax: 10000, vat: 2000,
    });
  });

  it('arrondi au centime sur un TTC non divisible', () => {
    const fees = computeFees({ salePrice: 0, feesMode: 'AMOUNT', feesValue: 10001, feesTaxBasis: 'TTC' });
    expect(fees.exclTax).toBe(8334.17);
    expect(fees.vat).toBe(1666.83);
  });

  it('agence non assujettie à la TVA : taux 0 %', () => {
    expect(computeFees({ salePrice: 200000, feesMode: 'PERCENT_OF_PRICE', feesValue: 0.04, feesTaxBasis: 'TTC', vatRate: 0 })).toEqual({
      inclTax: 8000, exclTax: 8000, vat: 0,
    });
  });
});

describe('simulateAgencySale', () => {
  it('reproduit l\'exemple de la page d\'accueil : 3 981,25 €', () => {
    const result = run(baseInput());
    expect(result.commission.totalAmount).toBe(3981.25);
    expect(result.netCommission).toBe(3981.25);
    expect(result.agencyShare).toBe(11875 - 3981.25);
    expect(result.commission.tierProgress?.remainingToNextTier).toBe(11625);
  });

  it('pourcentage fixe des honoraires HT', () => {
    const result = run(baseInput({ remuneration: { mode: 'PERCENTAGE', rate: 0.7 } }));
    expect(result.commission.totalAmount).toBe(8312.5);
    expect(result.commission.tierProgress).toBeNull();
  });

  it('forfait par vente', () => {
    const result = run(baseInput({ remuneration: { mode: 'FIXED', fixedAmount: 1500 } }));
    expect(result.commission.totalAmount).toBe(1500);
    expect(result.agencyShare).toBe(10375);
  });

  it('les trois modes de paliers donnent les résultats de l\'article de blog', () => {
    const modes = ['MARGINAL', 'REACHED', 'REACHED_RETROACTIVE'] as const;
    const totals = modes.map((tierMode) => run(baseInput({ remuneration: { mode: 'TIERED', tiers: TIERS, tierMode } })).commission.totalAmount);
    expect(totals).toEqual([3981.25, 4156.25, 5981.25]);
  });

  it('retenues : % de la commission et € par vente', () => {
    const result = run(
      baseInput({
        remuneration: { mode: 'PERCENTAGE', rate: 0.5 },
        deductions: [
          { id: 'r', label: 'Redevance réseau', mode: 'PERCENT_OF_COMMISSION', value: 0.1 },
          { id: 'p', label: 'Pack', mode: 'AMOUNT_PER_SALE', value: 200 },
        ],
      }),
    );
    // brut 5 937,50 ; redevance 593,75 ; pack 200 → net 5 143,75
    expect(result.commission.totalAmount).toBe(5937.5);
    expect(result.deductions.map((d) => d.amount)).toEqual([593.75, 200]);
    expect(result.totalDeductions).toBe(793.75);
    expect(result.netCommission).toBe(5143.75);
    expect(result.agencyShare).toBe(11875 - 5143.75);
  });

  it('retenues supérieures à la commission : net ramené à 0, jamais négatif', () => {
    const result = run(
      baseInput({
        remuneration: { mode: 'FIXED', fixedAmount: 100 },
        deductions: [{ id: 'p', label: 'Pack', mode: 'AMOUNT_PER_SALE', value: 250 }],
      }),
    );
    expect(result.netCommission).toBe(0);
    expect(result.totalDeductions).toBe(100);
    expect(result.deductionsCapped).toBe(true);
  });

  it('partage mandat / vente : brut et net répartis au centime', () => {
    const result = run(
      baseInput({
        participants: [
          { id: 'mandat', label: 'Mandat', share: 0.4 },
          { id: 'vente', label: 'Vente', share: 0.6 },
        ],
        deductions: [{ id: 'p', label: 'Pack', mode: 'AMOUNT_PER_SALE', value: 100 }],
      }),
    );
    expect(result.participants.map((p) => p.gross)).toEqual([1592.5, 2388.75]);
    expect(sumCents(result.participants.map((p) => p.net))).toBe(Math.round(result.netCommission * 100));
    expect(sumCents(result.participants.map((p) => p.deductions))).toBe(10000);
  });

  it('partage à 3 en tiers', () => {
    const third = 1 / 3;
    const result = run(
      baseInput({
        remuneration: { mode: 'FIXED', fixedAmount: 1000 },
        participants: [{ id: 'a', share: third }, { id: 'b', share: third }, { id: 'c', share: third }],
      }),
    );
    expect(result.participants.map((p) => p.net)).toEqual([333.34, 333.33, 333.33]);
  });

  it('prix à 0 € → tout à 0, sans erreur', () => {
    const result = run(baseInput({ salePrice: 0 }));
    expect(result.fees.exclTax).toBe(0);
    expect(result.commission.totalAmount).toBe(0);
    expect(result.projection.effectiveRate).toBe(0);
  });
});

describe('projection annuelle', () => {
  it('paliers par tranche : la somme de l\'année vaut le calcul direct sur le CA total', () => {
    const { projection, config } = run(baseInput({ salesPerYear: 12 }));
    const direct = computeCommission({ config, basisAmount: 11875 * 12 }).totalAmount;
    expect(projection.totalFeesExclTax).toBe(142500);
    expect(Math.abs(projection.grossCommission - direct)).toBeLessThanOrEqual(0.02);
  });

  it('taux atteint rétroactif : sur l\'année, tout le CA finit au taux du dernier palier atteint', () => {
    const { projection } = run(baseInput({ salesPerYear: 8, remuneration: { mode: 'TIERED', tiers: TIERS, tierMode: 'REACHED_RETROACTIVE' } }));
    // 8 × 11 875 = 95 000 € → palier 40 % → 38 000 €
    expect(projection.grossCommission).toBe(38000);
    expect(projection.sales.map((s) => s.reachedRate)).toEqual([0.3, 0.3, 0.3, 0.35, 0.35, 0.4, 0.4, 0.4]);
  });

  it('la projection part d\'une année vierge (le CA déjà réalisé ne compte pas)', () => {
    const a = run(baseInput({ priorRevenue: 0 })).projection;
    const b = run(baseInput({ priorRevenue: 80000 })).projection;
    expect(a).toEqual(b);
  });

  it('retenues appliquées vente par vente', () => {
    const { projection } = run(
      baseInput({
        salesPerYear: 3,
        remuneration: { mode: 'FIXED', fixedAmount: 1000 },
        deductions: [{ id: 'p', label: 'Pack', mode: 'AMOUNT_PER_SALE', value: 150 }],
      }),
    );
    expect(projection.grossCommission).toBe(3000);
    expect(projection.netCommission).toBe(2550);
    expect(projection.sales.every((s) => s.reachedRate === null)).toBe(true);
  });

  it('taux effectif moyen', () => {
    const { projection } = run(baseInput({ remuneration: { mode: 'PERCENTAGE', rate: 0.25 } }));
    expect(projection.effectiveRate).toBeCloseTo(0.25, 10);
  });
});

describe('validateSimulationInput', () => {
  it('saisie valide : aucun problème', () => {
    expect(validateSimulationInput(baseInput())).toEqual([]);
  });

  it('parts qui ne font pas 100 % : message explicite, pas d\'exception', () => {
    const outcome = simulateAgencySale(baseInput({ participants: [{ id: 'a', share: 0.5 }, { id: 'b', share: 0.4 }] }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.issues[0].message).toContain('actuellement 90 %');
  });

  it('valeurs impossibles signalées champ par champ', () => {
    const issues = validateSimulationInput(
      baseInput({
        salePrice: -1,
        feesValue: 1.5,
        remuneration: { mode: 'TIERED', tiers: [{ min: 0, max: null, rate: 0.3 }, { min: 0, max: null, rate: 0.4 }] },
        deductions: [{ id: 'x', label: 'Pack', mode: 'PERCENT_OF_COMMISSION', value: 2 }],
        salesPerYear: 0,
      }),
    );
    expect(issues.map((i) => i.field)).toEqual(['salePrice', 'feesValue', 'remuneration.tiers', 'deductions.x', 'salesPerYear']);
  });

  it('paliers vides refusés', () => {
    const issues = validateSimulationInput(baseInput({ remuneration: { mode: 'TIERED', tiers: [] } }));
    expect(issues.map((i) => i.field)).toContain('remuneration.tiers');
  });

  it('buildRemunerationConfig : mode par tranche par défaut', () => {
    expect(buildRemunerationConfig({ mode: 'TIERED', tiers: TIERS }).tierMode).toBe('MARGINAL');
  });
});
