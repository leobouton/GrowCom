import { Mission } from '@prisma/client';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { ruleAssignmentRepository } from '../repositories/ruleAssignment.repository';
import { commissionRepository } from '../repositories/commission.repository';
import { commissionableEventRepository } from '../repositories/commissionableEvent.repository';
import { resolveBasisAmount, calculateCommissionAmount, resolveEffectiveConfig } from './commission.service';
import { CommissionRuleConfig } from '../../../shared/types';

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

// ─── Helpers de période (fuseau Europe/Paris) ────────────────────────────────

/**
 * Retourne le 1er jour (UTC minuit) du mois EN COURS dans le fuseau Europe/Paris.
 * On raisonne en heure de Paris pour que le basculement de mois soit correct
 * (ex: le 1er du mois à 00h30 Paris n'appartient pas au mois précédent).
 */
export function getPeriodMonth(date: Date = new Date(), timeZone = 'Europe/Paris'): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value); // 1-12
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Libellé "juillet 2026" à partir d'un periodMonth (1er du mois, UTC). */
export function formatPeriodMonth(periodMonth: Date): string {
  return `${MONTHS_FR[periodMonth.getUTCMonth()]} ${periodMonth.getUTCFullYear()}`;
}

/**
 * Une mission génère-t-elle un event pour ce mois ?
 * - status ACTIVE
 * - déjà commencée (startDate avant la fin du mois)
 * - pas terminée avant le début du mois (date de fin dépassée = plus d'event)
 */
export function isMissionDueForPeriod(
  mission: { status: string; startDate: Date; expectedEndDate: Date | null },
  periodMonth: Date,
): boolean {
  if (mission.status !== 'ACTIVE') return false;

  const periodEndExclusive = new Date(Date.UTC(
    periodMonth.getUTCFullYear(), periodMonth.getUTCMonth() + 1, 1,
  ));

  // Pas encore commencée à ce mois
  if (mission.startDate.getTime() >= periodEndExclusive.getTime()) return false;

  // Terminée avant ce mois
  if (mission.expectedEndDate && mission.expectedEndDate.getTime() < periodMonth.getTime()) {
    return false;
  }

  return true;
}

// ─── Génération pour une mission ──────────────────────────────────────────────

/**
 * Génère l'event du mois d'une mission (idempotent) et upsert les commissions
 * correspondantes (règles assignées au commercial ciblant MISSION_MONTH).
 * Retourne le nombre de commissions upsertées.
 */
export async function generateMissionMonth(
  mission: Mission,
  periodMonth: Date,
): Promise<number> {
  if (!mission.userId) return 0; // pas de commercial rattaché → pas de commission

  // 1. Event du mois (idempotent sur [missionId, periodMonth])
  const event = await commissionableEventRepository.upsertMissionMonth({
    tenantId: mission.tenantId,
    missionId: mission.id,
    dealId: mission.dealId,
    userId: mission.userId,
    periodMonth,
    amount: mission.monthlyAmount,
    marginAmount: mission.marginAmount,
    unitCount: mission.consultantCount,
    marginSource: mission.marginSource,
  });

  // 2. Règles assignées au commercial ciblant les events de mission
  const assignments = await ruleAssignmentRepository.findActiveForUser(mission.userId, mission.tenantId);
  const missionAssignments = assignments.filter((a) => {
    const config = a.rule.config as unknown as CommissionRuleConfig;
    return config.appliesToEventType === 'MISSION_MONTH';
  });

  if (missionAssignments.length === 0) return 0;

  const input = {
    amount: mission.monthlyAmount,
    marginAmount: mission.marginAmount,
    unitCount: mission.consultantCount,
  };
  const label = formatPeriodMonth(periodMonth);

  let count = 0;
  for (const assignment of missionAssignments) {
    const config = resolveEffectiveConfig(
      assignment.rule.config as unknown as CommissionRuleConfig,
      (assignment.overrides as Partial<CommissionRuleConfig> | null) ?? null,
    );
    const { basisAmount } = resolveBasisAmount(config, input);
    const { amount, explanation } = calculateCommissionAmount(basisAmount, config);

    await commissionRepository.upsertForMissionMonth({
      tenantId: mission.tenantId,
      userId: mission.userId,
      dealId: mission.dealId,
      ruleId: assignment.ruleId,
      missionId: mission.id,
      eventId: event.id,
      periodMonth,
      amount,
      calculationDetail: `${assignment.rule.name} (${label}) : ${explanation}`,
    });
    count++;
  }

  return count;
}

// ─── Job global ───────────────────────────────────────────────────────────────

/**
 * Génère les commissions récurrentes du mois en cours pour toutes les missions actives.
 * Idempotent (upserts sur clés uniques) : réexécutable sans doublon.
 * Appelé au démarrage (rattrapage) et le 1er de chaque mois par le scheduler.
 */
export async function generateRecurringMissionCommissions(now: Date = new Date()): Promise<void> {
  const periodMonth = getPeriodMonth(now);
  logger.info('[MissionRecurrence] Démarrage génération commissions récurrentes', {
    periodMonth: periodMonth.toISOString(),
  });

  const missions = await prisma.mission.findMany({ where: { status: 'ACTIVE' } });

  let totalCommissions = 0;
  let missionsProcessed = 0;
  let errors = 0;

  for (const mission of missions) {
    try {
      if (!isMissionDueForPeriod(mission, periodMonth)) continue;
      totalCommissions += await generateMissionMonth(mission, periodMonth);
      missionsProcessed++;
    } catch (err) {
      errors++;
      logger.error('[MissionRecurrence] Erreur pour la mission', {
        missionId: mission.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[MissionRecurrence] Génération terminée', {
    periodMonth: periodMonth.toISOString(),
    missionsProcessed,
    totalCommissions,
    errors,
  });
}
