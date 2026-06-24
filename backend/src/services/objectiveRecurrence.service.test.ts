/**
 * objectiveRecurrence.service.test.ts
 * Tests unitaires — construction d'occurrences depuis un template récurrent
 */

import { describe, it, expect } from 'vitest';
import { buildOccurrence } from './objectiveRecurrence.service';
import type { Objective } from '../../../shared/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'tpl-001',
    label: 'CA mensuel',
    target: 10000,
    unit: '€',
    periodType: 'monthly',
    recurrence: 'monthly',
    year: 2026,
    bonusMode: 'simple',
    bonus: { enabled: true, type: 'percentage', value: 10 },
    ...overrides,
  };
}

// ─── buildOccurrence ─────────────────────────────────────────────────────────

describe('buildOccurrence — monthly', () => {
  it('crée une occurrence avec un nouvel id', () => {
    const template = makeTemplate();
    const occ = buildOccurrence(template, { periodType: 'monthly', month: 6, year: 2026 });
    expect(occ.id).not.toBe(template.id);
    expect(occ.id).toBeTruthy();
  });

  it('lie l\'occurrence au template via parentObjectiveId', () => {
    const template = makeTemplate();
    const occ = buildOccurrence(template, { periodType: 'monthly', month: 6, year: 2026 });
    expect(occ.parentObjectiveId).toBe('tpl-001');
  });

  it('désactive la récurrence sur l\'occurrence', () => {
    const template = makeTemplate();
    const occ = buildOccurrence(template, { periodType: 'monthly', month: 6, year: 2026 });
    expect(occ.recurrence).toBe('none');
    expect(occ.recurrenceEndDate).toBeUndefined();
  });

  it('applique le mois et l\'année demandés', () => {
    const template = makeTemplate();
    const occ = buildOccurrence(template, { periodType: 'monthly', month: 3, year: 2027 });
    expect(occ.periodType).toBe('monthly');
    expect(occ.month).toBe(3);
    expect(occ.year).toBe(2027);
  });

  it('hérite le label, la cible, l\'unité et le bonus du template', () => {
    const template = makeTemplate();
    const occ = buildOccurrence(template, { periodType: 'monthly', month: 1, year: 2026 });
    expect(occ.label).toBe('CA mensuel');
    expect(occ.target).toBe(10000);
    expect(occ.unit).toBe('€');
    expect(occ.bonusMode).toBe('simple');
    expect(occ.bonus?.enabled).toBe(true);
  });

  it('nettoie startDate et endDate pour éviter le fallback custom', () => {
    const template = makeTemplate({ startDate: '2026-01-01', endDate: '2026-12-31' });
    const occ = buildOccurrence(template, { periodType: 'monthly', month: 1, year: 2026 });
    expect(occ.startDate).toBeUndefined();
    expect(occ.endDate).toBeUndefined();
  });
});

describe('buildOccurrence — quarterly', () => {
  it('crée une occurrence trimestrielle', () => {
    const template = makeTemplate({ recurrence: 'quarterly' });
    const occ = buildOccurrence(template, { periodType: 'quarterly', quarter: 2, year: 2026 });
    expect(occ.periodType).toBe('quarterly');
    expect(occ.quarter).toBe(2);
    expect(occ.year).toBe(2026);
    expect(occ.parentObjectiveId).toBe('tpl-001');
  });
});

describe('buildOccurrence — semester', () => {
  it('crée une occurrence S1', () => {
    const template = makeTemplate({ recurrence: 'semester' });
    const occ = buildOccurrence(template, { periodType: 'semester', semester: 1, year: 2026 });
    expect(occ.periodType).toBe('semester');
    expect(occ.semester).toBe(1);
    expect(occ.year).toBe(2026);
  });

  it('crée une occurrence S2', () => {
    const template = makeTemplate({ recurrence: 'semester' });
    const occ = buildOccurrence(template, { periodType: 'semester', semester: 2, year: 2026 });
    expect(occ.periodType).toBe('semester');
    expect(occ.semester).toBe(2);
    expect(occ.year).toBe(2026);
  });

  it('ne met pas de month/quarter sur une occurrence semestrielle', () => {
    const template = makeTemplate({ recurrence: 'semester', month: 5, quarter: 2 });
    const occ = buildOccurrence(template, { periodType: 'semester', semester: 1, year: 2026 });
    expect(occ.month).toBeUndefined();
    expect(occ.quarter).toBeUndefined();
    expect(occ.semester).toBe(1);
  });
});

describe('buildOccurrence — annual', () => {
  it('crée une occurrence annuelle', () => {
    const template = makeTemplate({ recurrence: 'annual' });
    const occ = buildOccurrence(template, { periodType: 'annual', year: 2027 });
    expect(occ.periodType).toBe('annual');
    expect(occ.year).toBe(2027);
    expect(occ.month).toBeUndefined();
    expect(occ.quarter).toBeUndefined();
    expect(occ.semester).toBeUndefined();
  });
});

// ─── Vérification de non-collision d'IDs ─────────────────────────────────────

describe('buildOccurrence — unicité des IDs', () => {
  it('génère des IDs uniques pour chaque occurrence', () => {
    const template = makeTemplate();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const occ = buildOccurrence(template, { periodType: 'monthly', month: 1, year: 2026 });
      ids.add(occ.id);
    }
    expect(ids.size).toBe(100);
  });
});
