/**
 * Job snapshot quotidien (7h) : fige les objectifs TERMINÉS dans ObjectiveSnapshot
 * et crée la prime (ajustement auto-payé) le cas échéant.
 *
 * Tout le calcul (périmètre, valeur atteinte, prime) passe par le POINT D'ENTRÉE
 * UNIQUE du moteur : objectiveProgress.service. Le dashboard live et ce job
 * produisent donc STRICTEMENT les mêmes montants (Lot 1).
 */
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { objectiveSnapshotRepository } from '../repositories/objectiveSnapshot.repository';
import { commissionAdjustmentRepository } from '../repositories/commissionAdjustment.repository';
import { dealRepository } from '../repositories/deal.repository';
import { commissionableEventRepository } from '../repositories/commissionableEvent.repository';
import {
  getObjectiveDateRange,
  formatObjectivePeriod,
  isObjectiveEnded,
  computeObjectiveActual,
  computeBonus,
  round2,
} from './objectiveProgress.service';
import type { Objective } from '@shared/types';

// Ré-exports de compatibilité : les consommateurs historiques (tests, simulation)
// importent ces fonctions depuis ce module. La source canonique est
// objectiveProgress.service.
export { getObjectiveDateRange, isObjectiveEnded, computeBonus };

// ─── Service principal ────────────────────────────────────────

async function snapshotEndedObjectivesForUser(
  userId: string,
  tenantId: string,
): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId, tenantId },
    select: { objectives: true },
  });

  if (!user || !user.objectives) return 0;

  const objectives = user.objectives as unknown as Objective[];

  // Filtrer les objectifs terminés (exclure les templates récurrents)
  const ended = objectives.filter(
    (o) => isObjectiveEnded(o) && !(o.recurrence && o.recurrence !== 'none' && !o.parentObjectiveId),
  );

  if (ended.length === 0) return 0;

  // Périmètre RICHE, identique au live du dashboard :
  // - deals WON à commission VALIDATED/PAID, part userShare des splits appliquée,
  //   marge incluse (via DealAssignment + rétrocompat assignedToId) ;
  // - mois de mission à commission VALIDATED/PAID (CA et marge mensuels).
  const [wonDeals, missionMonths] = await Promise.all([
    dealRepository.findWonForObjectives(userId, tenantId),
    commissionableEventRepository.findMissionMonthsByUserId(userId, tenantId),
  ]);

  let created = 0;

  for (const obj of ended) {
    const periodLabel = formatObjectivePeriod(obj);
    const alreadyExists = await objectiveSnapshotRepository.existsForPeriod(
      userId, tenantId, obj.id, periodLabel,
    );
    if (alreadyExists) continue;

    const actualValue = round2(computeObjectiveActual(obj, wonDeals, missionMonths));
    const bonusEarned = round2(computeBonus(obj, actualValue));

    await objectiveSnapshotRepository.create({
      tenantId,
      userId,
      objectiveId: obj.id,
      periodLabel,
      snapshotData: obj as unknown as Record<string, unknown>,
      actualValue,
      bonusEarned,
    });

    // Prime automatique : si bonus > 0, créer un ajustement directement payé (sans validation manager)
    if (bonusEarned > 0) {
      const unitLabel = obj.unit === 'deals' ? ' deals' : obj.unit === 'marge' ? ' € de marge' : ' €';
      await commissionAdjustmentRepository.create({
        tenantId,
        userId,
        amount: bonusEarned,
        reason: `Prime objectif "${obj.label}" — ${periodLabel} (atteint : ${actualValue}${unitLabel} / cible : ${obj.target})`,
        createdBy: 'SYSTEM',
        autoPaid: true,
      });
      logger.info('[ObjectiveSnapshot] Prime auto-payée', {
        userId, objectiveId: obj.id, periodLabel, bonusEarned,
      });
    }

    created++;
  }

  return created;
}

/**
 * Lance les snapshots pour tous les utilisateurs actifs.
 * Appelé quotidiennement à 7h par le scheduler.
 */
export async function snapshotEndedObjectives(): Promise<void> {
  logger.info('[ObjectiveSnapshot] Démarrage snapshot objectifs terminés');

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, tenantId: true },
  });

  let totalCreated = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const count = await snapshotEndedObjectivesForUser(user.id, user.tenantId!);
      totalCreated += count;
    } catch (err) {
      errors++;
      logger.error('[ObjectiveSnapshot] Erreur pour user', { userId: user.id, err });
    }
  }

  logger.info('[ObjectiveSnapshot] Snapshot terminé', { totalCreated, errors });
}
