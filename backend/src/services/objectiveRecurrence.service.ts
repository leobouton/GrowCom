import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type { Objective } from '@shared/types';

/**
 * Génère les occurrences manquantes pour tous les objectifs récurrents d'un utilisateur.
 * Appelé le 1er de chaque mois à 6h par le scheduler.
 */
export async function generateOccurrences(userId: string, tenantId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId, tenantId },
    select: { objectives: true },
  });

  if (!user || !user.objectives) return 0;

  const objectives = user.objectives as unknown as Objective[];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentQuarter = Math.ceil(currentMonth / 3); // 1-4

  // Templates = objectifs récurrents sans parentObjectiveId
  const templates = objectives.filter(
    (o) => o.recurrence && o.recurrence !== 'none' && !o.parentObjectiveId,
  );

  if (templates.length === 0) return 0;

  let generated = 0;
  const newObjectives: Objective[] = [...objectives];

  for (const template of templates) {
    // Vérifier si la date de fin de récurrence est dépassée
    if (template.recurrenceEndDate) {
      const endDate = new Date(template.recurrenceEndDate);
      if (now > endDate) continue;
    }

    const freq = template.recurrence!;

    if (freq === 'monthly') {
      const exists = objectives.some(
        (o) =>
          o.parentObjectiveId === template.id &&
          o.periodType === 'monthly' &&
          o.month === currentMonth &&
          o.year === currentYear,
      );
      if (!exists) {
        newObjectives.push(buildOccurrence(template, {
          periodType: 'monthly',
          month: currentMonth,
          year: currentYear,
        }));
        generated++;
      }
    } else if (freq === 'quarterly') {
      const exists = objectives.some(
        (o) =>
          o.parentObjectiveId === template.id &&
          o.periodType === 'quarterly' &&
          o.quarter === currentQuarter &&
          o.year === currentYear,
      );
      if (!exists) {
        newObjectives.push(buildOccurrence(template, {
          periodType: 'quarterly',
          quarter: currentQuarter,
          year: currentYear,
        }));
        generated++;
      }
    } else if (freq === 'annual') {
      const exists = objectives.some(
        (o) =>
          o.parentObjectiveId === template.id &&
          o.periodType === 'annual' &&
          o.year === currentYear,
      );
      if (!exists) {
        newObjectives.push(buildOccurrence(template, {
          periodType: 'annual',
          year: currentYear,
        }));
        generated++;
      }
    }
  }

  if (generated > 0) {
    await prisma.user.update({
      where: { id: userId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { objectives: newObjectives as any },
    });
    logger.info('[ObjectiveRecurrence] Occurrences générées', { userId, tenantId, count: generated });
  }

  return generated;
}

/** Construit une occurrence à partir d'un template. */
export function buildOccurrence(
  template: Objective,
  periodOverride: Partial<Pick<Objective, 'periodType' | 'month' | 'quarter' | 'year'>>,
): Objective {
  return {
    ...template,
    id: crypto.randomUUID(),
    parentObjectiveId: template.id,
    recurrence: 'none',
    recurrenceEndDate: undefined,
    periodType: periodOverride.periodType ?? template.periodType,
    month: periodOverride.month,
    quarter: periodOverride.quarter,
    year: periodOverride.year ?? new Date().getFullYear(),
    // Nettoyer les champs custom hérités du template pour éviter que
    // getObjectiveDateRange tombe dans la branche 'custom' par erreur
    startDate: undefined,
    endDate: undefined,
  };
}

/**
 * Lance la génération d'occurrences pour tous les tenants.
 * Appelé par le scheduler le 1er de chaque mois.
 */
export async function generateOccurrencesForAllTenants(): Promise<void> {
  logger.info('[ObjectiveRecurrence] Démarrage génération occurrences récurrentes');

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, tenantId: true },
  });

  let totalGenerated = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const count = await generateOccurrences(user.id, user.tenantId!);
      totalGenerated += count;
    } catch (err) {
      errors++;
      logger.error('[ObjectiveRecurrence] Erreur pour user', { userId: user.id, err });
    }
  }

  logger.info('[ObjectiveRecurrence] Génération terminée', { totalGenerated, errors });
}
