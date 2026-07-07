import { Commission, CommissionStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Valeur sentinelle de periodMonth pour les commissions one-shot (deal WON).
 * Permet une contrainte unique (dealId, userId, ruleId, periodMonth) fiable sans NULL.
 * Les commissions de mission portent leur vrai 1er jour de mois.
 */
export const PERIOD_MONTH_SENTINEL = new Date('1970-01-01T00:00:00.000Z');

export interface CommissionWithRelations extends Commission {
  deal: { title: string; clientName: string | null; amount: number; status: string; closedAt: Date | null };
  rule: { name: string; config: unknown; paymentDelayDays: number | null };
  user: { firstName: string; lastName: string; email: string };
}

export interface PayrollCommissionRow extends Commission {
  deal: { title: string; clientName: string | null; amount: number };
  rule: { name: string };
  user: { firstName: string; lastName: string; email: string };
  disputes: { id: string }[];
}

/**
 * Règles d'inclusion d'une commission dans une période de paie P (strictes) :
 *   1. status === VALIDATED
 *   2. condition de paiement levée : awaitingClientPayment === false OU clientPaidAt !== null
 *   3. date de rattachement (scheduledPaymentAt, fallback validatedAt) dans P
 *   4. aucun litige au statut OPEN
 *
 * Exporté pour être réutilisé à l'identique par la requête de lecture ET par
 * le verrouillage (updateMany VALIDATED → PAID), afin qu'on fige exactement ce
 * qui a été prévisualisé.
 */
export function buildPayrollIncludedWhere(
  userIds: string[],
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
): Prisma.CommissionWhereInput {
  return {
    tenantId,
    userId: { in: userIds },
    status: CommissionStatus.VALIDATED,
    AND: [
      { OR: [{ awaitingClientPayment: false }, { clientPaidAt: { not: null } }] },
      {
        OR: [
          { scheduledPaymentAt: { gte: periodStart, lte: periodEnd } },
          { scheduledPaymentAt: null, validatedAt: { gte: periodStart, lte: periodEnd } },
        ],
      },
      { disputes: { none: { status: 'OPEN' } } },
    ],
  };
}

export const commissionRepository = {
  async findById(id: string, tenantId: string): Promise<CommissionWithRelations | null> {
    return prisma.commission.findFirst({
      where: { id, tenantId },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    }) as Promise<CommissionWithRelations | null>;
  },

  async findByTenantId(tenantId: string): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: { tenantId },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findByUserIds(userIds: string[], tenantId: string): Promise<CommissionWithRelations[]> {
    if (userIds.length === 0) return [];
    return prisma.commission.findMany({
      where: { userId: { in: userIds }, tenantId },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findPendingByUserIds(userIds: string[], tenantId: string): Promise<CommissionWithRelations[]> {
    if (userIds.length === 0) return [];
    return prisma.commission.findMany({
      where: { userId: { in: userIds }, tenantId, status: CommissionStatus.PENDING },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findByUserId(userId: string, tenantId: string): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: { userId, tenantId },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findPendingByTenantId(tenantId: string): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: { tenantId, status: CommissionStatus.PENDING },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async create(data: {
    tenantId: string;
    userId: string;
    dealId: string;
    ruleId: string;
    amount: number;
  }): Promise<Commission> {
    return prisma.commission.create({ data });
  },

  async updateStatus(
    id: string,
    status: CommissionStatus,
    tenantId: string,
  ): Promise<Commission> {
    return prisma.commission.update({
      where: { id, tenantId },
      data: {
        status,
        ...(status === CommissionStatus.VALIDATED ? { validatedAt: new Date() } : {}),
        // Quand on passe directement à PAID (validated = paid), on renseigne les deux dates
        ...(status === CommissionStatus.PAID ? { validatedAt: new Date(), paidAt: new Date() } : {}),
      },
    });
  },

  async sumByUserAndMonth(
    userId: string,
    tenantId: string,
    startOfMonth: Date,
    endOfMonth: Date,
  ): Promise<number> {
    // Utilise validatedAt comme date effective : une commission différée validée en avril
    // apparaît dans les gains d'avril, pas dans ceux de janvier (date de la vente).
    // Repli sur paidAt si validatedAt est absent (imports, scripts) pour ne jamais
    // perdre une commission payée dans le total.
    const result = await prisma.commission.aggregate({
      where: {
        userId,
        tenantId,
        status: { in: [CommissionStatus.VALIDATED, CommissionStatus.PAID] },
        OR: [
          { validatedAt: { gte: startOfMonth, lte: endOfMonth } },
          { validatedAt: null, paidAt: { gte: startOfMonth, lte: endOfMonth } },
        ],
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  },

  async findByUserIdsInPeriod(
    userIds: string[],
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<CommissionWithRelations[]> {
    if (userIds.length === 0) return [];
    // Inclure les commissions validées dans la période OU les commissions PENDING
    // créées (calculatedAt) dans la période (pour qu'elles apparaissent dans le classement
    // même avant validation manager)
    return prisma.commission.findMany({
      where: {
        userId: { in: userIds },
        tenantId,
        OR: [
          { validatedAt: { gte: startDate, lte: endDate } },
          { validatedAt: null, calculatedAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async findByUserIdInPeriod(
    userId: string,
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<CommissionWithRelations[]> {
    return prisma.commission.findMany({
      where: {
        userId,
        tenantId,
        calculatedAt: { gte: startDate, lte: endDate },
      },
      include: {
        deal: { select: { title: true, clientName: true, amount: true, status: true, closedAt: true } },
        rule: { select: { name: true, config: true, paymentDelayDays: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<CommissionWithRelations[]>;
  },

  async getManagerStats(tenantId: string): Promise<{
    totalPending: number;
    totalValidated: number;
    totalPaid: number;
  }> {
    const [pending, validated, paid] = await Promise.all([
      prisma.commission.aggregate({
        where: { tenantId, status: CommissionStatus.PENDING },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: { tenantId, status: CommissionStatus.VALIDATED },
        _sum: { amount: true },
      }),
      prisma.commission.aggregate({
        where: { tenantId, status: CommissionStatus.PAID },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalPending: pending._sum.amount ?? 0,
      totalValidated: validated._sum.amount ?? 0,
      totalPaid: paid._sum.amount ?? 0,
    };
  },

  async upsertForDeal(
    tenantId: string,
    userId: string,
    dealId: string,
    ruleId: string,
    amount: number,
    calculationDetail?: string,
    scheduledPaymentAt?: Date | null,
    awaitingClientPayment?: boolean,
  ): Promise<Commission> {
    // Upsert manuel : la clé unique Prisma inclut désormais missionId (nullable),
    // inutilisable pour une commission de deal (missionId NULL). L'unicité BDD des
    // deals one-shot est garantie par l'index partiel Commission_deal_oneshot_key.
    const existing = await prisma.commission.findFirst({
      where: { dealId, userId, ruleId, missionId: null, periodMonth: PERIOD_MONTH_SENTINEL },
      select: { id: true },
    });
    if (existing) {
      return prisma.commission.update({
        where: { id: existing.id },
        data: {
          amount,
          calculatedAt: new Date(),
          calculationDetail: calculationDetail ?? null,
          scheduledPaymentAt: scheduledPaymentAt ?? null,
          awaitingClientPayment: awaitingClientPayment ?? false,
        },
      });
    }
    return prisma.commission.create({
      data: {
        tenantId, userId, dealId, ruleId, amount,
        periodMonth: PERIOD_MONTH_SENTINEL,
        calculationDetail: calculationDetail ?? null,
        scheduledPaymentAt: scheduledPaymentAt ?? null,
        awaitingClientPayment: awaitingClientPayment ?? false,
      },
    });
  },

  /**
   * Upsert idempotent d'une commission de mission pour un mois donné.
   * Clé unique (dealId, userId, ruleId, missionId, periodMonth) → une commission
   * PAR MISSION et par mois : un commercial avec plusieurs consultants placés
   * (plusieurs missions sur le même contrat) touche bien une ligne par consultant.
   * Ne touche pas au statut d'une commission déjà validée/payée.
   */
  /**
   * Upsert d'une commission mensuelle de mission — VALIDATION AUTOMATIQUE :
   * l'appelant (job de récurrence / sync CRM) ne génère que pour des missions
   * ACTIVES côté CRM. La mission tourne = la commission est due, pas de
   * validation manager. Une commission PENDING existante est promue VALIDATED ;
   * PAID et CANCELLED ne sont jamais touchées.
   */
  async upsertForMissionMonth(params: {
    tenantId: string;
    userId: string;
    dealId: string;
    ruleId: string;
    missionId: string;
    eventId: string;
    periodMonth: Date;
    amount: number;
    calculationDetail: string;
  }): Promise<Commission> {
    const { tenantId, userId, dealId, ruleId, missionId, eventId, periodMonth, amount, calculationDetail } = params;
    const now = new Date();
    const commission = await prisma.commission.upsert({
      where: {
        dealId_userId_ruleId_missionId_periodMonth: { dealId, userId, ruleId, missionId, periodMonth },
      },
      update: {
        amount,
        calculationDetail,
        calculatedAt: now,
        eventId,
        missionId,
      },
      create: {
        tenantId, userId, dealId, ruleId, missionId, eventId, periodMonth, amount, calculationDetail,
        status: CommissionStatus.VALIDATED,
        validatedAt: now,
      },
    });
    if (commission.status === CommissionStatus.PENDING) {
      return prisma.commission.update({
        where: { id: commission.id },
        data: { status: CommissionStatus.VALIDATED, validatedAt: now },
      });
    }
    return commission;
  },

  async updateAmountAndDetail(
    id: string,
    tenantId: string,
    amount: number,
    calculationDetail: string,
  ): Promise<Commission> {
    return prisma.commission.update({
      where: { id, tenantId },
      data: { amount, calculationDetail, calculatedAt: new Date() },
    });
  },

  async markClientPaid(
    id: string,
    tenantId: string,
    managerId: string,
    paymentDelayDays?: number | null,
  ): Promise<Commission> {
    const now = new Date();

    if (paymentDelayDays && paymentDelayDays > 0) {
      // Délai configuré → PENDING avec scheduledPaymentAt (validation auto via cron)
      const scheduledPaymentAt = new Date(now);
      scheduledPaymentAt.setDate(scheduledPaymentAt.getDate() + paymentDelayDays);
      return prisma.commission.update({
        where: { id, tenantId },
        data: {
          awaitingClientPayment: false,
          clientPaidAt: now,
          clientPaidBy: managerId,
          scheduledPaymentAt,
        },
      });
    }

    // Pas de délai → validation directe
    return prisma.commission.update({
      where: { id, tenantId },
      data: {
        awaitingClientPayment: false,
        clientPaidAt: now,
        clientPaidBy: managerId,
        status: 'VALIDATED',
        validatedAt: now,
      },
    });
  },

  /**
   * Commissions INCLUSES dans la paie de la période (règles strictes).
   * Utilisé pour construire le rapport et le total variable.
   */
  async findPayrollIncluded(
    userIds: string[],
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<PayrollCommissionRow[]> {
    if (userIds.length === 0) return [];
    return prisma.commission.findMany({
      where: buildPayrollIncludedWhere(userIds, tenantId, periodStart, periodEnd),
      include: {
        deal: { select: { title: true, clientName: true, amount: true } },
        rule: { select: { name: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
        disputes: { where: { status: 'OPEN' }, select: { id: true } },
      },
      orderBy: { scheduledPaymentAt: 'asc' },
    }) as Promise<PayrollCommissionRow[]>;
  },

  /**
   * Commissions présentes sur la période mais EXCLUES de la paie, pour transparence :
   * - PENDING (calculées/planifiées sur la période, non encore validées)
   * - VALIDATED mais en attente de paiement client
   * - en litige OPEN
   * On sur-fetch (date sur scheduledPaymentAt / validatedAt / calculatedAt) puis le
   * service classe précisément la raison d'exclusion.
   */
  async findPayrollExcludedCandidates(
    userIds: string[],
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<PayrollCommissionRow[]> {
    if (userIds.length === 0) return [];
    return prisma.commission.findMany({
      where: {
        tenantId,
        userId: { in: userIds },
        status: { in: [CommissionStatus.PENDING, CommissionStatus.VALIDATED] },
        OR: [
          { scheduledPaymentAt: { gte: periodStart, lte: periodEnd } },
          { validatedAt: { gte: periodStart, lte: periodEnd } },
          { calculatedAt: { gte: periodStart, lte: periodEnd } },
        ],
      },
      include: {
        deal: { select: { title: true, clientName: true, amount: true } },
        rule: { select: { name: true } },
        user: { select: { firstName: true, lastName: true, email: true } },
        disputes: { where: { status: 'OPEN' }, select: { id: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    }) as Promise<PayrollCommissionRow[]>;
  },

  async delete(id: string, tenantId: string): Promise<void> {
    // Verification du tenant avant suppression (id est le seul champ unique)
    const commission = await prisma.commission.findFirst({ where: { id, tenantId } });
    if (!commission) throw new Error('Commission introuvable');
    await prisma.commission.delete({ where: { id } });
  },

  /** Commissions récurrentes (issues de missions) d'un tenant, du mois le plus récent au plus ancien. */
  async findRecurringByTenantId(tenantId: string): Promise<Array<Commission & {
    deal: { title: string; clientName: string | null };
    rule: { name: string };
  }>> {
    return prisma.commission.findMany({
      where: { tenantId, missionId: { not: null } },
      include: {
        deal: { select: { title: true, clientName: true } },
        rule: { select: { name: true } },
      },
      orderBy: [{ periodMonth: 'desc' }, { calculatedAt: 'desc' }],
    });
  },

  /** Commissions récurrentes d'un commercial (pour ses projections/stats). */
  async findRecurringByUserId(userId: string, tenantId: string): Promise<Array<Commission & {
    deal: { title: string; clientName: string | null };
    rule: { name: string };
  }>> {
    return prisma.commission.findMany({
      where: { tenantId, userId, missionId: { not: null } },
      include: {
        deal: { select: { title: true, clientName: true } },
        rule: { select: { name: true } },
      },
      orderBy: [{ periodMonth: 'desc' }, { calculatedAt: 'desc' }],
    });
  },
};
