/**
 * missionRecurrence.service.test.ts
 * Tests unitaires — helpers de récurrence de mission (fuseau + éligibilité au mois).
 */

import { describe, it, expect } from 'vitest';
import {
  getPeriodMonth,
  formatPeriodMonth,
  isMissionDueForPeriod,
} from './missionRecurrence.service';

// ─── getPeriodMonth (fuseau Europe/Paris) ─────────────────────────────────────

describe('getPeriodMonth', () => {
  it('retourne le 1er du mois (UTC minuit) du mois en cours', () => {
    const d = new Date('2026-07-15T10:00:00Z');
    const pm = getPeriodMonth(d);
    expect(pm.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('bascule correctement le 1er du mois à 00h30 heure de Paris (été = UTC+2)', () => {
    // 2026-07-01 00:30 Paris = 2026-06-30 22:30 UTC → doit rester juillet
    const d = new Date('2026-06-30T22:30:00Z');
    const pm = getPeriodMonth(d);
    expect(pm.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('le dernier jour du mois à 23h Paris reste dans le mois courant', () => {
    // 2026-07-31 23:00 Paris = 2026-07-31 21:00 UTC → juillet
    const d = new Date('2026-07-31T21:00:00Z');
    const pm = getPeriodMonth(d);
    expect(pm.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('formatPeriodMonth', () => {
  it('formate en libellé français', () => {
    expect(formatPeriodMonth(new Date('2026-07-01T00:00:00Z'))).toBe('juillet 2026');
    expect(formatPeriodMonth(new Date('2026-01-01T00:00:00Z'))).toBe('janvier 2026');
  });
});

// ─── isMissionDueForPeriod ────────────────────────────────────────────────────

describe('isMissionDueForPeriod', () => {
  const period = new Date(Date.UTC(2026, 6, 1)); // juillet 2026

  it('due si active, commencée et sans date de fin', () => {
    const mission = { status: 'ACTIVE', startDate: new Date('2026-01-01'), expectedEndDate: null };
    expect(isMissionDueForPeriod(mission, period)).toBe(true);
  });

  it('pas due si status ENDED', () => {
    const mission = { status: 'ENDED', startDate: new Date('2026-01-01'), expectedEndDate: null };
    expect(isMissionDueForPeriod(mission, period)).toBe(false);
  });

  it('pas due si commence après la fin du mois', () => {
    const mission = { status: 'ACTIVE', startDate: new Date('2026-08-01'), expectedEndDate: null };
    expect(isMissionDueForPeriod(mission, period)).toBe(false);
  });

  it('due si commence pendant le mois', () => {
    const mission = { status: 'ACTIVE', startDate: new Date('2026-07-15'), expectedEndDate: null };
    expect(isMissionDueForPeriod(mission, period)).toBe(true);
  });

  it('pas due si terminée avant le début du mois', () => {
    const mission = { status: 'ACTIVE', startDate: new Date('2026-01-01'), expectedEndDate: new Date('2026-06-30') };
    expect(isMissionDueForPeriod(mission, period)).toBe(false);
  });

  it('due si la date de fin tombe pendant le mois', () => {
    const mission = { status: 'ACTIVE', startDate: new Date('2026-01-01'), expectedEndDate: new Date('2026-07-20') };
    expect(isMissionDueForPeriod(mission, period)).toBe(true);
  });
});
