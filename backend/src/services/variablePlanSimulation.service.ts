/**
 * Simulation d'un plan de variable (brouillon IA ou plan édité) sur un scénario
 * paramétrable. RÈGLE ABSOLUE : réutilise le moteur RÉEL de calcul
 * (resolveBasisAmount / calculateCommissionAmount de commission.service et
 * computeBonus d'objectiveSnapshot.service) — le frontend ne calcule jamais.
 *
 * Fonction PURE (aucun accès BDD) → testable unitairement.
 */
import {
  GeneratedPlanDraft,
  Objective,
  PlanSimulationLine,
  PlanSimulationResult,
  PlanSimulationScenario,
} from '../../../shared/types';
import { resolveBasisAmount, calculateCommissionAmount } from './commission.service';
import { computeBonus } from './objectiveProgress.service';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function simulatePlan(
  plan: GeneratedPlanDraft,
  scenario: PlanSimulationScenario,
): PlanSimulationResult {
  const months = Math.max(1, Math.round(scenario.missionMonths));
  const lines: PlanSimulationLine[] = [];
  let totalOneShot = 0;
  let totalMonthly = 0;
  let totalObjectiveBonus = 0;

  plan.components.forEach((component, componentIndex) => {
    if (component.kind === 'COMMISSION_RULE') {
      const config = component.config;
      const isRecurring = config.appliesToEventType === 'MISSION_MONTH';

      const input = isRecurring
        ? {
            amount: scenario.missionMonthlyAmount,
            marginAmount: scenario.missionMonthlyMargin,
            unitCount: scenario.consultantCount,
          }
        : {
            amount: scenario.dealAmount,
            marginAmount: scenario.dealMargin,
          };

      const { basisAmount } = resolveBasisAmount(config, input);
      const { amount, explanation } = calculateCommissionAmount(basisAmount, config);
      const rounded = round2(amount);

      if (isRecurring) {
        totalMonthly += rounded;
        lines.push({
          componentIndex,
          componentName: component.name,
          kind: 'RECURRING',
          amount: rounded,
          monthlyAmount: rounded,
          months,
          projectedTotal: round2(rounded * months),
          explanation: `${explanation} — chaque mois tant que la mission tourne`,
        });
      } else {
        totalOneShot += rounded;
        lines.push({
          componentIndex,
          componentName: component.name,
          kind: 'ONE_SHOT',
          amount: rounded,
          explanation,
        });
      }
      return;
    }

    // Composant OBJECTIF : prime selon le % d'atteinte simulé
    const objective = component.objective;
    const achieved = round2(objective.target * (scenario.objectiveAchievementPct / 100));
    // computeBonus attend un Objective complet ; l'id n'intervient pas dans le calcul
    const bonusAmount = round2(computeBonus({ ...objective, id: '__draft__' } as Objective, achieved));
    totalObjectiveBonus += bonusAmount;

    const unitLabel = objective.unit === 'deals' ? ' deals' : objective.unit === 'marge' ? ' € de marge' : ' €';
    lines.push({
      componentIndex,
      componentName: objective.label,
      kind: 'OBJECTIVE_BONUS',
      amount: bonusAmount,
      explanation:
        `${scenario.objectiveAchievementPct.toFixed(0)}% de l'objectif atteint ` +
        `(${achieved.toLocaleString('fr-FR')}${unitLabel} / cible ${objective.target.toLocaleString('fr-FR')}${unitLabel}) ` +
        `→ prime ${bonusAmount.toLocaleString('fr-FR')} €`,
    });
  });

  return {
    totalOneShot: round2(totalOneShot),
    totalMonthly: round2(totalMonthly),
    totalObjectiveBonus: round2(totalObjectiveBonus),
    grandTotal: round2(totalOneShot + totalMonthly * months + totalObjectiveBonus),
    lines,
  };
}
