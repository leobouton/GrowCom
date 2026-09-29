import { describe, it, expect } from 'vitest';
import { simulateAgencySale } from '@shared/commission-engine';
import {
  DEFAULT_STATE,
  SCENARIOS,
  cloneState,
  decodeState,
  encodeState,
  evenShares,
  toSimulationInput,
} from './state';

describe('URL de simulation', () => {
  it('aller-retour sans perte pour chaque scénario', () => {
    for (const scenario of SCENARIOS) {
      expect(decodeState(encodeState(scenario.state))).toEqual(scenario.state);
    }
  });

  it('les séparateurs restent lisibles (pas d\'encodage %2C)', () => {
    const query = encodeState(DEFAULT_STATE);
    expect(query).toContain('pal=0-30_40000-35_60000-40');
    expect(query).not.toContain('%');
  });

  it('URL sans paramètre de simulation → valeurs par défaut', () => {
    expect(decodeState('?utm_source=email')).toEqual(DEFAULT_STATE);
    expect(decodeState('')).toEqual(DEFAULT_STATE);
  });

  it('paramètres invalides ignorés un par un, le reste est conservé', () => {
    const state = decodeState('?prix=abc&hon=7&rem=inconnu&parts=pirate-50_vente-100&ret=pack-eur-x');
    expect(state.price).toBe(DEFAULT_STATE.price);
    expect(state.fees).toBe(7);
    expect(state.rem).toBe(DEFAULT_STATE.rem);
    expect(state.participants).toEqual([{ role: 'vente', share: 100 }]);
    expect(state.deductions).toEqual([]);
  });

  it('valeurs décimales conservées', () => {
    const state = cloneState(DEFAULT_STATE);
    state.fees = 4.75;
    state.tiers[1].rate = 32.5;
    expect(decodeState(encodeState(state))).toEqual(state);
  });
});

describe('conversion vers le moteur', () => {
  it('tous les scénarios donnent une simulation valide', () => {
    for (const scenario of SCENARIOS) {
      expect(simulateAgencySale(toSimulationInput(scenario.state)).ok).toBe(true);
    }
  });

  it('le scénario par défaut retrouve l\'exemple de la page d\'accueil', () => {
    const outcome = simulateAgencySale(toSimulationInput(DEFAULT_STATE));
    expect(outcome.ok && outcome.result.commission.totalAmount).toBe(3981.25);
  });

  it('les pourcentages saisis sont convertis en taux', () => {
    const input = toSimulationInput({ ...DEFAULT_STATE, rem: 'pct', rate: 30, fees: 5 });
    expect(input.remuneration.rate).toBe(0.3);
    expect(input.feesValue).toBe(0.05);
  });
});

describe('evenShares', () => {
  it('parts égales qui totalisent 100', () => {
    expect(evenShares(1)).toEqual([100]);
    expect(evenShares(2)).toEqual([50, 50]);
    expect(evenShares(3)).toEqual([33.34, 33.33, 33.33]);
  });
});
