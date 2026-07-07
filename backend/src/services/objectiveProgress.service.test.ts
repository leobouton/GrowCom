/**
 * Tests du POINT D'ENTRÉE UNIQUE de calcul des objectifs (Lot 1).
 * Garantit notamment la parité live / snapshot : les deux chemins appellent
 * les mêmes fonctions, sur le même périmètre (parts de deal, marge, missions).
 */
import { describe, it, expect } from 'vitest';
import {
  getObjectiveDateRange,
  computeObjectiveActual,
  countDealsWithoutMargin,
  computeBonus,
  buildObjectivesProgress,
  resolveMarginForMetrics,
  round2,
  type ObjectiveWonDeal,
  type ObjectiveMissionMonth,
} from './objectiveProgress.service';
import type { Objective } from '../../../shared/types';

const JUNE_2026: Objective = {
  id: 'obj-juin',
  label: 'CA juin',
  target: 10000,
  unit: '€',
  periodType: 'monthly',
  month: 6,
  year: 2026,
};

function deal(partial: Partial<ObjectiveWonDeal>): ObjectiveWonDeal {
  return {
    amount: 0,
    marginAmount: null,
    userShare: 1,
    closedAt: new Date(2026, 5, 15),
    syncedAt: new Date(2026, 5, 15),
    ...partial,
  };
}

function missionMonth(partial: Partial<ObjectiveMissionMonth>): ObjectiveMissionMonth {
  return { amount: 0, marginAmount: null, periodMonth: new Date(2026, 5, 1), ...partial };
}

describe('computeObjectiveActual — unité € (CA)', () => {
  it('somme les montants × part et ajoute le CA mensuel des missions', () => {
    const deals = [
      deal({ amount: 10000, userShare: 1 }),
      deal({ amount: 8000, userShare: 0.5 }), // deal splitté : 4 000 €
    ];
    const missions = [missionMonth({ amount: 3000 })];
    expect(computeObjectiveActual(JUNE_2026, deals, missions)).toBe(10000 + 4000 + 3000);
  });

  it('exclut les deals hors période et les deals sans date', () => {
    const deals = [
      deal({ amount: 10000 }),
      deal({ amount: 5000, closedAt: new Date(2026, 3, 10), syncedAt: new Date(2026, 3, 10) }), // avril
      deal({ amount: 7000, closedAt: null, syncedAt: null }), // sans date
    ];
    expect(computeObjectiveActual(JUNE_2026, deals)).toBe(10000);
  });

  it('exclut les mois de mission hors période', () => {
    const missions = [
      missionMonth({ amount: 3000 }), // juin
      missionMonth({ amount: 3000, periodMonth: new Date(2026, 6, 1) }), // juillet
      missionMonth({ amount: 3000, periodMonth: null }),
    ];
    expect(computeObjectiveActual(JUNE_2026, [], missions)).toBe(3000);
  });
});

describe('computeObjectiveActual — unité marge', () => {
  const margeObj: Objective = { ...JUNE_2026, id: 'obj-marge', unit: 'marge' };

  it('utilise la marge × part et IGNORE les deals sans marge (pas de repli CA)', () => {
    const deals = [
      deal({ amount: 10000, marginAmount: 4000, userShare: 0.5 }), // 2 000 €
      deal({ amount: 8000, marginAmount: null }),                   // ignoré
    ];
    const missions = [missionMonth({ amount: 5000, marginAmount: 1500 })];
    expect(computeObjectiveActual(margeObj, deals, missions)).toBe(2000 + 1500);
  });

  it('countDealsWithoutMargin compte les deals de la période sans marge', () => {
    const deals = [
      deal({ amount: 10000, marginAmount: 4000 }),
      deal({ amount: 8000, marginAmount: null }),
      deal({ amount: 8000, marginAmount: null, closedAt: new Date(2026, 3, 1), syncedAt: new Date(2026, 3, 1) }), // hors période
    ];
    expect(countDealsWithoutMargin(margeObj, deals)).toBe(1);
    expect(countDealsWithoutMargin(JUNE_2026, deals)).toBe(0); // objectif CA : sans objet
  });
});

describe('computeObjectiveActual — unité deals', () => {
  it('compte les ventes one-shot, jamais les mois de mission', () => {
    const dealsObj: Objective = { ...JUNE_2026, id: 'obj-deals', unit: 'deals', target: 5 };
    const deals = [deal({ amount: 1000 }), deal({ amount: 2000, userShare: 0.5 })];
    const missions = [missionMonth({ amount: 3000 })];
    expect(computeObjectiveActual(dealsObj, deals, missions)).toBe(2);
  });
});

describe('getObjectiveDateRange — garde-fou', () => {
  it('devine la période quand periodType est inconnu mais month présent', () => {
    const weird = { ...JUNE_2026, periodType: 'inconnu' } as unknown as Objective;
    const range = getObjectiveDateRange(weird);
    expect(range).not.toBeNull();
    expect(range![0].getMonth()).toBe(5); // juin
  });

  it('retourne null sans aucune info de période exploitable', () => {
    const none = { id: 'x', label: '', target: 1, unit: '€', periodType: 'inconnu' } as unknown as Objective;
    expect(getObjectiveDateRange(none)).toBeNull();
  });
});

describe('computeBonus — modes de prime', () => {
  it('simple fixe : versé uniquement au dépassement', () => {
    const obj: Objective = { ...JUNE_2026, bonus: { enabled: true, type: 'fixed', value: 500 } };
    expect(computeBonus(obj, 9999)).toBe(0);
    expect(computeBonus(obj, 10001)).toBe(500);
  });

  it('simple % : calculé sur l\'excédent', () => {
    const obj: Objective = { ...JUNE_2026, bonus: { enabled: true, type: 'percentage', value: 10 } };
    expect(computeBonus(obj, 12000)).toBe(200); // 10 % de 2 000 €
  });

  it('paliers : cumule tous les paliers atteints', () => {
    const obj: Objective = {
      ...JUNE_2026,
      bonusMode: 'tiered',
      bonusTiers: [
        { threshold: 100, reward: { type: 'fixed', value: 500 } },
        { threshold: 120, reward: { type: 'fixed', value: 1000 } },
      ],
    };
    expect(computeBonus(obj, 9000)).toBe(0);      // 90 %
    expect(computeBonus(obj, 10000)).toBe(500);   // 100 %
    expect(computeBonus(obj, 12000)).toBe(1500);  // 120 % : cumul
  });
});

describe('buildObjectivesProgress — parité live / snapshot', () => {
  it('objectif en cours : calcul LIVE arrondi à 2 décimales', () => {
    const now = new Date();
    const currentObj: Objective = {
      ...JUNE_2026,
      id: 'obj-courant',
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      bonus: { enabled: true, type: 'percentage', value: 10 },
    };
    const deals = [deal({ amount: 10000.333, closedAt: now, syncedAt: now })];
    const [p] = buildObjectivesProgress([currentObj], deals, [], []);
    expect(p.source).toBe('LIVE');
    expect(p.actualValue).toBe(10000.33);
    expect(p.bonusProjected).toBe(round2(computeBonus(currentObj, 10000.33)));
  });

  it('objectif terminé déjà figé : valeurs du SNAPSHOT servies telles quelles, jamais recalculées', () => {
    // Snapshot volontairement différent du recalcul pour prouver qu'on ne recalcule pas
    const snapshot = { objectiveId: 'obj-juin', periodLabel: 'juin 2026', actualValue: 4242, bonusEarned: 999 };
    const deals = [deal({ amount: 100000 })];
    const [p] = buildObjectivesProgress([JUNE_2026], deals, [], [snapshot]);
    expect(p.source).toBe('SNAPSHOT');
    expect(p.actualValue).toBe(4242);
    expect(p.bonusProjected).toBe(999);
  });

  it('objectif terminé NON figé : calcul live en attendant le job de 7h (tolérance 0 à la clôture)', () => {
    const deals = [deal({ amount: 12000 })];
    const objWithBonus: Objective = { ...JUNE_2026, bonus: { enabled: true, type: 'fixed', value: 500 } };
    const [live] = buildObjectivesProgress([objWithBonus], deals, [], []);
    // Le snapshot appellera les MÊMES fonctions sur le MÊME périmètre :
    const snapshotValue = round2(computeObjectiveActual(objWithBonus, deals, []));
    const snapshotBonus = round2(computeBonus(objWithBonus, snapshotValue));
    expect(live.actualValue).toBe(snapshotValue);
    expect(live.bonusProjected).toBe(snapshotBonus);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT — règle UNIQUE de résolution de la marge (objectifs ET concours)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveMarginForMetrics — règle unique objectifs/concours', () => {
  it('marge renseignée → utilisée telle quelle (même à 0)', () => {
    expect(resolveMarginForMetrics({ amount: 10000, marginAmount: 4000 })).toBe(4000);
    expect(resolveMarginForMetrics({ amount: 10000, marginAmount: 0 })).toBe(0);
  });

  it('marge absente mais coût connu → amount - costAmount', () => {
    expect(resolveMarginForMetrics({ amount: 10000, marginAmount: null, costAmount: 6000 })).toBe(4000);
  });

  it('ni marge ni coût → null (deal EXCLU, jamais de repli sur le CA)', () => {
    expect(resolveMarginForMetrics({ amount: 10000 })).toBeNull();
    expect(resolveMarginForMetrics({ amount: 10000, marginAmount: null, costAmount: null })).toBeNull();
  });

  it('coût > CA → marge négative restituée (le moteur de commission la borne à 0 de son côté)', () => {
    expect(resolveMarginForMetrics({ amount: 5000, marginAmount: null, costAmount: 8000 })).toBe(-3000);
  });
});

describe('computeObjectiveActual — marge via coût (repli amount - costAmount)', () => {
  const margeObj: Objective = { ...JUNE_2026, id: 'obj-marge-cost', unit: 'marge' };

  it('un deal sans marge mais avec coût compte pour amount - costAmount', () => {
    const deals = [
      deal({ amount: 10000, marginAmount: 4000 }),                        // 4 000
      deal({ amount: 8000, marginAmount: null, costAmount: 5000 }),       // 3 000
      deal({ amount: 7000, marginAmount: null, costAmount: null }),       // exclu
    ];
    expect(computeObjectiveActual(margeObj, deals)).toBe(7000);
  });

  it('le repli coût respecte la part (share) du commercial', () => {
    const deals = [deal({ amount: 8000, marginAmount: null, costAmount: 5000, userShare: 0.5 })];
    expect(computeObjectiveActual(margeObj, deals)).toBe(1500);
  });

  it('countDealsWithoutMargin ne compte plus les deals dont le coût permet de déduire la marge', () => {
    const deals = [
      deal({ amount: 10000, marginAmount: 4000 }),                   // marge connue
      deal({ amount: 8000, marginAmount: null, costAmount: 5000 }),  // marge déduite
      deal({ amount: 7000, marginAmount: null, costAmount: null }),  // sans marge
    ];
    expect(countDealsWithoutMargin(margeObj, deals)).toBe(1);
  });
});

describe('computeBonus — cas limites', () => {
  it('target à 0 : pas de division par zéro, prime paliers jamais atteinte à pct 0', () => {
    const obj: Objective = {
      ...JUNE_2026, id: 'obj-zero', target: 0,
      bonusMode: 'tiered',
      bonusTiers: [{ threshold: 100, reward: { type: 'fixed', value: 500 } }],
    };
    expect(computeBonus(obj, 5000)).toBe(0);
  });

  it('pile sur la cible : prime simple NON versée (il faut dépasser)', () => {
    const obj: Objective = {
      ...JUNE_2026, id: 'obj-pile',
      bonus: { enabled: true, type: 'fixed', value: 500 },
    };
    expect(computeBonus(obj, 10000)).toBe(0);
    expect(computeBonus(obj, 10000.01)).toBe(500);
  });

  it('paliers : pile sur le seuil → palier atteint (>=)', () => {
    const obj: Objective = {
      ...JUNE_2026, id: 'obj-seuil',
      bonusMode: 'tiered',
      bonusTiers: [
        { threshold: 100, reward: { type: 'fixed', value: 300 } },
        { threshold: 120, reward: { type: 'fixed', value: 200 } },
      ],
    };
    expect(computeBonus(obj, 10000)).toBe(300);        // 100% pile
    expect(computeBonus(obj, 12000)).toBe(500);        // 100% + 120% cumulés
    expect(computeBonus(obj, 9999)).toBe(0);           // 99,99%
  });
});
