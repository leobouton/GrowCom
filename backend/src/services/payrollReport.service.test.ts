/**
 * payrollReport.service.test.ts
 * Tests unitaires — logique d'inclusion / exclusion des commissions dans la paie
 * et cohérence avec la requête de verrouillage (transition d'état).
 */

import { describe, it, expect } from 'vitest';
import { CommissionStatus } from '@prisma/client';
import {
  classifyCommissionForPayroll,
  type PayrollDecisionInput,
} from './payrollReport.service';
import { buildPayrollIncludedWhere } from '../repositories/commission.repository';

// Période de test : mai 2026
const PERIOD_START = new Date(2026, 4, 1); // 1er mai 2026
const PERIOD_END = new Date(2026, 4, 31, 23, 59, 59); // 31 mai 2026

const inMay = new Date(2026, 4, 15);
const inApril = new Date(2026, 3, 15);
const inJune = new Date(2026, 5, 15);

function makeCommission(overrides: Partial<PayrollDecisionInput>): PayrollDecisionInput {
  return {
    status: CommissionStatus.VALIDATED,
    scheduledPaymentAt: inMay,
    validatedAt: inMay,
    calculatedAt: inMay,
    awaitingClientPayment: false,
    clientPaidAt: null,
    hasOpenDispute: false,
    ...overrides,
  };
}

describe('classifyCommissionForPayroll — inclusion', () => {
  it('inclut une commission VALIDATED, payable, sans litige, rattachée à la période', () => {
    const c = makeCommission({ scheduledPaymentAt: inMay });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('INCLUDED');
  });

  it('utilise validatedAt en fallback quand scheduledPaymentAt est null', () => {
    const c = makeCommission({ scheduledPaymentAt: null, validatedAt: inMay });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('INCLUDED');
  });

  it('inclut si awaitingClientPayment mais clientPaidAt renseigné', () => {
    const c = makeCommission({ awaitingClientPayment: true, clientPaidAt: inMay });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('INCLUDED');
  });
});

describe('classifyCommissionForPayroll — exclusion', () => {
  it('exclut (PENDING) une commission non validée rattachée à la période', () => {
    const c = makeCommission({
      status: CommissionStatus.PENDING,
      scheduledPaymentAt: null,
      validatedAt: null,
      calculatedAt: inMay,
    });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('PENDING');
  });

  it('exclut (AWAITING_CLIENT_PAYMENT) si en attente de paiement client', () => {
    const c = makeCommission({ awaitingClientPayment: true, clientPaidAt: null });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('AWAITING_CLIENT_PAYMENT');
  });

  it('exclut (DISPUTED) si litige ouvert, même validée et payable', () => {
    const c = makeCommission({ hasOpenDispute: true });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('DISPUTED');
  });

  it('priorité au litige sur le statut PENDING', () => {
    const c = makeCommission({ status: CommissionStatus.PENDING, hasOpenDispute: true });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('DISPUTED');
  });
});

describe('classifyCommissionForPayroll — rattachement de période', () => {
  it('ignore une commission rattachée à un mois antérieur', () => {
    const c = makeCommission({ scheduledPaymentAt: inApril, validatedAt: inApril });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('IGNORED');
  });

  it('ignore une commission validée mais planifiée pour un mois futur (différée)', () => {
    // validatedAt en mai mais paiement prévu en juin → rattachée à juin
    const c = makeCommission({ scheduledPaymentAt: inJune, validatedAt: inMay });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('IGNORED');
  });

  it('inclut sur le bord supérieur de la période (dernier jour)', () => {
    const lastDay = new Date(2026, 4, 31, 12, 0, 0);
    const c = makeCommission({ scheduledPaymentAt: lastDay, validatedAt: lastDay });
    expect(classifyCommissionForPayroll(c, PERIOD_START, PERIOD_END)).toBe('INCLUDED');
  });
});

describe('buildPayrollIncludedWhere — règles d\'inclusion au niveau base', () => {
  const where = buildPayrollIncludedWhere(['u1', 'u2'], 'tenant-1', PERIOD_START, PERIOD_END);

  it('cible le bon tenant et les bons utilisateurs', () => {
    expect(where.tenantId).toBe('tenant-1');
    expect(where.userId).toEqual({ in: ['u1', 'u2'] });
  });

  it('ne retient que le statut VALIDATED', () => {
    expect(where.status).toBe(CommissionStatus.VALIDATED);
  });

  it('exige la condition de paiement client (awaitingClientPayment false OU clientPaidAt renseigné)', () => {
    const paymentClause = (where.AND as Array<Record<string, unknown>>)[0];
    expect(paymentClause).toEqual({
      OR: [{ awaitingClientPayment: false }, { clientPaidAt: { not: null } }],
    });
  });

  it('exclut tout litige ouvert', () => {
    const disputeClause = (where.AND as Array<Record<string, unknown>>)[2];
    expect(disputeClause).toEqual({ disputes: { none: { status: 'OPEN' } } });
  });

  it('rattache via scheduledPaymentAt avec fallback validatedAt', () => {
    const dateClause = (where.AND as Array<Record<string, unknown>>)[1] as { OR: unknown[] };
    expect(dateClause.OR).toEqual([
      { scheduledPaymentAt: { gte: PERIOD_START, lte: PERIOD_END } },
      { scheduledPaymentAt: null, validatedAt: { gte: PERIOD_START, lte: PERIOD_END } },
    ]);
  });
});
