/**
 * Tests du moteur de calcul partagé (shared/commission-engine).
 * Lancés par la suite de tests du backend : cd backend && npm test
 */

import { describe, it, expect } from 'vitest';
import { CommissionRuleType } from '../types';
import type { CommissionRuleConfig, CommissionTier, TierMode } from '../types';
import {
  computeCommission,
  calculateCommissionAmount,
  roundCents,
  allocateByShares,
  applyShare,
  formatRatePercent,
  computePlanComponentsAmount,
} from './index';

const percentage = (rate: number, extra: Partial<CommissionRuleConfig> = {}): CommissionRuleConfig => ({
  type: CommissionRuleType.PERCENTAGE, description: '', rate, examples: [], ...extra,
});
const fixed = (fixedAmount: number, extra: Partial<CommissionRuleConfig> = {}): CommissionRuleConfig => ({
  type: CommissionRuleType.FIXED, description: '', fixedAmount, examples: [], ...extra,
});
const tiered = (tiers: CommissionTier[], tierMode?: TierMode, extra: Partial<CommissionRuleConfig> = {}): CommissionRuleConfig => ({
  type: CommissionRuleType.TIERED, description: '', tiers, examples: [], ...(tierMode ? { tierMode } : {}), ...extra,
});

/** Grille type d'agence : 30 % jusqu'à 50 k€ d'honoraires, 40 % jusqu'à 100 k€, 50 % au-delà. */
const AGENCY_TIERS: CommissionTier[] = [
  { min: 0, max: 50000, rate: 0.3 },
  { min: 50000, max: 100000, rate: 0.4 },
  { min: 100000, max: null, rate: 0.5 },
];

const sumCents = (amounts: number[]) => Math.round(amounts.reduce((s, a) => s + a * 100, 0));

// ─── Pourcentage et forfait ──────────────────────────────────────────────────

describe('computeCommission — pourcentage simple', () => {
  it('10 % de 10 000 € = 1 000 €, une seule ligne de détail', () => {
    const result = computeCommission({ config: percentage(0.1), basisAmount: 10000 });
    expect(result.totalAmount).toBe(1000);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ kind: 'PERCENTAGE', base: 10000, rate: 0.1, amount: 1000 });
    expect(result.explanation).toBe('CA 10000.00€ × 10% = 1000.00€');
    expect(result.tierProgress).toBeNull();
  });

  it('un taux décimal n\'est plus arrondi à l\'entier dans le détail (2,5 % reste 2.5 %)', () => {
    const result = computeCommission({ config: percentage(0.025), basisAmount: 10000 });
    expect(result.totalAmount).toBe(250);
    expect(result.explanation).toBe('CA 10000.00€ × 2.5% = 250.00€');
  });

  it('libellé de base personnalisable (honoraires)', () => {
    const result = computeCommission({ config: percentage(0.3), basisAmount: 12000, basisLabel: 'Honoraires' });
    expect(result.explanation).toBe('Honoraires 12000.00€ × 30% = 3600.00€');
  });
});

describe('computeCommission — forfait', () => {
  it('forfait de 1 500 € quelle que soit la base', () => {
    const result = computeCommission({ config: fixed(1500), basisAmount: 320000 });
    expect(result.totalAmount).toBe(1500);
    expect(result.lines[0]).toMatchObject({ kind: 'FIXED', base: null, rate: null, amount: 1500 });
  });
});

// ─── Paliers marginaux ───────────────────────────────────────────────────────

describe('computeCommission — paliers marginaux (chaque tranche à son taux)', () => {
  it('sans déjà-réalisé : comportement historique, format de détail inchangé', () => {
    const config = tiered([
      { min: 0, max: 10000, rate: 0.05 },
      { min: 10000, max: 50000, rate: 0.1 },
    ]);
    const result = computeCommission({ config, basisAmount: 15000 });
    expect(result.totalAmount).toBe(1000);
    expect(result.explanation).toBe(
      'CA 15000.00€ par paliers : 10000.00€ × 5% = 500.00€ + 5000.00€ × 10% = 500.00€ = 1000.00€',
    );
  });

  it('avec déjà-réalisé : la vente est découpée à partir du CA cumulé', () => {
    // 40 000 € déjà faits, vente de 20 000 € → 10 000 € à 30 % + 10 000 € à 40 %
    const result = computeCommission({ config: tiered(AGENCY_TIERS), basisAmount: 20000, priorBasisAmount: 40000 });
    expect(result.totalAmount).toBe(7000);
    expect(result.lines.map((l) => [l.base, l.rate, l.amount])).toEqual([
      [10000, 0.3, 3000],
      [10000, 0.4, 4000],
    ]);
    expect(result.explanation).toContain('déjà réalisé : 40000.00€');
  });

  it('vente qui traverse trois paliers', () => {
    // 45 000 déjà faits, vente de 70 000 → 5 000 × 30 % + 50 000 × 40 % + 15 000 × 50 %
    const result = computeCommission({ config: tiered(AGENCY_TIERS), basisAmount: 70000, priorBasisAmount: 45000 });
    expect(result.totalAmount).toBe(1500 + 20000 + 7500);
    expect(result.lines).toHaveLength(3);
  });

  it('la somme des lignes vaut le total (le détail « tombe juste »)', () => {
    const result = computeCommission({ config: tiered(AGENCY_TIERS), basisAmount: 33333.33, priorBasisAmount: 33333.33 });
    expect(sumCents(result.lines.map((l) => l.amount))).toBe(Math.round(result.totalAmount * 100));
  });
});

// ─── Paliers au taux atteint ─────────────────────────────────────────────────

describe('computeCommission — paliers au taux atteint (sans effet rétroactif)', () => {
  it('toute la vente au taux du palier atteint après la vente', () => {
    // 40 000 + 20 000 = 60 000 → palier 40 % → 20 000 × 40 %
    const result = computeCommission({ config: tiered(AGENCY_TIERS, 'REACHED'), basisAmount: 20000, priorBasisAmount: 40000 });
    expect(result.totalAmount).toBe(8000);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ kind: 'TIER', base: 20000, rate: 0.4 });
    expect(result.explanation).toContain('au taux du palier atteint');
  });

  it('atteindre pile le minimum d\'un palier le débloque', () => {
    const result = computeCommission({ config: tiered(AGENCY_TIERS, 'REACHED'), basisAmount: 20000, priorBasisAmount: 30000 });
    expect(result.lines[0].rate).toBe(0.4);
    expect(result.totalAmount).toBe(8000);
  });

  it('premier palier pas encore atteint → 0 €', () => {
    const config = tiered([{ min: 20000, max: null, rate: 0.35 }], 'REACHED');
    const result = computeCommission({ config, basisAmount: 5000, priorBasisAmount: 10000 });
    expect(result.totalAmount).toBe(0);
    expect(result.explanation).toContain('aucun palier atteint');
  });

  it('au-delà du max du dernier palier : le dernier palier atteint s\'applique', () => {
    const config = tiered([{ min: 0, max: 50000, rate: 0.3 }], 'REACHED');
    expect(computeCommission({ config, basisAmount: 10000, priorBasisAmount: 60000 }).totalAmount).toBe(3000);
  });
});

describe('computeCommission — paliers au taux atteint avec effet rétroactif', () => {
  it('franchir un palier déclenche un rattrapage sur le déjà réalisé', () => {
    // Vente : 20 000 × 40 % = 8 000 ; rattrapage : 40 000 × (40 % − 30 %) = 4 000
    const result = computeCommission({
      config: tiered(AGENCY_TIERS, 'REACHED_RETROACTIVE'), basisAmount: 20000, priorBasisAmount: 40000,
    });
    expect(result.totalAmount).toBe(12000);
    expect(result.lines.map((l) => l.kind)).toEqual(['TIER', 'RETROACTIVE_CATCH_UP']);
    expect(result.lines[1]).toMatchObject({ base: 40000, amount: 4000 });
    expect(result.lines[1].rate).toBeCloseTo(0.1, 10);
    expect(result.explanation).toContain('rattrapage');
  });

  it('sans changement de palier : pas de rattrapage', () => {
    const result = computeCommission({
      config: tiered(AGENCY_TIERS, 'REACHED_RETROACTIVE'), basisAmount: 5000, priorBasisAmount: 10000,
    });
    expect(result.totalAmount).toBe(1500);
    expect(result.lines).toHaveLength(1);
  });

  it('premier palier atteint alors que rien n\'était payé avant : rattrapage au taux plein', () => {
    const config = tiered([{ min: 20000, max: null, rate: 0.35 }], 'REACHED_RETROACTIVE');
    const result = computeCommission({ config, basisAmount: 10000, priorBasisAmount: 15000 });
    // 10 000 × 35 % + 15 000 × 35 %
    expect(result.totalAmount).toBe(3500 + 5250);
  });
});

// ─── Partage entre intervenants ──────────────────────────────────────────────

describe('computeCommission — partage entre intervenants', () => {
  it('split à 2 (mandat 50 % / vente 50 %)', () => {
    const result = computeCommission({
      config: percentage(0.3), basisAmount: 10000,
      participants: [{ id: 'mandat', share: 0.5 }, { id: 'vente', share: 0.5 }],
    });
    expect(result.participants.map((p) => p.amount)).toEqual([1500, 1500]);
  });

  it('split à 3 en tiers : aucun centime perdu ni créé', () => {
    const result = computeCommission({
      config: fixed(100), basisAmount: 0,
      participants: [{ id: 'a', share: 1 / 3 }, { id: 'b', share: 1 / 3 }, { id: 'c', share: 1 / 3 }],
    });
    expect(result.participants.map((p) => p.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(sumCents(result.participants.map((p) => p.amount))).toBe(10000);
  });

  it('split à 3 inégal (50 / 30 / 20) sur un montant non rond', () => {
    const result = computeCommission({
      config: fixed(1234.57), basisAmount: 0,
      participants: [{ id: 'a', share: 0.5 }, { id: 'b', share: 0.3 }, { id: 'c', share: 0.2 }],
    });
    expect(sumCents(result.participants.map((p) => p.amount))).toBe(123457);
    expect(result.participants[0].amount).toBeCloseTo(617.29, 2);
  });

  it('le plafond s\'applique sur le total avant le partage', () => {
    const result = computeCommission({
      config: percentage(0.1, { cap: 2000 }), basisAmount: 50000,
      participants: [{ id: 'a', share: 0.5 }, { id: 'b', share: 0.5 }],
    });
    expect(result.capped).toBe(true);
    expect(result.amountBeforeCap).toBe(5000);
    expect(result.participants.map((p) => p.amount)).toEqual([1000, 1000]);
  });

  it('parts dont la somme ne fait pas 100 % → erreur explicite', () => {
    expect(() =>
      computeCommission({ config: percentage(0.1), basisAmount: 1000, participants: [{ id: 'a', share: 0.5 }, { id: 'b', share: 0.4 }] }),
    ).toThrow(/100 %/);
  });

  it('part négative → erreur explicite', () => {
    expect(() =>
      computeCommission({ config: percentage(0.1), basisAmount: 1000, participants: [{ id: 'a', share: 1.2 }, { id: 'b', share: -0.2 }] }),
    ).toThrow(RangeError);
  });

  it('sans intervenant précisé : un seul à 100 %', () => {
    const result = computeCommission({ config: percentage(0.1), basisAmount: 1000 });
    expect(result.participants).toEqual([{ id: 'main', label: undefined, share: 1, amount: 100 }]);
  });
});

// ─── Montants à 0, seuil, cas limites ────────────────────────────────────────

describe('computeCommission — montants à 0 et cas limites', () => {
  it('base à 0 € en pourcentage → 0 €, parts à 0', () => {
    const result = computeCommission({
      config: percentage(0.3), basisAmount: 0,
      participants: [{ id: 'a', share: 0.6 }, { id: 'b', share: 0.4 }],
    });
    expect(result.totalAmount).toBe(0);
    expect(result.participants.map((p) => p.amount)).toEqual([0, 0]);
  });

  it('base à 0 € en paliers → aucun palier, 0 €', () => {
    const result = computeCommission({ config: tiered(AGENCY_TIERS), basisAmount: 0 });
    expect(result.totalAmount).toBe(0);
  });

  it('sous le seuil minimum → 0 € avec la raison', () => {
    const result = computeCommission({ config: percentage(0.1, { floor: 5000 }), basisAmount: 3000 });
    expect(result.totalAmount).toBe(0);
    expect(result.skippedReason).toBe('BELOW_FLOOR');
  });

  it('base négative → jamais de commission négative', () => {
    const result = computeCommission({ config: percentage(0.1), basisAmount: -4000 });
    expect(result.totalAmount).toBe(0);
    expect(result.explanation).toContain('borné à 0€');
  });

  it('règle non reconnue → 0 €, UNKNOWN_RULE (non remonté par la forme historique)', () => {
    const broken = tiered(AGENCY_TIERS, undefined, { tiers: undefined });
    expect(computeCommission({ config: broken, basisAmount: 1000 }).skippedReason).toBe('UNKNOWN_RULE');
    expect(calculateCommissionAmount(1000, broken)).toEqual({ amount: 0, explanation: 'Règle non reconnue' });
  });
});

// ─── Arrondis ────────────────────────────────────────────────────────────────

describe('arrondis au centime', () => {
  it('roundCents corrige les erreurs binaires des flottants', () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(Number.NaN)).toBe(0);
  });

  it('un pourcentage qui tombe entre deux centimes est arrondi', () => {
    // 3 333,33 × 3 % = 99,9999
    expect(computeCommission({ config: percentage(0.03), basisAmount: 3333.33 }).totalAmount).toBe(100);
    // 15 750,50 × 10 % = 1 575,05 (et pas 1575.0500000000002)
    expect(computeCommission({ config: percentage(0.1), basisAmount: 15750.5 }).totalAmount).toBe(1575.05);
  });

  it('applyShare arrondit la part d\'un intervenant', () => {
    expect(applyShare(1000, 1 / 3)).toBe(333.33);
  });

  it('allocateByShares : la somme des parts vaut toujours le total, sur 500 cas', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 500; i++) {
      const amount = roundCents(random() * 100000);
      const count = 2 + Math.floor(random() * 3);
      const weights = Array.from({ length: count }, () => 0.05 + random());
      const total = weights.reduce((s, w) => s + w, 0);
      const shares = weights.map((w) => w / total);
      const parts = allocateByShares(amount, shares);
      expect(sumCents(parts)).toBe(Math.round(amount * 100));
      parts.forEach((part) => expect(Math.round(part * 100)).toBeCloseTo(part * 100, 6));
    }
  });

  it('les composants d\'un plan sont arrondis après la part', () => {
    const { total, breakdown } = computePlanComponentsAmount([percentage(0.1)], { amount: 1000 }, 1 / 3);
    expect(breakdown[0].amount).toBe(33.33);
    expect(total).toBe(33.33);
  });

  it('formatRatePercent', () => {
    expect(formatRatePercent(0.1)).toBe('10');
    expect(formatRatePercent(0.025)).toBe('2.5');
    expect(formatRatePercent(0.07)).toBe('7');
  });
});

// ─── Progression vers le prochain palier ─────────────────────────────────────

describe('tierProgress', () => {
  it('« encore 5 000 € pour passer à 40 % »', () => {
    const { tierProgress } = computeCommission({ config: tiered(AGENCY_TIERS), basisAmount: 5000, priorBasisAmount: 40000 });
    expect(tierProgress).toMatchObject({
      cumulativeBasis: 45000,
      currentTier: AGENCY_TIERS[0],
      nextTier: AGENCY_TIERS[1],
      remainingToNextTier: 5000,
    });
    expect(tierProgress!.progressToNextTier).toBeCloseTo(0.9, 10);
  });

  it('dernier palier atteint : plus de palier suivant', () => {
    const { tierProgress } = computeCommission({ config: tiered(AGENCY_TIERS), basisAmount: 10000, priorBasisAmount: 120000 });
    expect(tierProgress).toMatchObject({ currentTier: AGENCY_TIERS[2], nextTier: null, remainingToNextTier: null, progressToNextTier: 1 });
  });

  it('premier palier pas encore atteint', () => {
    const tiers = [{ min: 20000, max: null, rate: 0.35 }];
    const { tierProgress } = computeCommission({ config: tiered(tiers), basisAmount: 5000 });
    expect(tierProgress).toMatchObject({ currentTier: null, nextTier: tiers[0], remainingToNextTier: 15000 });
    expect(tierProgress!.progressToNextTier).toBeCloseTo(0.25, 10);
  });

  it('calculé même sous le seuil minimum (la vente compte dans le CA)', () => {
    const { tierProgress, totalAmount } = computeCommission({
      config: tiered(AGENCY_TIERS, undefined, { floor: 10000 }), basisAmount: 5000, priorBasisAmount: 40000,
    });
    expect(totalAmount).toBe(0);
    expect(tierProgress?.cumulativeBasis).toBe(45000);
  });
});
