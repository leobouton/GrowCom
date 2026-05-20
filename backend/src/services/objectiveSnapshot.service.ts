import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { objectiveSnapshotRepository } from '../repositories/objectiveSnapshot.repository';
import type { Objective, ObjectiveBonusTier } from '@shared/types';

// ─── Helpers période (sans date-fns) ─────────────────────────

function getObjectiveDateRange(obj: Objective): [Date, Date] | null {
  const y = obj.year ?? new Date().getFullYear();

  if (obj.periodType === 'monthly') {
    const m = (obj.month ?? 1) - 1;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return [start, end];
  }
  if (obj.periodType === 'quarterly') {
    const q = obj.quarter ?? 1;
    const startMonth = (q - 1) * 3;
    const start = new Date(y, startMonth, 1);
    const end = new Date(y, startMonth + 3, 0, 23, 59, 59, 999);
    return [start, end];
  }
  if (obj.periodType === 'annual') {
    return [new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59, 999)];
  }
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return [new Date(obj.startDate), new Date(obj.endDate + 'T23:59:59.999Z')];
  }
  return null;
}

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatObjectivePeriod(obj: Objective): string {
  const y = obj.year ?? new Date().getFullYear();
  if (obj.periodType === 'monthly') return `${MONTHS_FR[(obj.month ?? 1) - 1]} ${y}`;
  if (obj.periodType === 'quarterly') return `T${obj.quarter ?? 1} ${y}`;
  if (obj.periodType === 'annual') return `Année ${y}`;
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    const fmt = (d: string) => {
      const [yy, mm, dd] = d.split('-');
      return `${dd}/${mm}/${yy.slice(2)}`;
    };
    return `${fmt(obj.startDate)} → ${fmt(obj.endDate)}`;
  }
  return 'Période perso.';
}

function isObjectiveEnded(obj: Objective): boolean {
  const range = getObjectiveDateRange(obj);
  if (!range) return false;
  return new Date() > range[1];
}

// ─── Calcul bonus ─────────────────────────────────────────────

function computeBonus(obj: Objective, current: number): number {
  const bonus = obj.bonus ?? { enabled: false, type: 'percentage' as const, value: 0 };
  const pct = obj.target > 0 ? (current / obj.target) * 100 : 0;
  const mode = obj.bonusMode ?? (bonus.enabled ? 'simple' : 'none');

  if (mode === 'none') return 0;

  if (mode === 'tiered' && obj.bonusTiers && obj.bonusTiers.length > 0) {
    const reached = [...obj.bonusTiers]
      .sort((a: ObjectiveBonusTier, b: ObjectiveBonusTier) => b.threshold - a.threshold)
      .find((tier: ObjectiveBonusTier) => pct >= tier.threshold);
    if (!reached) return 0;
    return reached.reward.type === 'fixed'
      ? reached.reward.value
      : current * (reached.reward.value / 100);
  }

  if (!bonus.enabled || current <= obj.target) return 0;
  const excess = current - obj.target;
  return bonus.type === 'percentage' ? excess * (bonus.value / 100) : bonus.value;
}

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

  // Récupérer les deals WON de ce user (assignés à lui)
  const wonDeals = await prisma.deal.findMany({
    where: { tenantId, assignedToId: userId, status: 'WON' },
    select: { amount: true, closedAt: true, syncedAt: true },
  });

  let created = 0;

  for (const obj of ended) {
    const periodLabel = formatObjectivePeriod(obj);
    const alreadyExists = await objectiveSnapshotRepository.existsForPeriod(
      userId, tenantId, obj.id, periodLabel,
    );
    if (alreadyExists) continue;

    const range = getObjectiveDateRange(obj);
    let actualValue = 0;

    if (range) {
      const [start, end] = range;
      const filtered = wonDeals.filter((d) => {
        const dateStr = d.closedAt ?? d.syncedAt;
        const t = dateStr.getTime();
        return t >= start.getTime() && t <= end.getTime();
      });
      actualValue = obj.unit === 'deals'
        ? filtered.length
        : filtered.reduce((sum, d) => sum + d.amount, 0);
    } else {
      actualValue = obj.unit === 'deals'
        ? wonDeals.length
        : wonDeals.reduce((sum, d) => sum + d.amount, 0);
    }

    const bonusEarned = computeBonus(obj, actualValue);

    await objectiveSnapshotRepository.create({
      tenantId,
      userId,
      objectiveId: obj.id,
      periodLabel,
      snapshotData: obj as unknown as Record<string, unknown>,
      actualValue,
      bonusEarned,
    });
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
