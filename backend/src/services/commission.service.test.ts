/**
 * commission.service.test.ts
 * Tests unitaires — calcul de commission (pourcentage, fixe, paliers, floor, cap)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateCommissionAmount,
  resolveBasisAmount,
  computePlanComponentsAmount,
  resolveEffectiveConfig,
  filterAssignmentsForDealType,
} from './commission.service';
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

// ═══════════════════════════════════════════════════════════════════════════
// SESSION F — moteur généralisé (events, forfait/consultant, somme composants)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Forfait par consultant (PER_UNIT) ────────────────────────────────────────

describe('calculateCommissionAmount — PER_UNIT (forfait par consultant)', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.FIXED,
    description: '100€ par mois et par consultant placé',
    fixedAmount: 100,
    calculationBasis: 'PER_UNIT',
    examples: [{ saleAmount: 3, commission: 300, explanation: '3 × 100€' }],
  };

  it('multiplie le forfait par le nombre de consultants', () => {
    const result = calculateCommissionAmount(3, config);
    expect(result.amount).toBe(300);
    expect(result.explanation).toContain('3 consultants');
  });

  it('retourne le forfait unitaire pour 1 consultant', () => {
    const result = calculateCommissionAmount(1, config);
    expect(result.amount).toBe(100);
    expect(result.explanation).toContain('1 consultant');
  });

  it('retourne 0 pour 0 consultant', () => {
    const result = calculateCommissionAmount(0, config);
    expect(result.amount).toBe(0);
  });

  it('respecte le cap sur le forfait total', () => {
    const capped: CommissionRuleConfig = { ...config, cap: 250 };
    const result = calculateCommissionAmount(3, capped);
    expect(result.amount).toBe(250);
    expect(result.explanation).toContain('plafonné');
  });
});

// ─── resolveBasisAmount ───────────────────────────────────────────────────────

describe('resolveBasisAmount', () => {
  it('REVENUE → utilise amount', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: 'CA', rate: 0.1,
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { basisAmount, basisLabel } = resolveBasisAmount(config, { amount: 10000 });
    expect(basisAmount).toBe(10000);
    expect(basisLabel).toBe('CA');
  });

  it('MARGIN → utilise marginAmount fourni', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: 'Marge', rate: 0.1, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 10000, marginAmount: 4000 });
    expect(basisAmount).toBe(4000);
  });

  it('MARGIN → fallback amount - coût si pas de marge', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: 'Marge', rate: 0.1, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 10000, marginAmount: null, costAmount: 6000 });
    expect(basisAmount).toBe(4000);
  });

  it('MARGIN → base 0 si ni marge ni coût (marge inconnue = commission à 0, jamais de repli CA)', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: 'Marge', rate: 0.1, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 10000 });
    expect(basisAmount).toBe(0);
    expect(calculateCommissionAmount(basisAmount, config).amount).toBe(0);
  });

  it('MARGIN → marge à 0 explicite = commission à 0 (pas confondue avec « inconnue »)', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: 'Marge', rate: 0.1, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 10000, marginAmount: 0 });
    expect(basisAmount).toBe(0);
  });

  it('REVENUE → toujours le CA, même sans marge (une règle sur CA reste sur CA)', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: 'CA', rate: 0.1,
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 10000, marginAmount: null, costAmount: null });
    expect(basisAmount).toBe(10000);
    expect(calculateCommissionAmount(basisAmount, config).amount).toBe(1000);
  });

  it('PER_UNIT → utilise unitCount', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.FIXED, description: 'Forfait', fixedAmount: 100, calculationBasis: 'PER_UNIT',
      examples: [{ saleAmount: 1, commission: 100, explanation: 'x' }],
    };
    const { basisAmount, basisLabel } = resolveBasisAmount(config, { amount: 0, unitCount: 4 });
    expect(basisAmount).toBe(4);
    expect(basisLabel).toBe('consultants');
  });
});

// ─── Event mensuel de mission ESN ──────────────────────────────────────────────

describe('moteur sur un event MISSION_MONTH', () => {
  it('% sur la marge mensuelle d\'une mission', () => {
    // Mission : 3000€ de marge mensuelle récurrente, règle 5% sur marge
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: '5% marge mensuelle', rate: 0.05, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 3000, commission: 150, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 8000, marginAmount: 3000 });
    const result = calculateCommissionAmount(basisAmount, config);
    expect(result.amount).toBe(150);
  });

  it('forfait par consultant sur un mois de mission (2 consultants)', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.FIXED, description: '100€/mois/consultant', fixedAmount: 100, calculationBasis: 'PER_UNIT',
      examples: [{ saleAmount: 2, commission: 200, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 8000, unitCount: 2 });
    const result = calculateCommissionAmount(basisAmount, config);
    expect(result.amount).toBe(200);
  });
});

// ─── Somme des composants d'un plan (agrégation SUM) ───────────────────────────

describe('computePlanComponentsAmount — SUM', () => {
  const marginRule: CommissionRuleConfig = {
    type: CommissionRuleType.PERCENTAGE, description: '5% marge', rate: 0.05, calculationBasis: 'MARGIN',
    examples: [{ saleAmount: 3000, commission: 150, explanation: 'x' }],
  };
  const forfaitRule: CommissionRuleConfig = {
    type: CommissionRuleType.FIXED, description: '100€/consultant', fixedAmount: 100, calculationBasis: 'PER_UNIT',
    examples: [{ saleAmount: 2, commission: 200, explanation: 'x' }],
  };

  it('somme deux composants (marge mensuelle + forfait/consultant)', () => {
    const { total, breakdown } = computePlanComponentsAmount(
      [marginRule, forfaitRule],
      { amount: 8000, marginAmount: 3000, unitCount: 2 },
    );
    // 5% de 3000 = 150 ; 2 × 100 = 200 ; somme = 350
    expect(total).toBe(350);
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0].amount).toBe(150);
    expect(breakdown[1].amount).toBe(200);
  });

  it('applique la part (share) à chaque composant', () => {
    const { total } = computePlanComponentsAmount(
      [marginRule, forfaitRule],
      { amount: 8000, marginAmount: 3000, unitCount: 2 },
      0.5,
    );
    // (150 + 200) × 0.5 = 175
    expect(total).toBe(175);
  });

  it('un seul composant = son montant', () => {
    const { total } = computePlanComponentsAmount([marginRule], { amount: 8000, marginAmount: 3000 });
    expect(total).toBe(150);
  });
});

// ─── resolveEffectiveConfig (template + override) ──────────────────────────────

describe('resolveEffectiveConfig', () => {
  const base: CommissionRuleConfig = {
    type: CommissionRuleType.PERCENTAGE,
    description: '5% du CA',
    rate: 0.05,
    examples: [{ saleAmount: 10000, commission: 500, explanation: '5%' }],
  };

  it('retourne la base si aucun override', () => {
    expect(resolveEffectiveConfig(base, null)).toBe(base);
    expect(resolveEffectiveConfig(base, undefined)).toBe(base);
  });

  it('surcharge le taux (5% → 6% pour un senior)', () => {
    const effective = resolveEffectiveConfig(base, { rate: 0.06 });
    expect(effective.rate).toBe(0.06);
    // Le calcul reflète bien le taux surchargé
    expect(calculateCommissionAmount(10000, effective).amount).toBe(600);
  });

  it('ne mute pas la config de base', () => {
    resolveEffectiveConfig(base, { rate: 0.06 });
    expect(base.rate).toBe(0.05);
  });

  it('surcharge cap et floor', () => {
    const effective = resolveEffectiveConfig(base, { cap: 400, floor: 2000 });
    expect(effective.cap).toBe(400);
    expect(effective.floor).toBe(2000);
    expect(calculateCommissionAmount(10000, effective).amount).toBe(400); // plafonné
  });

  it('ne remplace que les champs fournis (override partiel)', () => {
    const effective = resolveEffectiveConfig(base, { cap: 400 });
    expect(effective.rate).toBe(0.05); // inchangé
    expect(effective.cap).toBe(400);
  });

  it('ne surcharge pas les champs sémantiques non surchargeables', () => {
    // calculationBasis / appliesToEventType ne font pas partie des clés surchargeables
    const effective = resolveEffectiveConfig(base, {
      calculationBasis: 'MARGIN',
      appliesToEventType: 'MISSION_MONTH',
    } as Partial<CommissionRuleConfig>);
    expect(effective.calculationBasis).toBeUndefined();
    expect(effective.appliesToEventType).toBeUndefined();
  });

  it('surcharge le forfait par consultant (fixedAmount)', () => {
    const forfait: CommissionRuleConfig = {
      type: CommissionRuleType.FIXED,
      description: '100€/consultant',
      fixedAmount: 100,
      calculationBasis: 'PER_UNIT',
      examples: [{ saleAmount: 1, commission: 100, explanation: 'x' }],
    };
    const effective = resolveEffectiveConfig(forfait, { fixedAmount: 150 });
    expect(effective.fixedAmount).toBe(150);
    expect(calculateCommissionAmount(2, effective).amount).toBe(300); // 2 × 150
  });

  it('surcharge les paliers (tiers) sans toucher au reste', () => {
    const tiered: CommissionRuleConfig = {
      type: CommissionRuleType.TIERED,
      description: 'Paliers',
      tiers: [{ min: 0, max: null, rate: 0.05 }],
      examples: [{ saleAmount: 10000, commission: 500, explanation: 'x' }],
    };
    const effective = resolveEffectiveConfig(tiered, {
      tiers: [{ min: 0, max: null, rate: 0.08 }],
    });
    expect(calculateCommissionAmount(10000, effective).amount).toBe(800);
    expect(calculateCommissionAmount(10000, tiered).amount).toBe(500); // base intacte
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT — bases négatives (marge négative = affaire à perte)
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateCommissionAmount — base négative (jamais de commission négative)', () => {
  it('PERCENTAGE sur marge négative → 0€, jamais une retenue', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: '10% marge', rate: 0.1, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const result = calculateCommissionAmount(-4000, config);
    expect(result.amount).toBe(0);
    expect(result.explanation).toContain('borné à 0€');
  });

  it('TIERED sur base négative → 0€ (aucun palier atteint)', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.TIERED, description: 'Paliers',
      tiers: [{ min: 0, max: 10000, rate: 0.05 }, { min: 10000, max: null, rate: 0.1 }],
      examples: [{ saleAmount: 1, commission: 0, explanation: 'x' }],
    };
    const result = calculateCommissionAmount(-500, config);
    expect(result.amount).toBe(0);
  });

  it('PER_UNIT avec compteur négatif (donnée corrompue) → 0€', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.FIXED, description: 'Forfait', fixedAmount: 100, calculationBasis: 'PER_UNIT',
      examples: [{ saleAmount: 1, commission: 100, explanation: 'x' }],
    };
    const result = calculateCommissionAmount(-2, config);
    expect(result.amount).toBe(0);
  });

  it('FIXED reste dû même si la base est négative (déclenché par la vente, pas la marge)', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.FIXED, description: 'Fixe 500€', fixedAmount: 500,
      examples: [{ saleAmount: 1, commission: 500, explanation: 'x' }],
    };
    expect(calculateCommissionAmount(-1000, config).amount).toBe(500);
  });

  it('marge négative via amount - costAmount (coût > CA) → 0€', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: '10% marge', rate: 0.1, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { basisAmount } = resolveBasisAmount(config, { amount: 5000, marginAmount: null, costAmount: 8000 });
    expect(basisAmount).toBe(-3000);
    expect(calculateCommissionAmount(basisAmount, config).amount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT — matching des règles par type de vente (dealType)
// ═══════════════════════════════════════════════════════════════════════════

describe('filterAssignmentsForDealType', () => {
  const rule = (dealType: string | null) => ({ rule: { dealType } });

  it('la règle spécifique gagne sur la générique', () => {
    const assignments = [rule('Recrutement'), rule(null), rule('Formation')];
    const result = filterAssignmentsForDealType(assignments, 'Recrutement');
    expect(result).toHaveLength(1);
    expect(result[0].rule.dealType).toBe('Recrutement');
  });

  it('sans règle spécifique correspondante → repli sur les génériques', () => {
    const assignments = [rule('Recrutement'), rule(null)];
    const result = filterAssignmentsForDealType(assignments, 'Portage');
    expect(result).toHaveLength(1);
    expect(result[0].rule.dealType).toBeNull();
  });

  it('deal sans type → uniquement les règles génériques', () => {
    const assignments = [rule('Recrutement'), rule(null)];
    expect(filterAssignmentsForDealType(assignments, null)).toHaveLength(1);
    expect(filterAssignmentsForDealType(assignments, undefined)).toHaveLength(1);
    expect(filterAssignmentsForDealType(assignments, '')).toHaveLength(1);
  });

  it('matching insensible à la casse et aux espaces', () => {
    const assignments = [rule('  Recrutement ')];
    const result = filterAssignmentsForDealType(assignments, 'recrutement');
    expect(result).toHaveLength(1);
  });

  it('que des règles spécifiques non correspondantes → aucune règle (pas de commission parasite)', () => {
    const assignments = [rule('Recrutement'), rule('Formation')];
    expect(filterAssignmentsForDealType(assignments, 'Portage')).toHaveLength(0);
  });

  it('plusieurs règles spécifiques du même type → toutes appliquées', () => {
    const assignments = [rule('Formation'), rule('Formation'), rule(null)];
    expect(filterAssignmentsForDealType(assignments, 'Formation')).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT — paliers : bornes exactes et configs mal saisies
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateCommissionAmount — TIERED bornes et robustesse', () => {
  const config: CommissionRuleConfig = {
    type: CommissionRuleType.TIERED,
    description: 'Paliers',
    tiers: [
      { min: 0, max: 10000, rate: 0.05 },
      { min: 10000, max: 50000, rate: 0.10 },
    ],
    examples: [{ saleAmount: 1, commission: 0, explanation: 'x' }],
  };

  it('pile sur la frontière (10 000€) : pas de double comptage', () => {
    // Palier 1 : 10 000 × 5% = 500 ; palier 2 : 0€ au-delà de 10 000
    expect(calculateCommissionAmount(10000, config).amount).toBeCloseTo(500, 2);
  });

  it('au-delà du dernier max (60 000 > 50 000) : la tranche s\'arrête au max', () => {
    // Palier 1 : 500 ; palier 2 : 40 000 × 10% = 4 000 ; au-delà : rien (pas de palier ouvert)
    expect(calculateCommissionAmount(60000, config).amount).toBeCloseTo(4500, 2);
  });

  it('paliers saisis dans le désordre : triés avant calcul', () => {
    const shuffled: CommissionRuleConfig = {
      ...config,
      tiers: [
        { min: 10000, max: 50000, rate: 0.10 },
        { min: 0, max: 10000, rate: 0.05 },
      ],
    };
    expect(calculateCommissionAmount(15000, shuffled).amount).toBeCloseTo(1000, 2);
  });

  it('TIERED sans tiers défini → 0€ et « règle non reconnue »', () => {
    const broken: CommissionRuleConfig = { ...config, tiers: undefined };
    const result = calculateCommissionAmount(15000, broken);
    expect(result.amount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT — Option A : cap appliqué sur le TOTAL, puis part (share)
// ═══════════════════════════════════════════════════════════════════════════

describe('cap avant part (Option A, split multi-commerciaux)', () => {
  it('le cap s\'applique sur le total avant le share de chaque commercial', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: '10% cap 2000', rate: 0.1, cap: 2000,
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    // Deal 50 000€ → 10% = 5 000 → cap 2 000 → 50/50 = 1 000 chacun
    const total = calculateCommissionAmount(50000, config).amount;
    expect(total).toBe(2000);
    expect(total * 0.5).toBe(1000);
  });

  it('computePlanComponentsAmount applique cap par composant puis share', () => {
    const capped: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: '10% cap 300', rate: 0.1, cap: 300, calculationBasis: 'MARGIN',
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const { total } = computePlanComponentsAmount([capped], { amount: 9000, marginAmount: 5000 }, 0.5);
    // 10% de 5000 = 500 → cap 300 → × 0.5 = 150
    expect(total).toBe(150);
  });

  it('la somme des parts vaut le total cappé (pas de perte ni de création d\'argent)', () => {
    const config: CommissionRuleConfig = {
      type: CommissionRuleType.PERCENTAGE, description: '10% cap 2000', rate: 0.1, cap: 2000,
      examples: [{ saleAmount: 1, commission: 0.1, explanation: 'x' }],
    };
    const total = calculateCommissionAmount(50000, config).amount;
    const shares = [0.5, 0.3, 0.2];
    const sum = shares.reduce((s, share) => s + total * share, 0);
    expect(sum).toBeCloseTo(total, 6);
  });
});
