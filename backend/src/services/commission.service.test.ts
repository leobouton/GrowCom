/**
 * commission.service.test.ts
 * Tests unitaires — calcul de commission (pourcentage, fixe, paliers, floor, cap)
 */

import { describe, it, expect } from 'vitest';
import { calculateCommissionAmount } from './commission.service';
import { CommissionRuleType } from '../../../shared/types';
import type { CommissionRuleConfig } from '../../../shared/types';

// ─── Commission fixe ──────────────────────────────────────────────────────────

describe('calculateCommissionAmount — FIXED', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.FIXED,
    description: 'Commission fixe de 500€ par deal',
    fixedAmount: 500,
    examples: [{ saleAmount: 10000, commission: 500, explanation: 'Fixe' }],
  };

  it('retourne le montant fixe quel que soit le CA', () => {
    const result = calculateCommissionAmount(50000, config);
    expect(result.amount).toBe(500);
  });

  it('retourne le montant fixe même pour un petit deal', () => {
    const result = calculateCommissionAmount(100, config);
    expect(result.amount).toBe(500);
  });

  it('retourne 0 si fixedAmount absent', () => {
    const noAmount: CommissionRuleConfig = { ...config, fixedAmount: undefined };
    const result = calculateCommissionAmount(10000, noAmount);
    expect(result.amount).toBe(0);
  });
});

// ─── Commission pourcentage ───────────────────────────────────────────────────

describe('calculateCommissionAmount — PERCENTAGE', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.PERCENTAGE,
    description: '10% du CA',
    rate: 0.1,
    examples: [{ saleAmount: 10000, commission: 1000, explanation: '10%' }],
  };

  it('calcule 10% de 10 000€', () => {
    const result = calculateCommissionAmount(10000, config);
    expect(result.amount).toBe(1000);
  });

  it('calcule 10% de 0€', () => {
    const result = calculateCommissionAmount(0, config);
    expect(result.amount).toBe(0);
  });

  it('calcule correctement avec des décimales', () => {
    const result = calculateCommissionAmount(15750.50, config);
    expect(result.amount).toBeCloseTo(1575.05, 2);
  });
});

// ─── Commission par paliers ───────────────────────────────────────────────────

describe('calculateCommissionAmount — TIERED', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.TIERED,
    description: 'Paliers progressifs',
    tiers: [
      { min: 0, max: 10000, rate: 0.05 },
      { min: 10000, max: 50000, rate: 0.10 },
      { min: 50000, max: null, rate: 0.15 },
    ],
    examples: [{ saleAmount: 60000, commission: 6000, explanation: 'Paliers' }],
  };

  it('calcule le premier palier (5 000€ à 5%)', () => {
    const result = calculateCommissionAmount(5000, config);
    expect(result.amount).toBeCloseTo(250, 2); // 5000 * 0.05
  });

  it('calcule deux paliers (15 000€)', () => {
    const result = calculateCommissionAmount(15000, config);
    // Palier 1 : 10 000 * 5% = 500
    // Palier 2 : 5 000 * 10% = 500
    expect(result.amount).toBeCloseTo(1000, 2);
  });

  it('calcule tous les paliers (60 000€)', () => {
    const result = calculateCommissionAmount(60000, config);
    // Palier 1 : 10 000 * 5% = 500
    // Palier 2 : 40 000 * 10% = 4 000
    // Palier 3 : 10 000 * 15% = 1 500
    expect(result.amount).toBeCloseTo(6000, 2);
  });

  it('retourne 0 si aucun palier atteint', () => {
    const highFloor: CommissionRuleConfig = {
      ...config,
      tiers: [{ min: 100000, max: null, rate: 0.10 }],
    };
    const result = calculateCommissionAmount(5000, highFloor);
    expect(result.amount).toBe(0);
  });
});

// ─── Floor (seuil minimum) ────────────────────────────────────────────────────

describe('calculateCommissionAmount — floor', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.PERCENTAGE,
    description: '10% avec floor 5000€',
    rate: 0.1,
    floor: 5000,
    examples: [{ saleAmount: 10000, commission: 1000, explanation: '10%' }],
  };

  it('retourne 0 si sous le floor', () => {
    const result = calculateCommissionAmount(3000, config);
    expect(result.amount).toBe(0);
    expect(result.skippedReason).toBe('BELOW_FLOOR');
  });

  it('calcule normalement si au-dessus du floor', () => {
    const result = calculateCommissionAmount(10000, config);
    expect(result.amount).toBe(1000);
    expect(result.skippedReason).toBeUndefined();
  });

  it('calcule normalement si exactement au floor', () => {
    const result = calculateCommissionAmount(5000, config);
    expect(result.amount).toBe(500);
  });
});

// ─── Cap (plafond) ────────────────────────────────────────────────────────────

describe('calculateCommissionAmount — cap', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.PERCENTAGE,
    description: '10% plafonné à 2000€',
    rate: 0.1,
    cap: 2000,
    examples: [{ saleAmount: 10000, commission: 1000, explanation: '10%' }],
  };

  it('ne plafonne pas si sous le cap', () => {
    const result = calculateCommissionAmount(10000, config);
    expect(result.amount).toBe(1000);
  });

  it('plafonne si au-dessus du cap', () => {
    const result = calculateCommissionAmount(50000, config);
    expect(result.amount).toBe(2000);
    expect(result.explanation).toContain('plafonné');
  });

  it('retourne exactement le cap si pile dessus', () => {
    const result = calculateCommissionAmount(20000, config);
    expect(result.amount).toBe(2000);
  });
});

// ─── Calcul sur marge ─────────────────────────────────────────────────────────

describe('calculateCommissionAmount — calculationBasis MARGIN', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.PERCENTAGE,
    description: '15% de la marge',
    rate: 0.15,
    calculationBasis: 'MARGIN',
    examples: [{ saleAmount: 5000, commission: 750, explanation: '15% marge' }],
  };

  it('calcule sur le montant de marge fourni', () => {
    const result = calculateCommissionAmount(5000, config);
    expect(result.amount).toBe(750);
    expect(result.explanation).toContain('Marge');
  });
});

// ─── Floor + Cap combinés ─────────────────────────────────────────────────────

describe('calculateCommissionAmount — floor + cap combinés', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.PERCENTAGE,
    description: '10% entre 5000€ et cap 3000€',
    rate: 0.1,
    floor: 5000,
    cap: 3000,
    examples: [{ saleAmount: 20000, commission: 2000, explanation: 'Floor+cap' }],
  };

  it('retourne 0 si sous le floor', () => {
    const result = calculateCommissionAmount(2000, config);
    expect(result.amount).toBe(0);
  });

  it('calcule normalement entre floor et cap', () => {
    const result = calculateCommissionAmount(20000, config);
    expect(result.amount).toBe(2000);
  });

  it('plafonne si au-dessus du cap', () => {
    const result = calculateCommissionAmount(100000, config);
    expect(result.amount).toBe(3000);
  });
});
