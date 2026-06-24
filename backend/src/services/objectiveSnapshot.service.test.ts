/**
 * objectiveSnapshot.service.test.ts
 * Tests unitaires — calcul plages de dates, bonus, détection fin d'objectif
 */

import { describe, it, expect } from 'vitest';
import { getObjectiveDateRange, computeBonus, isObjectiveEnded } from './objectiveSnapshot.service';
import type { Objective } from '../../../shared/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeObjective(overrides: Partial<Objective>): Objective {
  return {
    id: 'test-obj',
    label: 'Test',
    target: 10000,
    unit: '€',
    periodType: 'monthly',
    year: 2026,
    ...overrides,
  };
}

// ─── getObjectiveDateRange ───────────────────────────────────────────────────

describe('getObjectiveDateRange — monthly', () => {
  it('retourne le 1er au dernier jour du mois', () => {
    const obj = makeObjective({ periodType: 'monthly', month: 3, year: 2026 });
    const range = getObjectiveDateRange(obj);
    expect(range).not.toBeNull();
    const [start, end] = range!;
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(2); // Mars = index 2
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(2);
    expect(end.getDate()).toBe(31);
  });

  it('gère février (année non bissextile)', () => {
    const obj = makeObjective({ periodType: 'monthly', month: 2, year: 2025 });
    const range = getObjectiveDateRange(obj);
    expect(range![1].getDate()).toBe(28);
  });

  it('gère février (année bissextile)', () => {
    const obj = makeObjective({ periodType: 'monthly', month: 2, year: 2024 });
    const range = getObjectiveDateRange(obj);
    expect(range![1].getDate()).toBe(29);
  });
});

describe('getObjectiveDateRange — quarterly', () => {
  it('T1 = janvier à mars', () => {
    const obj = makeObjective({ periodType: 'quarterly', quarter: 1, year: 2026 });
    const range = getObjectiveDateRange(obj);
    expect(range![0].getMonth()).toBe(0); // Janvier
    expect(range![1].getMonth()).toBe(2); // Mars
    expect(range![1].getDate()).toBe(31);
  });

  it('T2 = avril à juin', () => {
    const obj = makeObjective({ periodType: 'quarterly', quarter: 2, year: 2026 });
    const range = getObjectiveDateRange(obj);
    expect(range![0].getMonth()).toBe(3); // Avril
    expect(range![1].getMonth()).toBe(5); // Juin
    expect(range![1].getDate()).toBe(30);
  });

  it('T4 = octobre à décembre', () => {
    const obj = makeObjective({ periodType: 'quarterly', quarter: 4, year: 2026 });
    const range = getObjectiveDateRange(obj);
    expect(range![0].getMonth()).toBe(9); // Octobre
    expect(range![1].getMonth()).toBe(11); // Décembre
    expect(range![1].getDate()).toBe(31);
  });
});

describe('getObjectiveDateRange — semester', () => {
  it('S1 = janvier à juin', () => {
    const obj = makeObjective({ periodType: 'semester', semester: 1, year: 2026 });
    const range = getObjectiveDateRange(obj);
    expect(range).not.toBeNull();
    const [start, end] = range!;
    expect(start.getMonth()).toBe(0); // Janvier
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(5); // Juin
    expect(end.getDate()).toBe(30);
  });

  it('S2 = juillet à décembre', () => {
    const obj = makeObjective({ periodType: 'semester', semester: 2, year: 2026 });
    const range = getObjectiveDateRange(obj);
    expect(range).not.toBeNull();
    const [start, end] = range!;
    expect(start.getMonth()).toBe(6); // Juillet
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(11); // Décembre
    expect(end.getDate()).toBe(31);
  });
});

describe('getObjectiveDateRange — annual', () => {
  it('couvre toute l\'année', () => {
    const obj = makeObjective({ periodType: 'annual', year: 2026 });
    const range = getObjectiveDateRange(obj);
    expect(range![0].getMonth()).toBe(0);
    expect(range![0].getDate()).toBe(1);
    expect(range![1].getMonth()).toBe(11);
    expect(range![1].getDate()).toBe(31);
  });
});

describe('getObjectiveDateRange — custom', () => {
  it('utilise startDate et endDate fournis', () => {
    const obj = makeObjective({
      periodType: 'custom',
      startDate: '2026-03-15',
      endDate: '2026-06-30',
    });
    const range = getObjectiveDateRange(obj);
    expect(range).not.toBeNull();
    expect(range![0].getMonth()).toBe(2); // Mars
    expect(range![0].getDate()).toBe(15);
  });

  it('retourne null si dates manquantes', () => {
    const obj = makeObjective({ periodType: 'custom' });
    const range = getObjectiveDateRange(obj);
    expect(range).toBeNull();
  });
});

// ─── computeBonus ─────────────────────────────────────────────────────────────

describe('computeBonus — mode none', () => {
  it('retourne 0 si bonusMode none', () => {
    const obj = makeObjective({ bonusMode: 'none' });
    expect(computeBonus(obj, 15000)).toBe(0);
  });

  it('retourne 0 si pas de bonus configuré', () => {
    const obj = makeObjective({});
    expect(computeBonus(obj, 15000)).toBe(0);
  });
});

describe('computeBonus — mode simple', () => {
  it('retourne 0 si objectif non atteint', () => {
    const obj = makeObjective({
      target: 10000,
      bonus: { enabled: true, type: 'percentage', value: 10 },
    });
    expect(computeBonus(obj, 8000)).toBe(0);
  });

  it('retourne 0 si pile à la cible (pas de dépassement)', () => {
    const obj = makeObjective({
      target: 10000,
      bonus: { enabled: true, type: 'percentage', value: 10 },
    });
    expect(computeBonus(obj, 10000)).toBe(0);
  });

  it('calcule le % sur le dépassement', () => {
    const obj = makeObjective({
      target: 10000,
      bonus: { enabled: true, type: 'percentage', value: 10 },
    });
    // 15000 - 10000 = 5000 excès * 10% = 500
    expect(computeBonus(obj, 15000)).toBe(500);
  });

  it('retourne la prime fixe si dépassement (type fixed)', () => {
    const obj = makeObjective({
      target: 10000,
      bonus: { enabled: true, type: 'fixed', value: 300 },
    });
    expect(computeBonus(obj, 12000)).toBe(300);
  });
});

describe('computeBonus — mode tiered', () => {
  it('cumule tous les paliers atteints', () => {
    const obj = makeObjective({
      target: 10000,
      bonusMode: 'tiered',
      bonusTiers: [
        { threshold: 80, reward: { type: 'fixed', value: 100 } },
        { threshold: 100, reward: { type: 'fixed', value: 200 } },
        { threshold: 120, reward: { type: 'fixed', value: 500 } },
      ],
    });
    // 12 000 / 10 000 = 120% → atteint les 3 paliers (80%, 100%, 120%)
    expect(computeBonus(obj, 12000)).toBe(800); // 100 + 200 + 500
  });

  it('ne cumule que les paliers atteints', () => {
    const obj = makeObjective({
      target: 10000,
      bonusMode: 'tiered',
      bonusTiers: [
        { threshold: 80, reward: { type: 'fixed', value: 100 } },
        { threshold: 100, reward: { type: 'fixed', value: 200 } },
        { threshold: 120, reward: { type: 'fixed', value: 500 } },
      ],
    });
    // 9 500 / 10 000 = 95% → atteint seulement le palier 80%
    expect(computeBonus(obj, 9500)).toBe(100);
  });

  it('retourne 0 si aucun palier atteint', () => {
    const obj = makeObjective({
      target: 10000,
      bonusMode: 'tiered',
      bonusTiers: [
        { threshold: 80, reward: { type: 'fixed', value: 100 } },
      ],
    });
    // 5 000 / 10 000 = 50% → en dessous de 80%
    expect(computeBonus(obj, 5000)).toBe(0);
  });

  it('supporte les paliers en pourcentage', () => {
    const obj = makeObjective({
      target: 10000,
      bonusMode: 'tiered',
      bonusTiers: [
        { threshold: 100, reward: { type: 'percentage', value: 5 } },
      ],
    });
    // 12 000 / 10 000 = 120% → atteint 100%, reward = 12 000 * 5% = 600
    expect(computeBonus(obj, 12000)).toBe(600);
  });
});

// ─── isObjectiveEnded ─────────────────────────────────────────────────────────

describe('isObjectiveEnded', () => {
  it('un objectif mensuel passé est terminé', () => {
    const obj = makeObjective({ periodType: 'monthly', month: 1, year: 2020 });
    expect(isObjectiveEnded(obj)).toBe(true);
  });

  it('un objectif dans le futur n\'est pas terminé', () => {
    const obj = makeObjective({ periodType: 'monthly', month: 12, year: 2099 });
    expect(isObjectiveEnded(obj)).toBe(false);
  });

  it('un objectif semestriel S1 2020 est terminé', () => {
    const obj = makeObjective({ periodType: 'semester', semester: 1, year: 2020 });
    expect(isObjectiveEnded(obj)).toBe(true);
  });

  it('un objectif semestriel S2 2099 n\'est pas terminé', () => {
    const obj = makeObjective({ periodType: 'semester', semester: 2, year: 2099 });
    expect(isObjectiveEnded(obj)).toBe(false);
  });

  it('un objectif custom passé est terminé', () => {
    const obj = makeObjective({
      periodType: 'custom',
      startDate: '2020-01-01',
      endDate: '2020-06-30',
    });
    expect(isObjectiveEnded(obj)).toBe(true);
  });

  it('retourne false si pas de plage de dates', () => {
    const obj = makeObjective({ periodType: 'custom' });
    expect(isObjectiveEnded(obj)).toBe(false);
  });
});
