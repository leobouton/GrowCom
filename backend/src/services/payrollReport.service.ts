/**
 * Service du rapport de paie (éléments variables BRUTS).
 *
 * Principe : GrowCom ne calcule PAS la paie nette (pas de charges, pas de DSN).
 * Il produit les éléments variables bruts par commercial pour une période, prêts
 * à être transmis à un logiciel de paie externe (PayFit, Lucca, Silae).
 *
 * Règles d'inclusion d'une commission dans une période P (strictes) :
 *   1. status === VALIDATED
 *   2. condition de paiement levée : awaitingClientPayment === false OU clientPaidAt !== null
 *   3. date de rattachement (scheduledPaymentAt, fallback validatedAt) dans P
 *   4. aucun litige au statut OPEN
 *
 * Verrouillage : une fois la période figée, les commissions incluses passent en PAID
 * (paidAt = clôture de période). Un recalcul rétroactif ne modifie plus une période figée.
 */
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { prisma } from '../config/prisma';
import {
  commissionRepository,
  buildPayrollIncludedWhere,
  type PayrollCommissionRow,
} from '../repositories/commission.repository';
import { commissionAdjustmentRepository } from '../repositories/commissionAdjustment.repository';
import { objectiveSnapshotRepository } from '../repositories/objectiveSnapshot.repository';
import { payrollPeriodRepository } from '../repositories/payrollPeriod.repository';
import { resolveTeamScope } from './commission.service';
import { AppError } from '../middlewares/errorHandler';
import { UserRole } from '../../../shared/types';
import type {
  PayrollReportPreview,
  PayrollReportPreviewItem,
  PayrollExcludedCommission,
  PayrollExclusionReason,
  PayrollLockInfo,
  PayrollPeriodHistoryItem,
} from '../../../shared/types';
import { CommissionStatus as PrismaCommissionStatus, UserRole as PrismaUserRole } from '@prisma/client';

// ─── Constantes ───────────────────────────────────────────────

/** Rôles considérés comme "commerciaux" éligibles à une fiche de paie variable. */
const ELIGIBLE_ROLES = [
  PrismaUserRole.COMMERCIAL,
  PrismaUserRole.RECRUITER,
  PrismaUserRole.TEAM_LEAD,
  PrismaUserRole.BU_MANAGER,
] as const;

const ROLE_LABELS: Record<string, string> = {
  COMMERCIAL: 'Commercial',
  TEAM_LEAD: 'Responsable de secteur',
  BU_MANAGER: 'Manager BU',
  MANAGER: 'Manager',
  RECRUITER: 'Recruteur',
};

const EXCLUSION_LABELS: Record<PayrollExclusionReason, string> = {
  PENDING: 'En attente de validation',
  AWAITING_CLIENT_PAYMENT: 'En attente du paiement client',
  DISPUTED: 'Litige en cours',
};

// ─── Helpers de formatage ─────────────────────────────────────

function formatEuro(amount: number): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const parts = abs.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${intPart},${parts[1]} EUR`;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  const day = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  return `${day}/${m}/${dt.getFullYear()}`;
}

function formatPeriod(start: Date, end: Date): string {
  return `${formatDate(start)} au ${formatDate(end)}`;
}

const MONTH_NAMES = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
];

function formatGenDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Étiquette de période stable pour les exports (ex : "2026-05"). */
function periodKey(periodStart: Date): string {
  return `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 2) + '..';
}

function monthsBetween(periodStart: Date, periodEnd: Date): number {
  return Math.max(
    1,
    (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 +
      (periodEnd.getMonth() - periodStart.getMonth()) + 1,
  );
}

// ─── Types internes ───────────────────────────────────────────

interface EligibleUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  fixedSalary: number;
}

interface CommissionLine {
  commissionId: string;
  dealTitle: string;
  clientName: string | null;
  dealAmount: number;
  amount: number;
  ruleName: string;
  scheduledPaymentAt: Date | null;
  validatedAt: Date | null;
}

interface AdjustmentLine {
  adjustmentId: string;
  reason: string;
  amount: number;
  createdAt: Date;
}

interface UserReportData {
  user: EligibleUser;
  fixedSalaryTotal: number;
  monthsInPeriod: number;
  commissions: CommissionLine[];
  adjustments: AdjustmentLine[];
  commissionsTotal: number;
  adjustmentsTotal: number;
  bonusTotal: number;
  variableTotal: number;
  netTotal: number;
}

interface ReportData {
  users: UserReportData[];
  excluded: PayrollExcludedCommission[];
  monthsInPeriod: number;
}

// ─── Résolution du périmètre ──────────────────────────────────

/**
 * Renvoie les utilisateurs éligibles dans le périmètre du demandeur.
 * Si `requestedUserIds` est fourni, on restreint à cette sélection (toujours dans le scope).
 */
async function resolveEligibleUsers(
  tenantId: string,
  callerId: string,
  callerRole: UserRole,
  requestedUserIds?: string[],
): Promise<EligibleUser[]> {
  const teamIds = await resolveTeamScope(callerId, callerRole, tenantId);

  const users = await prisma.user.findMany({
    where: {
      tenantId,
      isActive: true,
      role: { in: [...ELIGIBLE_ROLES] },
      ...(teamIds !== null ? { id: { in: teamIds } } : {}),
      ...(requestedUserIds && requestedUserIds.length > 0
        ? { id: teamIds !== null ? { in: teamIds.filter((id) => requestedUserIds.includes(id)) } : { in: requestedUserIds } }
        : {}),
    },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, fixedSalary: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  return users;
}

// ─── Logique d'inclusion / exclusion (pure, testable) ────────

/** Champs minimaux d'une commission nécessaires à la décision d'inclusion. */
export interface PayrollDecisionInput {
  status: string;
  scheduledPaymentAt: Date | null;
  validatedAt: Date | null;
  calculatedAt: Date;
  awaitingClientPayment: boolean;
  clientPaidAt: Date | null;
  hasOpenDispute: boolean;
}

export type PayrollDecision = 'INCLUDED' | PayrollExclusionReason | 'IGNORED';

/**
 * Décide du sort d'une commission pour la paie d'une période (logique miroir de
 * `buildPayrollIncludedWhere` côté base) :
 * - INCLUDED : part à la paie
 * - PENDING / AWAITING_CLIENT_PAYMENT / DISPUTED : exclue, à afficher pour transparence
 * - IGNORED : hors période ou non pertinente (ne rien afficher)
 */
export function classifyCommissionForPayroll(
  c: PayrollDecisionInput,
  periodStart: Date,
  periodEnd: Date,
): PayrollDecision {
  // Date de rattachement : scheduledPaymentAt, sinon validatedAt, sinon calculatedAt (PENDING).
  const attachDate = c.scheduledPaymentAt ?? c.validatedAt ?? c.calculatedAt;
  const inPeriod = attachDate >= periodStart && attachDate <= periodEnd;
  if (!inPeriod) return 'IGNORED';

  if (c.hasOpenDispute) return 'DISPUTED';
  if (c.status === PrismaCommissionStatus.PENDING) return 'PENDING';

  if (c.status === PrismaCommissionStatus.VALIDATED) {
    const paymentLifted = !c.awaitingClientPayment || c.clientPaidAt !== null;
    if (!paymentLifted) return 'AWAITING_CLIENT_PAYMENT';
    // Pour l'inclusion, on s'appuie sur scheduledPaymentAt (fallback validatedAt),
    // pas calculatedAt : une commission validée sans date de rattachement dans la
    // période est ignorée (rattachée à une autre période).
    const includeDate = c.scheduledPaymentAt ?? c.validatedAt;
    if (includeDate && includeDate >= periodStart && includeDate <= periodEnd) return 'INCLUDED';
    return 'IGNORED';
  }

  return 'IGNORED';
}

// ─── Collecte des données du rapport ──────────────────────────

async function collectReportData(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  users: EligibleUser[],
): Promise<ReportData> {
  const monthsInPeriod = monthsBetween(periodStart, periodEnd);
  const userIds = users.map((u) => u.id);

  if (userIds.length === 0) {
    return { users: [], excluded: [], monthsInPeriod };
  }

  const [included, excludedCandidates, adjustments, snapshots] = await Promise.all([
    commissionRepository.findPayrollIncluded(userIds, tenantId, periodStart, periodEnd),
    commissionRepository.findPayrollExcludedCandidates(userIds, tenantId, periodStart, periodEnd),
    commissionAdjustmentRepository.findUnpaidByUserIdsInPeriod(userIds, tenantId, periodStart, periodEnd),
    objectiveSnapshotRepository.findByUserIdsInPeriod(userIds, tenantId, periodStart, periodEnd),
  ]);

  // Regroupement par commercial
  const includedByUser = new Map<string, PayrollCommissionRow[]>();
  for (const c of included) {
    const arr = includedByUser.get(c.userId) ?? [];
    arr.push(c);
    includedByUser.set(c.userId, arr);
  }

  const adjustmentsByUser = new Map<string, AdjustmentLine[]>();
  for (const a of adjustments) {
    const arr = adjustmentsByUser.get(a.userId) ?? [];
    arr.push({ adjustmentId: a.id, reason: a.reason, amount: a.amount, createdAt: a.createdAt });
    adjustmentsByUser.set(a.userId, arr);
  }

  const bonusByUser = new Map<string, number>();
  for (const s of snapshots) {
    bonusByUser.set(s.userId, (bonusByUser.get(s.userId) ?? 0) + s.bonusEarned);
  }

  // IDs des commissions incluses, pour ne pas les reclasser comme "exclues"
  const includedIds = new Set(included.map((c) => c.id));

  const userReports: UserReportData[] = users.map((user) => {
    const commissions: CommissionLine[] = (includedByUser.get(user.id) ?? []).map((c) => ({
      commissionId: c.id,
      dealTitle: c.deal.title,
      clientName: c.deal.clientName,
      dealAmount: c.deal.amount,
      amount: c.amount,
      ruleName: c.rule.name,
      scheduledPaymentAt: c.scheduledPaymentAt,
      validatedAt: c.validatedAt,
    }));
    const userAdjustments = adjustmentsByUser.get(user.id) ?? [];

    const commissionsTotal = commissions.reduce((s, c) => s + c.amount, 0);
    const adjustmentsTotal = userAdjustments.reduce((s, a) => s + a.amount, 0);
    const bonusTotal = bonusByUser.get(user.id) ?? 0;
    const variableTotal = commissionsTotal + adjustmentsTotal + bonusTotal;
    const fixedSalaryTotal = user.fixedSalary * monthsInPeriod;

    return {
      user,
      fixedSalaryTotal,
      monthsInPeriod,
      commissions,
      adjustments: userAdjustments,
      commissionsTotal,
      adjustmentsTotal,
      bonusTotal,
      variableTotal,
      netTotal: fixedSalaryTotal + variableTotal,
    };
  });

  // Classement des commissions exclues (transparence)
  const userById = new Map(users.map((u) => [u.id, u]));
  const excluded: PayrollExcludedCommission[] = [];
  for (const c of excludedCandidates) {
    if (includedIds.has(c.id)) continue; // déjà incluse

    const decision = classifyCommissionForPayroll(
      {
        status: c.status,
        scheduledPaymentAt: c.scheduledPaymentAt,
        validatedAt: c.validatedAt,
        calculatedAt: c.calculatedAt,
        awaitingClientPayment: c.awaitingClientPayment,
        clientPaidAt: c.clientPaidAt,
        hasOpenDispute: c.disputes.length > 0,
      },
      periodStart,
      periodEnd,
    );
    if (decision === 'INCLUDED' || decision === 'IGNORED') continue;
    const reason: PayrollExclusionReason = decision;

    const u = userById.get(c.userId);
    excluded.push({
      commissionId: c.id,
      userId: c.userId,
      user: u
        ? { firstName: u.firstName, lastName: u.lastName, email: u.email }
        : { firstName: c.user.firstName, lastName: c.user.lastName, email: c.user.email },
      dealTitle: c.deal.title,
      clientName: c.deal.clientName,
      amount: c.amount,
      status: c.status,
      reason,
      reasonLabel: EXCLUSION_LABELS[reason],
    });
  }

  return { users: userReports, excluded, monthsInPeriod };
}

/** Construit l'info de verrouillage (avec nom du manager) si la période est figée. */
async function getLockInfo(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<PayrollLockInfo | null> {
  const lock = await payrollPeriodRepository.findForPeriod(tenantId, periodStart, periodEnd);
  if (!lock) return null;

  const author = await prisma.user.findUnique({
    where: { id: lock.generatedBy },
    select: { firstName: true, lastName: true },
  });

  return {
    lockedAt: lock.generatedAt.toISOString(),
    lockedBy: lock.generatedBy,
    lockedByName: author ? `${author.firstName} ${author.lastName}` : null,
    totalAmount: lock.totalAmount,
    userCount: lock.userCount,
  };
}

// ─── Preview (JSON) ───────────────────────────────────────────

export async function buildPayrollReport(params: {
  tenantId: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
  userIds?: string[];
}): Promise<PayrollReportPreview> {
  const { tenantId, callerId, callerRole, periodStart, periodEnd, userIds } = params;

  const users = await resolveEligibleUsers(tenantId, callerId, callerRole, userIds);
  const data = await collectReportData(tenantId, periodStart, periodEnd, users);
  const locked = await getLockInfo(tenantId, periodStart, periodEnd);

  const items: PayrollReportPreviewItem[] = data.users.map((d) => ({
    userId: d.user.id,
    user: { firstName: d.user.firstName, lastName: d.user.lastName, email: d.user.email },
    role: d.user.role,
    fixedSalaryTotal: d.fixedSalaryTotal,
    commissionsTotal: d.commissionsTotal,
    adjustmentsTotal: d.adjustmentsTotal,
    bonusTotal: d.bonusTotal,
    variableTotal: d.variableTotal,
    netTotal: d.netTotal,
    commissions: d.commissions.map((c) => ({
      commissionId: c.commissionId,
      dealTitle: c.dealTitle,
      clientName: c.clientName,
      dealAmount: c.dealAmount,
      amount: c.amount,
      ruleName: c.ruleName,
      scheduledPaymentAt: c.scheduledPaymentAt ? c.scheduledPaymentAt.toISOString() : null,
      validatedAt: c.validatedAt ? c.validatedAt.toISOString() : null,
    })),
    adjustments: d.adjustments.map((a) => ({
      adjustmentId: a.adjustmentId,
      reason: a.reason,
      amount: a.amount,
      createdAt: a.createdAt.toISOString(),
    })),
  }));

  const grandTotal = items.reduce((s, i) => s + i.netTotal, 0);
  const variableGrandTotal = items.reduce((s, i) => s + i.variableTotal, 0);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    items,
    excluded: data.excluded,
    grandTotal,
    variableGrandTotal,
    locked,
  };
}

// ─── Verrouillage de période ──────────────────────────────────

export async function lockPayrollPeriod(params: {
  tenantId: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
}): Promise<PayrollLockInfo> {
  const { tenantId, callerId, callerRole, periodStart, periodEnd } = params;

  // Le verrouillage fige la période pour TOUT le périmètre (jamais un sous-ensemble choisi).
  // Réservé aux rôles à scope tenant complet.
  if (callerRole !== UserRole.MANAGER && callerRole !== UserRole.SUPER_ADMIN) {
    throw new AppError(403, 'FORBIDDEN', 'Seul un manager peut figer une période de paie');
  }

  // Période déjà figée ?
  const existing = await payrollPeriodRepository.findForPeriod(tenantId, periodStart, periodEnd);
  if (existing) {
    throw new AppError(
      409,
      'PERIOD_ALREADY_LOCKED',
      `Cette période est déjà verrouillée (le ${formatDate(existing.generatedAt)}). Un recalcul donnera lieu à une régularisation sur la période suivante.`,
    );
  }

  const users = await resolveEligibleUsers(tenantId, callerId, callerRole);
  const data = await collectReportData(tenantId, periodStart, periodEnd, users);

  const userIds = users.map((u) => u.id);
  const totalAmount = data.users.reduce((s, u) => s + u.variableTotal, 0);
  const userCount = data.users.filter((u) => u.variableTotal !== 0).length;
  const closeDate = periodEnd; // date de clôture de période

  await prisma.$transaction(async (tx) => {
    // 1. Commissions incluses : VALIDATED → PAID
    await tx.commission.updateMany({
      where: buildPayrollIncludedWhere(userIds, tenantId, periodStart, periodEnd),
      data: { status: PrismaCommissionStatus.PAID, paidAt: closeDate },
    });

    // 2. Ajustements inclus : paidAt = clôture
    await tx.commissionAdjustment.updateMany({
      where: {
        userId: { in: userIds },
        tenantId,
        paidAt: null,
        createdAt: { gte: periodStart, lte: periodEnd },
        NOT: { createdBy: 'SYSTEM', reason: { startsWith: 'Prime objectif' } },
      },
      data: { paidAt: closeDate },
    });

    // 3. Enregistrement du verrouillage
    await tx.payrollPeriod.create({
      data: {
        tenantId,
        periodStart,
        periodEnd,
        status: 'LOCKED',
        generatedBy: callerId,
        totalAmount,
        userCount,
      },
    });

    // 4. Audit
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: callerId,
        action: 'PAYROLL_REPORT_GENERATED',
        entity: 'PayrollPeriod',
        entityId: `${periodStart.toISOString()}_${periodEnd.toISOString()}`,
        metadata: {
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          userCount,
          totalAmount,
        },
      },
    });
  });

  const author = await prisma.user.findUnique({
    where: { id: callerId },
    select: { firstName: true, lastName: true },
  });

  return {
    lockedAt: new Date().toISOString(),
    lockedBy: callerId,
    lockedByName: author ? `${author.firstName} ${author.lastName}` : null,
    totalAmount,
    userCount,
  };
}

// ─── Historique des périodes figées ───────────────────────────

export async function getPayrollHistory(tenantId: string): Promise<PayrollPeriodHistoryItem[]> {
  const periods = await payrollPeriodRepository.findByTenant(tenantId);
  if (periods.length === 0) return [];

  const authorIds = [...new Set(periods.map((p) => p.generatedBy))];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const authorById = new Map(authors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));

  return periods.map((p) => ({
    id: p.id,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    generatedAt: p.generatedAt.toISOString(),
    generatedBy: p.generatedBy,
    generatedByName: authorById.get(p.generatedBy) ?? null,
    totalAmount: p.totalAmount,
    userCount: p.userCount,
  }));
}

// ─── Exports CSV / XLSX (fichier paie) ────────────────────────

interface ExportRow {
  email: string;
  nom: string;
  prenom: string;
  periode: string;
  montant_commissions: number;
  montant_ajustements: number;
  montant_bonus: number;
  total_variable_brut: number;
}

async function buildExportRows(params: {
  tenantId: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
  userIds?: string[];
}): Promise<ExportRow[]> {
  const { tenantId, callerId, callerRole, periodStart, periodEnd, userIds } = params;
  const users = await resolveEligibleUsers(tenantId, callerId, callerRole, userIds);
  const data = await collectReportData(tenantId, periodStart, periodEnd, users);
  const period = periodKey(periodStart);

  // Seuls les commerciaux avec une part variable partent au logiciel de paie.
  return data.users
    .filter((u) => u.variableTotal !== 0)
    .map((u) => ({
      email: u.user.email,
      nom: u.user.lastName,
      prenom: u.user.firstName,
      periode: period,
      montant_commissions: round2(u.commissionsTotal),
      montant_ajustements: round2(u.adjustmentsTotal),
      montant_bonus: round2(u.bonusTotal),
      total_variable_brut: round2(u.variableTotal),
    }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const EXPORT_COLUMNS: (keyof ExportRow)[] = [
  'email', 'nom', 'prenom', 'periode',
  'montant_commissions', 'montant_ajustements', 'montant_bonus', 'total_variable_brut',
];

export async function buildPayrollExport(params: {
  tenantId: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
  userIds?: string[];
  format: 'csv' | 'xlsx';
}): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const rows = await buildExportRows(params);
  const period = periodKey(params.periodStart);

  if (params.format === 'csv') {
    // Séparateur ';' (standard Excel FR), décimales '.', avec entête.
    const header = EXPORT_COLUMNS.join(';');
    const lines = rows.map((r) =>
      EXPORT_COLUMNS.map((col) => {
        const v = r[col];
        if (typeof v === 'number') return v.toFixed(2);
        // Échappe les éventuels ';' ou '"' dans les champs texte
        const s = String(v);
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(';'),
    );
    // BOM UTF-8 pour qu'Excel ouvre correctement les accents
    const csv = '﻿' + [header, ...lines].join('\r\n');
    return {
      buffer: Buffer.from(csv, 'utf-8'),
      filename: `paie-variable-${period}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  // XLSX : montants en nombres réels (réutilisables dans le tableur)
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS as string[] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Paie variable');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    buffer,
    filename: `paie-variable-${period}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

// ════════════════════════════════════════════════════════════
//  PDF — Relevé de variable par commercial
// ════════════════════════════════════════════════════════════

const COLORS = {
  primary: '#1e3a5f',
  tableHeader: '#e8edf5',
  tableHeaderText: '#1e3a5f',
  border: '#d0d7e2',
  text: '#1a1a2e',
  muted: '#6b7280',
  negative: '#dc2626',
  positive: '#15803d',
  white: '#ffffff',
  lightBg: '#f8f9fb',
};

const MARGIN = 50;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 45;

function safeText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  opts: { width?: number; align?: 'left' | 'right' | 'center'; fontSize?: number; font?: string; color?: string } = {},
): void {
  doc.fontSize(opts.fontSize ?? 8)
    .font(opts.font ?? 'Helvetica')
    .fillColor(opts.color ?? COLORS.text)
    .text(text, x, y, {
      width: opts.width ?? CONTENT_WIDTH,
      align: opts.align ?? 'left',
      lineBreak: false,
    });
  // Remet le curseur à une position sûre : évite les pages vides auto de PDFKit.
  doc.x = MARGIN;
  doc.y = y;
}

function drawHLine(doc: PDFKit.PDFDocument, y: number, color = COLORS.border) {
  doc.strokeColor(color).lineWidth(0.5).moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
}

function needsNewPage(y: number, needed: number): boolean {
  return y + needed > FOOTER_Y - 10;
}

function addPage(doc: PDFKit.PDFDocument): number {
  doc.addPage({ margin: MARGIN, size: 'A4' });
  return MARGIN + 10;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  cols: Array<{ label: string; width: number; align?: 'left' | 'right' | 'center' }>,
): number {
  const rowH = 20;
  doc.fillColor(COLORS.tableHeader).rect(MARGIN, y, CONTENT_WIDTH, rowH).fill();
  let x = MARGIN;
  cols.forEach((col) => {
    safeText(doc, col.label, x + 4, y + 6, {
      width: col.width - 8,
      align: col.align,
      font: 'Helvetica-Bold',
      color: COLORS.tableHeaderText,
    });
    x += col.width;
  });
  return y + rowH;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  y: number,
  cols: Array<{ value: string; width: number; align?: 'left' | 'right' | 'center'; color?: string }>,
  shade: boolean,
): number {
  const rowH = 18;
  if (shade) {
    doc.fillColor(COLORS.lightBg).rect(MARGIN, y, CONTENT_WIDTH, rowH).fill();
  }
  let x = MARGIN;
  cols.forEach((col) => {
    safeText(doc, col.value, x + 4, y + 5, {
      width: col.width - 8,
      align: col.align,
      color: col.color,
    });
    x += col.width;
  });
  drawHLine(doc, y + rowH);
  return y + rowH;
}

function renderUserSection(doc: PDFKit.PDFDocument, data: UserReportData, startY: number): number {
  let y = startY;
  const roleLabel = ROLE_LABELS[data.user.role] ?? data.user.role;

  // ── Identité ──
  safeText(doc, `${data.user.firstName} ${data.user.lastName}`, MARGIN, y, {
    fontSize: 13, font: 'Helvetica-Bold', color: COLORS.primary,
  });
  y += 18;
  safeText(doc, `${roleLabel} - ${data.user.email}`, MARGIN, y, { fontSize: 9, color: COLORS.muted });
  y += 18;
  drawHLine(doc, y, COLORS.primary);
  y += 12;

  // ── Synthèse ──
  safeText(doc, 'Synthese', MARGIN, y, { fontSize: 10, font: 'Helvetica-Bold', color: COLORS.text });
  y += 16;

  const colPoste = 345;
  const colMontant = CONTENT_WIDTH - colPoste;
  y = drawTableHeader(doc, y, [
    { label: 'Poste', width: colPoste },
    { label: 'Montant', width: colMontant, align: 'right' as const },
  ]);

  const rows: Array<[string, number]> = [
    ['Commissions (validees, dues sur la periode)', data.commissionsTotal],
    ["Primes d'objectifs", data.bonusTotal],
  ];
  if (data.adjustmentsTotal !== 0) {
    rows.push(['Ajustements / Regularisations', data.adjustmentsTotal]);
  }
  rows.forEach(([label, val], i) => {
    y = drawTableRow(doc, y, [
      { value: label, width: colPoste },
      { value: formatEuro(val), width: colMontant, align: 'right', color: val < 0 ? COLORS.negative : COLORS.text },
    ], i % 2 === 0);
  });

  // Total variable brut (mis en avant : c'est ce qui part à la paie)
  doc.fillColor(COLORS.primary).rect(MARGIN, y, CONTENT_WIDTH, 22).fill();
  safeText(doc, 'TOTAL VARIABLE BRUT', MARGIN + 6, y + 6, {
    width: colPoste - 12, fontSize: 10, font: 'Helvetica-Bold', color: COLORS.white,
  });
  safeText(doc, formatEuro(data.variableTotal), MARGIN + colPoste + 4, y + 6, {
    width: colMontant - 8, fontSize: 10, font: 'Helvetica-Bold',
    color: data.variableTotal < 0 ? '#fca5a5' : COLORS.white, align: 'right',
  });
  y += 30;

  // Rappel fixe (contexte, hors export paie)
  safeText(
    doc,
    `Pour memoire : salaire fixe brut ${formatEuro(data.user.fixedSalary)}/mois (deja gere par votre logiciel de paie).`,
    MARGIN, y, { fontSize: 8, color: COLORS.muted },
  );
  y += 16;

  if (data.commissions.length === 0 && data.adjustments.length === 0 && data.bonusTotal === 0) {
    safeText(doc, 'Aucun element variable sur la periode.', MARGIN, y, { fontSize: 8, color: COLORS.muted });
    return y + 14;
  }

  // ── Détail des commissions ──
  if (data.commissions.length > 0) {
    if (needsNewPage(y, 70)) y = addPage(doc);
    safeText(doc, 'Detail des commissions', MARGIN, y, { fontSize: 10, font: 'Helvetica-Bold', color: COLORS.text });
    y += 16;

    const cw = { info: 235, saleAmt: 100, commission: 100, date: 60 };
    y = drawTableHeader(doc, y, [
      { label: 'Deal / Client / Regle', width: cw.info },
      { label: 'Montant vente', width: cw.saleAmt, align: 'right' as const },
      { label: 'Commission', width: cw.commission, align: 'right' as const },
      { label: 'Versee', width: cw.date, align: 'right' as const },
    ]);

    data.commissions.forEach((c, i) => {
      if (needsNewPage(y, 34)) y = addPage(doc);
      const shade = i % 2 === 0;
      const blockH = 32;
      doc.fillColor(shade ? COLORS.lightBg : COLORS.white).rect(MARGIN, y, CONTENT_WIDTH, blockH).fill();

      safeText(doc, truncate(c.dealTitle, 42), MARGIN + 6, y + 4, {
        width: cw.info - 12, fontSize: 8, font: 'Helvetica-Bold',
      });
      safeText(doc, formatEuro(c.dealAmount), MARGIN + cw.info + 4, y + 4, {
        width: cw.saleAmt - 8, align: 'right',
      });
      safeText(doc, formatEuro(c.amount), MARGIN + cw.info + cw.saleAmt + 4, y + 4, {
        width: cw.commission - 8, align: 'right', color: COLORS.positive, font: 'Helvetica-Bold',
      });
      const dueDate = c.scheduledPaymentAt ?? c.validatedAt;
      safeText(doc, formatDate(dueDate), MARGIN + cw.info + cw.saleAmt + cw.commission + 4, y + 4, {
        width: cw.date - 8, align: 'right', fontSize: 7, color: COLORS.muted,
      });

      const clientRule = [c.clientName, c.ruleName].filter(Boolean).join('  -  ');
      safeText(doc, truncate(clientRule || '-', 60), MARGIN + 6, y + 18, {
        width: CONTENT_WIDTH - 12, fontSize: 7, color: COLORS.muted,
      });

      y += blockH;
      drawHLine(doc, y);
    });
  }

  // ── Primes d'objectifs ──
  if (data.bonusTotal !== 0) {
    if (needsNewPage(y, 40)) y = addPage(doc);
    y += 8;
    safeText(doc, "Primes d'objectifs", MARGIN, y, { fontSize: 10, font: 'Helvetica-Bold', color: COLORS.text });
    y += 16;
    safeText(doc, `Total primes objectifs sur la periode : ${formatEuro(data.bonusTotal)}`, MARGIN, y, {
      fontSize: 9, color: COLORS.muted,
    });
    y += 14;
  }

  // ── Ajustements ──
  if (data.adjustments.length > 0) {
    if (needsNewPage(y, 60)) y = addPage(doc);
    y += 8;
    safeText(doc, 'Ajustements / Regularisations', MARGIN, y, { fontSize: 10, font: 'Helvetica-Bold', color: COLORS.text });
    y += 16;
    y = drawTableHeader(doc, y, [
      { label: 'Date', width: 80 },
      { label: 'Motif', width: 315 },
      { label: 'Montant', width: 100, align: 'right' as const },
    ]);
    data.adjustments.forEach((a, i) => {
      if (needsNewPage(y, 20)) y = addPage(doc);
      y = drawTableRow(doc, y, [
        { value: formatDate(a.createdAt), width: 80 },
        { value: truncate(a.reason, 55), width: 315 },
        { value: formatEuro(a.amount), width: 100, align: 'right', color: a.amount < 0 ? COLORS.negative : COLORS.positive },
      ], i % 2 === 0);
    });
  }

  return y;
}

/** Construit un PDF (une page ou plus par commercial) à partir d'une liste de relevés. */
async function buildPdfBuffer(users: UserReportData[], periodStart: Date, periodEnd: Date): Promise<Buffer> {
  const doc = new PDFDocument({
    bufferPages: true,
    autoFirstPage: false,
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const genDate = formatGenDate(new Date());
  const periodLabel = formatPeriod(periodStart, periodEnd);

  users.forEach((data) => {
    doc.addPage({ size: 'A4', margin: MARGIN });
    safeText(doc, 'GrowCom', MARGIN, MARGIN, { fontSize: 18, font: 'Helvetica-Bold', color: COLORS.primary });
    safeText(doc, 'Releve de variable', PAGE_WIDTH - MARGIN - 200, MARGIN, {
      width: 200, fontSize: 13, font: 'Helvetica-Bold', color: COLORS.text, align: 'right',
    });
    safeText(doc, `Periode : ${periodLabel}`, PAGE_WIDTH - MARGIN - 200, MARGIN + 18, {
      width: 200, fontSize: 9, color: COLORS.muted, align: 'right',
    });
    safeText(doc, `Genere le ${genDate}`, PAGE_WIDTH - MARGIN - 200, MARGIN + 30, {
      width: 200, fontSize: 9, color: COLORS.muted, align: 'right',
    });
    drawHLine(doc, MARGIN + 42, COLORS.primary);
    renderUserSection(doc, data, MARGIN + 54);
  });

  // Footers
  const range = doc.bufferedPageRange();
  const legalNote =
    'Ce document est un recapitulatif interne genere par GrowCom (elements variables bruts). ' +
    'Il ne se substitue pas au bulletin de salaire officiel.';
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    drawHLine(doc, FOOTER_Y - 5, COLORS.border);
    safeText(doc, `GrowCom - Releve de variable - ${genDate}`, MARGIN, FOOTER_Y, {
      width: CONTENT_WIDTH - 50, fontSize: 7, color: COLORS.muted,
    });
    safeText(doc, `${i + 1} / ${range.count}`, MARGIN, FOOTER_Y, {
      width: CONTENT_WIDTH, fontSize: 7, color: COLORS.muted, align: 'right',
    });
    if (i === range.count - 1) {
      safeText(doc, legalNote, MARGIN, FOOTER_Y + 10, {
        width: CONTENT_WIDTH, fontSize: 6, color: COLORS.muted, align: 'center',
      });
    }
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on('end', resolve));
  return Buffer.concat(chunks);
}

/** PDF combiné : un seul document, une page par commercial. */
export async function buildPayrollPdf(params: {
  tenantId: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
  userIds?: string[];
}): Promise<{ buffer: Buffer; filename: string }> {
  const { tenantId, callerId, callerRole, periodStart, periodEnd, userIds } = params;
  const users = await resolveEligibleUsers(tenantId, callerId, callerRole, userIds);
  const data = await collectReportData(tenantId, periodStart, periodEnd, users);

  if (data.users.length === 0) {
    throw new AppError(404, 'NO_USERS', 'Aucun collaborateur éligible dans ce périmètre');
  }

  const buffer = await buildPdfBuffer(data.users, periodStart, periodEnd);
  return { buffer, filename: `releve-variable-${periodKey(periodStart)}.pdf` };
}

/** ZIP de PDF individuels : un fichier par commercial ayant une part variable. */
export async function buildPayrollPdfZip(params: {
  tenantId: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
  userIds?: string[];
}): Promise<{ buffer: Buffer; filename: string }> {
  const { tenantId, callerId, callerRole, periodStart, periodEnd, userIds } = params;
  const users = await resolveEligibleUsers(tenantId, callerId, callerRole, userIds);
  const data = await collectReportData(tenantId, periodStart, periodEnd, users);

  // On ne génère un relevé que pour les commerciaux ayant un variable non nul.
  const withVariable = data.users.filter((u) => u.variableTotal !== 0);
  if (withVariable.length === 0) {
    throw new AppError(404, 'NO_DATA', 'Aucun élément variable à exporter sur cette période');
  }

  const period = periodKey(periodStart);
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const u of withVariable) {
    const pdf = await buildPdfBuffer([u], periodStart, periodEnd);
    const base = slug(`${u.user.lastName}-${u.user.firstName}`);
    let name = `releve-variable-${period}-${base}.pdf`;
    let n = 2;
    while (usedNames.has(name)) {
      name = `releve-variable-${period}-${base}-${n}.pdf`;
      n += 1;
    }
    usedNames.add(name);
    zip.file(name, pdf);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { buffer, filename: `releves-variable-${period}.zip` };
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'collaborateur';
}
