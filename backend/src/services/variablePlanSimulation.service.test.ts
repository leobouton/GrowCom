/**
 * variablePlanSimulation.service.test.ts
 * Vérifie que la simulation d'un plan réutilise fidèlement le moteur réel :
 * one-shot (CA/marge), récurrent (marge mensuelle / forfait consultant),
 * primes d'objectifs (simple + paliers), cap, et totaux.
 */
import { describe, it, expect } from 'vitest';
import { simulatePlan } from './variablePlanSimulation.service';
import type { GeneratedPlanDraft, PlanSimulationScenario } from '../../../shared/types';
import { CommissionRuleType } from '../../../shared/types';

const baseScenario: PlanSimulationScenario = {
  dealAmount: 10000,
  dealMargin: null,
  missionMonthlyAmount: 8000,
  missionMonthlyMargin: 3000,
  consultantCount: 2,
  missionMonths: 12,
  objectiveAchievementPct: 100,
};

function plan(components: GeneratedPlanDraft['components']): GeneratedPlanDraft {
  return { name: 'Plan test', description: 'test', components };
}

describe('simulatePlan', () => {
  it('calcule un composant one-shot en % du CA', () => {
    const result = simulatePlan(
      plan([{
        kind: 'COMMISSION_RULE',
        name: 'Prime signature',
        config: { type: CommissionRuleType.PERCENTAGE, description: '10% du CA', rate: 0.10, examples: [] },
      }]),
      baseScenario,
    );
    expect(result.totalOneShot).toBe(1000);
    expect(result.lines[0].kind).toBe('ONE_SHOT');
    expect(result.lines[0].amount).toBe(1000);
    expect(result.grandTotal).toBe(1000);
  });

  it('utilise la marge du deal quand calculationBasis=MARGIN', () => {
    const result = simulatePlan(
      plan([{
        kind: 'COMMISSION_RULE',
        name: 'Prime marge',
        config: { type: CommissionRuleType.PERCENTAGE, description: '15% marge', rate: 0.15, calculationBasis: 'MARGIN', examples: [] },
      }]),
      { ...baseScenario, dealMargin: 4000 },
    );
    expect(result.totalOneShot).toBe(600); // 15% × 4000
  });

  it('calcule un récurrent marge mensuelle avec projection sur la durée', () => {
    const result = simulatePlan(
      plan([{
        kind: 'COMMISSION_RULE',
        name: 'Récurrent marge',
        config: { type: CommissionRuleType.PERCENTAGE, description: '5% marge mensuelle', rate: 0.05, calculationBasis: 'MARGIN', appliesToEventType: 'MISSION_MONTH', examples: [] },
      }]),
      baseScenario,
    );
    const line = result.lines[0];
    expect(line.kind).toBe('RECURRING');
    expect(line.monthlyAmount).toBe(150); // 5% × 3000
    expect(line.months).toBe(12);
    expect(line.projectedTotal).toBe(1800);
    expect(result.totalMonthly).toBe(150);
    expect(result.grandTotal).toBe(1800);
  });

  it('calcule un forfait par consultant (PER_UNIT)', () => {
    const result = simulatePlan(
      plan([{
        kind: 'COMMISSION_RULE',
        name: 'Forfait consultant',
        config: { type: CommissionRuleType.FIXED, description: '100€/consultant/mois', fixedAmount: 100, calculationBasis: 'PER_UNIT', appliesToEventType: 'MISSION_MONTH', examples: [] },
      }]),
      baseScenario, // 2 consultants
    );
    expect(result.totalMonthly).toBe(200);
    expect(result.grandTotal).toBe(2400); // 200 × 12
  });

  it('applique le cap du moteur réel', () => {
    const result = simulatePlan(
      plan([{
        kind: 'COMMISSION_RULE',
        name: 'Plafonnée',
        config: { type: CommissionRuleType.PERCENTAGE, description: '10% plafonné', rate: 0.10, cap: 500, examples: [] },
      }]),
      baseScenario, // 10% × 10000 = 1000 → cap 500
    );
    expect(result.totalOneShot).toBe(500);
  });

  it('prime objectif à paliers : palier 100% atteint', () => {
    const result = simulatePlan(
      plan([{
        kind: 'OBJECTIVE',
        objective: {
          label: 'CA trimestriel', target: 150000, unit: '€', periodType: 'quarterly',
          bonusMode: 'tiered',
          bonusTiers: [
            { threshold: 80, reward: { type: 'fixed', value: 300 } },
            { threshold: 100, reward: { type: 'fixed', value: 1000 } },
          ],
        },
      }]),
      baseScenario, // 100% d'atteinte → les deux paliers (cumulables)
    );
    expect(result.totalObjectiveBonus).toBe(1300);
    expect(result.lines[0].kind).toBe('OBJECTIVE_BONUS');
  });

  it('prime objectif simple : rien à 100%, prime au-delà', () => {
    const objective = {
      label: 'CA annuel', target: 100000, unit: '€' as const, periodType: 'annual' as const,
      bonus: { enabled: true, type: 'fixed' as const, value: 2000 },
      bonusMode: 'simple' as const,
    };
    const at100 = simulatePlan(plan([{ kind: 'OBJECTIVE', objective }]), baseScenario);
    expect(at100.totalObjectiveBonus).toBe(0); // prime de DÉPASSEMENT

    const at120 = simulatePlan(plan([{ kind: 'OBJECTIVE', objective }]), { ...baseScenario, objectiveAchievementPct: 120 });
    expect(at120.totalObjectiveBonus).toBe(2000);
  });

  it('additionne un plan complet (one-shot + récurrent + objectif)', () => {
    const result = simulatePlan(
      plan([
        { kind: 'COMMISSION_RULE', name: 'Signature', config: { type: CommissionRuleType.PERCENTAGE, description: '10%', rate: 0.10, examples: [] } },
        { kind: 'COMMISSION_RULE', name: 'Récurrent', config: { type: CommissionRuleType.FIXED, description: '100€/consultant', fixedAmount: 100, calculationBasis: 'PER_UNIT', appliesToEventType: 'MISSION_MONTH', examples: [] } },
        { kind: 'OBJECTIVE', objective: { label: 'Obj', target: 50000, unit: '€', periodType: 'quarterly', bonusMode: 'tiered', bonusTiers: [{ threshold: 100, reward: { type: 'fixed', value: 500 } }] } },
      ]),
      baseScenario,
    );
    // one-shot 1000 + récurrent 200×12=2400 + prime 500
    expect(result.totalOneShot).toBe(1000);
    expect(result.totalMonthly).toBe(200);
    expect(result.totalObjectiveBonus).toBe(500);
    expect(result.grandTotal).toBe(3900);
    expect(result.lines).toHaveLength(3);
  });
});
