/**
 * Service de génération du rapport de paie PDF.
 *
 * Convention de période :
 * - Les commissions sont incluses selon leur `validatedAt` (fallback : `calculatedAt`).
 * - C'est la convention paie la plus courante : on inclut dans la fiche de mai 2026 toutes
 *   les commissions validées en mai, peu importe quand le deal a été signé.
 */
import PDFDocument from 'pdfkit';
import { prisma } from '../config/prisma';
import { commissionAdjustmentRepository } from '../repositories/commissionAdjustment.repository';
import { resolveTeamScope } from './commission.service';
import { AppError } from '../middlewares/errorHandler';
import { UserRole } from '../../../shared/types';
import type { PayrollReportPreview, PayrollReportPreviewItem } from '../../../shared/types';
import { CommissionStatus as PrismaCommissionStatus, UserRole as PrismaUserRole } from '@prisma/client';

// ─── Helpers ─────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  COMMERCIAL: 'Commercial',
  TEAM_LEAD: 'Responsable de secteur',
  BU_MANAGER: 'Manager BU',
  MANAGER: 'Manager',
  RECRUITER: 'Recruteur',
};

// BUG 1 FIX : Intl.NumberFormat fr-FR produit un espace insecable U+00A0 comme separateur
// de milliers. Helvetica (WinAnsi) ne le rend pas correctement -> affichage "2 /212,00 EUR".
// On remplace U+00A0 par un espace normal et on evite la fleche Unicode.
function formatEuro(amount: number): string {
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return formatted.replace(/\u00A0/g, ' ') + ' EUR';
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('fr-FR');
}

// BUG 1 FIX : "au" au lieu de la fleche Unicode (U+2192, hors WinAnsi Helvetica)
function formatPeriod(start: Date, end: Date): string {
  return `${formatDate(start)} au ${formatDate(end)}`;
}

// ─── Collecte des données ─────────────────────────────────────

interface UserPayrollData {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string; // BUG 5 FIX : champ ajouté pour affichage dans le PDF
  fixedSalary: number;
  commissions: Array<{
    id: string;
    dealTitle: string;
    clientName: string | null;
    amount: number;
    status: string;
    validatedAt: Date | null;
    ruleName: string;
  }>;
  adjustments: Array<{
    id: string;
    reason: string;
    amount: number;
    createdAt: Date;
  }>;
  bonusFromObjectives: number;
  // Totaux
  commissionsTotal: number;
  adjustmentsTotal: number;
  fixedSalaryTotal: number;
  netTotal: number;
}

async function collectUserData(
  userId: string,
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  monthsInPeriod: number,
): Promise<UserPayrollData> {
  const [user, rawCommissions, adjustments, snapshots] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      // BUG 5 FIX : role ajouté au select
      select: { firstName: true, lastName: true, email: true, fixedSalary: true, role: true },
    }),
    prisma.commission.findMany({
      where: {
        userId,
        tenantId,
        status: { in: [PrismaCommissionStatus.VALIDATED, PrismaCommissionStatus.PAID] },
        OR: [
          { validatedAt: { gte: periodStart, lte: periodEnd } },
          { validatedAt: null, calculatedAt: { gte: periodStart, lte: periodEnd } },
        ],
      },
      include: {
        deal: { select: { title: true, clientName: true } },
        rule: { select: { name: true } },
      },
      orderBy: { validatedAt: 'asc' },
    }),
    commissionAdjustmentRepository.findByUserInPeriod(userId, tenantId, periodStart, periodEnd),
    prisma.objectiveSnapshot.findMany({
      where: { userId, tenantId, snapshotAt: { gte: periodStart, lte: periodEnd } },
      select: { bonusEarned: true },
    }),
  ]);

  if (!user) throw new AppError(404, 'USER_NOT_FOUND', `Utilisateur ${userId} introuvable`);

  const commissions = rawCommissions.map((c) => ({
    id: c.id,
    dealTitle: c.deal.title,
    clientName: c.deal.clientName,
    amount: c.amount,
    status: c.status,
    validatedAt: c.validatedAt,
    ruleName: c.rule.name,
  }));

  const commissionsTotal = commissions.reduce((s, c) => s + c.amount, 0);
  const adjustmentsTotal = adjustments.reduce((s, a) => s + a.amount, 0);
  const bonusFromObjectives = snapshots.reduce((s, snap) => s + snap.bonusEarned, 0);
  const fixedSalaryTotal = user.fixedSalary * monthsInPeriod;
  const netTotal = fixedSalaryTotal + commissionsTotal + adjustmentsTotal + bonusFromObjectives;

  return {
    userId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    fixedSalary: user.fixedSalary,
    commissions,
    adjustments: adjustments.map((a) => ({
      id: a.id,
      reason: a.reason,
      amount: a.amount,
      createdAt: a.createdAt,
    })),
    bonusFromObjectives,
    commissionsTotal,
    adjustmentsTotal,
    fixedSalaryTotal,
    netTotal,
  };
}

// ─── PDF Builder ──────────────────────────────────────────────

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
};

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 width in points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function drawHLine(doc: PDFKit.PDFDocument, y: number, color = COLORS.border) {
  doc.strokeColor(color).lineWidth(0.5).moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  cols: Array<{ label: string; width: number; align?: 'left' | 'right' | 'center' }>,
): number {
  const rowH = 20;
  doc.fillColor(COLORS.tableHeader)
    .rect(MARGIN, y, CONTENT_WIDTH, rowH)
    .fill();
  let x = MARGIN;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.tableHeaderText);
  cols.forEach((col) => {
    doc.text(col.label, x + 4, y + 6, { width: col.width - 8, align: col.align ?? 'left' });
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
    doc.fillColor('#f8f9fb').rect(MARGIN, y, CONTENT_WIDTH, rowH).fill();
  }
  let x = MARGIN;
  cols.forEach((col) => {
    doc.fontSize(8).font('Helvetica').fillColor(col.color ?? COLORS.text)
      .text(col.value, x + 4, y + 5, { width: col.width - 8, align: col.align ?? 'left' });
    x += col.width;
  });
  drawHLine(doc, y + rowH);
  return y + rowH;
}

// BUG 2 FIX : checkPageBreak retourne correctement le nouveau y apres addPage
function checkPageBreak(doc: PDFKit.PDFDocument, y: number, needed = 60): number {
  if (y + needed > doc.page.height - 60) {
    doc.addPage();
    return MARGIN + 20;
  }
  return y;
}

function renderUserSection(
  doc: PDFKit.PDFDocument,
  data: UserPayrollData,
  _periodStart: Date,
  _periodEnd: Date,
  _tenantName: string,
): void {
  let y = doc.y;

  y = checkPageBreak(doc, y, 120);

  // BUG 4 FIX : detecter si le commercial a une activite variable sur la periode
  const hasVariableComp =
    data.commissionsTotal !== 0 || data.bonusFromObjectives !== 0 || data.adjustmentsTotal !== 0;

  // ── Bloc identité (BUG 5 FIX : role traduit sous le nom) ──
  const roleLabel = ROLE_LABELS[data.role] ?? data.role;
  doc.fontSize(13).font('Helvetica-Bold').fillColor(COLORS.primary)
    .text(`${data.firstName} ${data.lastName}`, MARGIN, y);
  y += 18;
  doc.fontSize(9).font('Helvetica').fillColor(COLORS.muted)
    .text(`${roleLabel} - ${data.email}`, MARGIN, y);
  y += 20;
  drawHLine(doc, y, COLORS.primary);
  y += 10;

  // ── Synthèse ──
  doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text).text('Synthèse', MARGIN, y);
  y += 16;

  const synthCols = [
    { label: 'Poste', width: 220 },
    { label: 'Montant', width: 130, align: 'right' as const },
  ];
  y = drawTableHeader(doc, y, synthCols);

  // BUG 4 FIX : synthese compacte si aucune activite variable (salaire fixe seul)
  if (!hasVariableComp) {
    const monthCount = (data.fixedSalaryTotal / Math.max(data.fixedSalary, 1)).toFixed(0);
    const fixedLabel = `Salaire fixe brut (${formatEuro(data.fixedSalary)}/mois x ${monthCount} mois)`;
    y = drawTableRow(doc, y, [
      { value: fixedLabel, width: 220 },
      { value: formatEuro(data.fixedSalaryTotal), width: 130, align: 'right' },
    ], false);

    // Total net
    doc.fillColor(COLORS.primary).rect(MARGIN, y, CONTENT_WIDTH, 22).fill();
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.white)
      .text('TOTAL NET A VERSER', MARGIN + 4, y + 6, { width: 220 - 8 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.white)
      .text(formatEuro(data.netTotal), MARGIN + 220 + 4, y + 6, { width: 130 - 8, align: 'right' });
    y += 30;

    // Note "aucune activite"
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted)
      .text('Aucune commission ni prime sur la periode. Seul le salaire fixe est du.', MARGIN, y, {
        width: CONTENT_WIDTH,
        oblique: true,
      });
    y += 20;
  } else {
    const monthCount = (data.fixedSalaryTotal / Math.max(data.fixedSalary, 1)).toFixed(0);
    const rows: Array<[string, string]> = [
      [`Salaire fixe brut (${formatEuro(data.fixedSalary)}/mois x ${monthCount} mois)`, formatEuro(data.fixedSalaryTotal)],
      ['Commissions (validees/payees)', formatEuro(data.commissionsTotal)],
      ["Primes d'objectifs", formatEuro(data.bonusFromObjectives)],
      ...(data.adjustmentsTotal !== 0
        ? [['Ajustements / Regularisations', formatEuro(data.adjustmentsTotal)] as [string, string]]
        : []),
    ];
    rows.forEach((row, i) => {
      const numVal = parseFloat(row[1].replace(/\s/g, '').replace('EUR', '').replace(',', '.'));
      y = drawTableRow(doc, y, [
        { value: row[0], width: 220 },
        { value: row[1], width: 130, align: 'right', color: numVal < 0 ? COLORS.negative : COLORS.text },
      ], i % 2 === 0);
    });

    // Total net
    doc.fillColor(COLORS.primary).rect(MARGIN, y, CONTENT_WIDTH, 22).fill();
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.white)
      .text('TOTAL NET A VERSER', MARGIN + 4, y + 6, { width: 220 - 8 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.white)
      .text(formatEuro(data.netTotal), MARGIN + 220 + 4, y + 6, { width: 130 - 8, align: 'right' });
    y += 26;

    // ── Détail commissions ──
    if (data.commissions.length > 0) {
      y = checkPageBreak(doc, y, 80);
      y += 10;
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text).text('Detail des commissions', MARGIN, y);
      y += 16;

      const commCols = [
        { label: 'Date', width: 65 },
        { label: 'Deal', width: 140 },
        { label: 'Client', width: 100 },
        { label: 'Regle', width: 80 },
        { label: 'Montant', width: 75, align: 'right' as const },
        { label: 'Statut', width: 35 },
      ];
      y = drawTableHeader(doc, y, commCols);

      data.commissions.forEach((c, i) => {
        y = checkPageBreak(doc, y, 22);
        y = drawTableRow(doc, y, [
          { value: formatDate(c.validatedAt), width: 65 },
          { value: c.dealTitle, width: 140 },
          { value: c.clientName ?? '-', width: 100 },
          { value: c.ruleName, width: 80 },
          { value: formatEuro(c.amount), width: 75, align: 'right' },
          { value: c.status === 'PAID' ? 'Payee' : 'Validee', width: 35 },
        ], i % 2 === 0);
      });
    }

    // ── Primes d'objectifs ──
    if (data.bonusFromObjectives > 0) {
      y = checkPageBreak(doc, y, 60);
      y += 10;
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text).text("Primes d'objectifs", MARGIN, y);
      y += 16;
      doc.fontSize(9).font('Helvetica').fillColor(COLORS.muted)
        .text(`Total primes objectifs sur la periode : ${formatEuro(data.bonusFromObjectives)}`, MARGIN, y);
      y += 14;
    }

    // ── Ajustements ──
    if (data.adjustments.length > 0) {
      y = checkPageBreak(doc, y, 80);
      y += 10;
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text).text('Ajustements / Regularisations', MARGIN, y);
      y += 16;

      const adjCols = [
        { label: 'Date', width: 80 },
        { label: 'Motif', width: 315 },
        { label: 'Montant', width: 100, align: 'right' as const },
      ];
      y = drawTableHeader(doc, y, adjCols);

      data.adjustments.forEach((a, i) => {
        y = checkPageBreak(doc, y, 22);
        y = drawTableRow(doc, y, [
          { value: formatDate(a.createdAt), width: 80 },
          { value: a.reason, width: 315 },
          { value: formatEuro(a.amount), width: 100, align: 'right', color: a.amount < 0 ? COLORS.negative : COLORS.positive },
        ], i % 2 === 0);
      });
    }
  }

  // BUG 2 FIX : ne jamais laisser doc.y depasser la limite de page
  // (evite les pages fantomes generees automatiquement par PDFKit)
  const maxSafeY = doc.page.height - (doc.page.margins?.bottom ?? 50) - 50;
  doc.y = Math.min(y + 20, maxSafeY);
}

// ─── Génération complète du PDF ───────────────────────────────

export async function generatePayrollReport(params: {
  tenantId: string;
  userId?: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { tenantId, userId, callerId, callerRole, periodStart, periodEnd } = params;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const tenantName = tenant?.name ?? 'GrowCom';

  // BUG 3 FIX : TEAM_LEAD et BU_MANAGER ajoutés — ils peuvent aussi avoir des commissions
  let userIds: string[];
  if (userId) {
    userIds = [userId];
  } else {
    const teamIds = await resolveTeamScope(callerId, callerRole, tenantId);
    const eligibleUsers = await prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        role: {
          in: [
            PrismaUserRole.COMMERCIAL,
            PrismaUserRole.RECRUITER,
            PrismaUserRole.TEAM_LEAD,
            PrismaUserRole.BU_MANAGER,
          ],
        },
        ...(teamIds !== null ? { id: { in: teamIds } } : {}),
      },
      select: { id: true },
    });
    userIds = eligibleUsers.map((u) => u.id);
  }

  if (userIds.length === 0) {
    throw new AppError(404, 'NO_USERS', 'Aucun utilisateur éligible trouvé dans ce périmètre');
  }

  // Calculer le nombre de mois approximatif (pour le salaire fixe)
  const monthsInPeriod = Math.max(
    1,
    (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 +
      (periodEnd.getMonth() - periodStart.getMonth()) + 1,
  );

  // Collecter les données pour chaque utilisateur
  const usersData = await Promise.all(
    userIds.map((uid) => collectUserData(uid, tenantId, periodStart, periodEnd, monthsInPeriod)),
  );

  // Construire le PDF
  const doc = new PDFDocument({ bufferPages: true, margin: MARGIN, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // ── Header ──
  const genDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  // BUG 1 FIX : formatPeriod utilise "au" au lieu de la fleche Unicode
  const periodLabel = formatPeriod(periodStart, periodEnd);

  doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.primary).text('GrowCom', MARGIN, MARGIN);
  doc.fontSize(11).font('Helvetica').fillColor(COLORS.muted).text(tenantName, MARGIN, MARGIN + 24);

  doc.fontSize(14).font('Helvetica-Bold').fillColor(COLORS.text)
    .text('Rapport de paie', PAGE_WIDTH - MARGIN - 200, MARGIN, { align: 'right', width: 200 });
  doc.fontSize(9).font('Helvetica').fillColor(COLORS.muted)
    .text(`Periode : ${periodLabel}`, PAGE_WIDTH - MARGIN - 200, MARGIN + 20, { align: 'right', width: 200 })
    .text(`Genere le ${genDate}`, PAGE_WIDTH - MARGIN - 200, MARGIN + 32, { align: 'right', width: 200 });

  doc.y = MARGIN + 55;
  drawHLine(doc, doc.y, COLORS.primary);
  doc.y += 20;

  // ── Sections par utilisateur ──
  usersData.forEach((data, idx) => {
    if (idx > 0) {
      doc.addPage();
      doc.y = MARGIN + 10;
    }
    renderUserSection(doc, data, periodStart, periodEnd, tenantName);
  });

  // ── Footers sur toutes les pages ──
  const pageCount = doc.bufferedPageRange().count;
  const legalNote =
    'Ce document est un recapitulatif interne genere par GrowCom. ' +
    'Il est informatif et ne se substitue pas au bulletin de salaire officiel. ' +
    'Les charges sociales et fiscales ne sont pas appliquees.';

  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 40;
    drawHLine(doc, footerY - 5, COLORS.border);

    // Pagination X / Y
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted)
      .text(`GrowCom — Rapport genere le ${genDate}`, MARGIN, footerY, { width: CONTENT_WIDTH - 60 })
      .text(`${i + 1} / ${pageCount}`, MARGIN, footerY, { width: CONTENT_WIDTH, align: 'right' });

    // BUG 5 FIX : mention legale uniquement sur la derniere page
    if (i === pageCount - 1) {
      doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
        .text(legalNote, MARGIN, footerY + 12, { width: CONTENT_WIDTH, align: 'center' });
    }
  }

  doc.end();

  await new Promise<void>((resolve) => doc.on('end', resolve));
  const buffer = Buffer.concat(chunks);

  const dateStr = periodStart.toISOString().slice(0, 10);
  const dateEndStr = periodEnd.toISOString().slice(0, 10);
  const filename = `payroll-${dateStr}_${dateEndStr}.pdf`;

  return { buffer, filename };
}

// ─── Preview (JSON léger, sans PDF) ──────────────────────────

export async function generatePayrollPreview(params: {
  tenantId: string;
  userId?: string;
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
}): Promise<PayrollReportPreview> {
  const { tenantId, userId, callerId, callerRole, periodStart, periodEnd } = params;

  // BUG 3 FIX : meme correction que pour generatePayrollReport
  let userIds: string[];
  if (userId) {
    userIds = [userId];
  } else {
    const teamIds = await resolveTeamScope(callerId, callerRole, tenantId);
    const eligibleUsers = await prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        role: {
          in: [
            PrismaUserRole.COMMERCIAL,
            PrismaUserRole.RECRUITER,
            PrismaUserRole.TEAM_LEAD,
            PrismaUserRole.BU_MANAGER,
          ],
        },
        ...(teamIds !== null ? { id: { in: teamIds } } : {}),
      },
      select: { id: true },
    });
    userIds = eligibleUsers.map((u) => u.id);
  }

  const monthsInPeriod = Math.max(
    1,
    (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 +
      (periodEnd.getMonth() - periodStart.getMonth()) + 1,
  );

  const usersData = await Promise.all(
    userIds.map((uid) => collectUserData(uid, tenantId, periodStart, periodEnd, monthsInPeriod)),
  );

  const items: PayrollReportPreviewItem[] = usersData.map((d) => ({
    userId: d.userId,
    user: { firstName: d.firstName, lastName: d.lastName, email: d.email },
    fixedSalaryTotal: d.fixedSalaryTotal,
    commissionsTotal: d.commissionsTotal,
    adjustmentsTotal: d.adjustmentsTotal,
    bonusTotal: d.bonusFromObjectives,
    netTotal: d.netTotal,
  }));

  const grandTotal = items.reduce((s, i) => s + i.netTotal, 0);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    items,
    grandTotal,
  };
}
