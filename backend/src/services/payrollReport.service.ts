/**
 * Service de generation du rapport de paie PDF.
 *
 * Convention de periode :
 * - Les commissions sont incluses selon leur `validatedAt` (fallback : `calculatedAt`).
 * - C'est la convention paie la plus courante : on inclut dans la fiche de mai 2026 toutes
 *   les commissions validees en mai, peu importe quand le deal a ete signe.
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

// Tronque un texte pour qu'il tienne dans une largeur donnee (en points) a une fontSize donnee.
// Helvetica : ~4.5pt par caractere a fontSize 7, ~5pt a fontSize 8.
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 2) + '..';
}

// ─── Collecte des donnees ─────────────────────────────────────

interface UserPayrollData {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  fixedSalary: number;
  commissions: Array<{
    id: string;
    dealTitle: string;
    clientName: string | null;
    amount: number;
    status: string;
    validatedAt: Date | null;
    closedAt: Date | null;
    paidAt: Date | null;
    clientPaidAt: Date | null;
    ruleName: string;
    dealAmount: number;
  }>;
  adjustments: Array<{
    id: string;
    reason: string;
    amount: number;
    createdAt: Date;
  }>;
  bonusFromObjectives: number;
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
        deal: { select: { title: true, clientName: true, closedAt: true, amount: true } },
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
    closedAt: c.deal.closedAt,
    paidAt: c.paidAt,
    clientPaidAt: c.clientPaidAt,
    ruleName: c.rule.name,
    dealAmount: c.deal.amount,
  }));

  const commissionsTotal = commissions.reduce((s, c) => s + c.amount, 0);
  const bonusFromObjectives = snapshots.reduce((s, snap) => s + snap.bonusEarned, 0);

  // Exclure les ajustements auto-generes par les objectifs (createdBy = 'SYSTEM' + reason
  // commence par 'Prime objectif') pour eviter un double comptage : ces montants sont deja
  // inclus dans bonusFromObjectives via les ObjectiveSnapshots.
  const manualAdjustments = adjustments.filter(
    (a) => !(a.createdBy === 'SYSTEM' && a.reason.startsWith('Prime objectif')),
  );
  const adjustmentsTotal = manualAdjustments.reduce((s, a) => s + a.amount, 0);

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
    adjustments: manualAdjustments.map((a) => ({
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
  lightBg: '#f8f9fb',
  dateBg: '#f1f3f8',
};

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 45;

// Wrapper pour doc.text qui ne declenche JAMAIS de saut de page automatique.
// Toute ecriture de texte dans le PDF DOIT passer par cette fonction.
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
  // CRUCIAL : remettre le curseur interne a une position SAFE apres chaque ecriture.
  // Sans ca, doc.y avance a chaque appel et quand il depasse la hauteur de page,
  // PDFKit cree automatiquement une page vide au prochain doc.text().
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

// ── Rendu d'un utilisateur ──

function renderUserSection(
  doc: PDFKit.PDFDocument,
  data: UserPayrollData,
  startY: number,
): number {
  let y = startY;

  const hasVariableComp =
    data.commissionsTotal !== 0 || data.bonusFromObjectives !== 0 || data.adjustmentsTotal !== 0;

  // ── Identite ──
  const roleLabel = ROLE_LABELS[data.role] ?? data.role;
  safeText(doc, `${data.firstName} ${data.lastName}`, MARGIN, y, {
    fontSize: 13,
    font: 'Helvetica-Bold',
    color: COLORS.primary,
  });
  y += 18;
  safeText(doc, `${roleLabel} - ${data.email}`, MARGIN, y, {
    fontSize: 9,
    color: COLORS.muted,
  });
  y += 18;
  drawHLine(doc, y, COLORS.primary);
  y += 12;

  // ── Synthese ──
  safeText(doc, 'Synthese', MARGIN, y, {
    fontSize: 10,
    font: 'Helvetica-Bold',
    color: COLORS.text,
  });
  y += 16;

  const colPoste = 345;
  const colMontant = CONTENT_WIDTH - colPoste;
  const synthCols = [
    { label: 'Poste', width: colPoste },
    { label: 'Montant', width: colMontant, align: 'right' as const },
  ];
  y = drawTableHeader(doc, y, synthCols);

  if (!hasVariableComp) {
    const monthCount = Math.round(data.fixedSalaryTotal / Math.max(data.fixedSalary, 1));
    y = drawTableRow(doc, y, [
      { value: `Salaire fixe brut (${formatEuro(data.fixedSalary)}/mois x ${monthCount} mois)`, width: colPoste },
      { value: formatEuro(data.fixedSalaryTotal), width: colMontant, align: 'right' },
    ], false);

    // Total
    doc.fillColor(COLORS.primary).rect(MARGIN, y, CONTENT_WIDTH, 22).fill();
    safeText(doc, 'TOTAL NET A VERSER', MARGIN + 6, y + 6, {
      width: colPoste - 12, fontSize: 10, font: 'Helvetica-Bold', color: COLORS.white,
    });
    safeText(doc, formatEuro(data.netTotal), MARGIN + colPoste + 4, y + 6, {
      width: colMontant - 8, fontSize: 10, font: 'Helvetica-Bold', color: COLORS.white, align: 'right',
    });
    y += 30;

    safeText(doc, 'Aucune commission ni prime sur la periode. Seul le salaire fixe est du.', MARGIN, y, {
      fontSize: 8, color: COLORS.muted,
    });
    y += 16;
  } else {
    const monthCount = Math.round(data.fixedSalaryTotal / Math.max(data.fixedSalary, 1));
    const rows: Array<[string, number]> = [
      [`Salaire fixe brut (${formatEuro(data.fixedSalary)}/mois x ${monthCount} mois)`, data.fixedSalaryTotal],
      ['Commissions (validees / payees)', data.commissionsTotal],
      ["Primes d'objectifs", data.bonusFromObjectives],
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

    // Total
    doc.fillColor(COLORS.primary).rect(MARGIN, y, CONTENT_WIDTH, 22).fill();
    safeText(doc, 'TOTAL NET A VERSER', MARGIN + 6, y + 6, {
      width: colPoste - 12, fontSize: 10, font: 'Helvetica-Bold', color: COLORS.white,
    });
    safeText(doc, formatEuro(data.netTotal), MARGIN + colPoste + 4, y + 6, {
      width: colMontant - 8, fontSize: 10, font: 'Helvetica-Bold', color: COLORS.white, align: 'right',
    });
    y += 30;

    // ── Detail des commissions ──
    if (data.commissions.length > 0) {
      if (needsNewPage(y, 70)) y = addPage(doc);

      safeText(doc, 'Detail des commissions', MARGIN, y, {
        fontSize: 10, font: 'Helvetica-Bold', color: COLORS.text,
      });
      y += 16;

      // 4 colonnes larges : Deal/Client | Montant vente | Commission | Statut
      const cw = { info: 215, saleAmt: 100, commission: 100, status: 80 };
      const commCols = [
        { label: 'Deal / Client', width: cw.info },
        { label: 'Montant vente', width: cw.saleAmt, align: 'right' as const },
        { label: 'Commission', width: cw.commission, align: 'right' as const },
        { label: 'Statut', width: cw.status },
      ];
      y = drawTableHeader(doc, y, commCols);

      data.commissions.forEach((c, i) => {
        // Chaque commission = ligne 1 deal (16pt) + ligne 2 client+regle (14pt) + ligne 3 dates (14pt) + marge (2pt)
        if (needsNewPage(y, 48)) y = addPage(doc);

        const shade = i % 2 === 0;
        const blockH = 46;
        const bgColor = shade ? COLORS.lightBg : COLORS.white;
        doc.fillColor(bgColor).rect(MARGIN, y, CONTENT_WIDTH, blockH).fill();

        const statusLabel = c.status === 'PAID' ? 'Payee' : 'Validee';
        const statusColor = c.status === 'PAID' ? COLORS.positive : COLORS.primary;

        // Ligne 1 : nom du deal + montants + statut
        safeText(doc, c.dealTitle, MARGIN + 6, y + 4, {
          width: cw.info - 12, fontSize: 8, font: 'Helvetica-Bold',
        });
        safeText(doc, formatEuro(c.dealAmount), MARGIN + cw.info + 4, y + 4, {
          width: cw.saleAmt - 8, align: 'right',
        });
        safeText(doc, formatEuro(c.amount), MARGIN + cw.info + cw.saleAmt + 4, y + 4, {
          width: cw.commission - 8, align: 'right', color: COLORS.positive, font: 'Helvetica-Bold',
        });
        safeText(doc, statusLabel, MARGIN + cw.info + cw.saleAmt + cw.commission + 6, y + 4, {
          width: cw.status - 12, color: statusColor, font: 'Helvetica-Bold',
        });

        // Ligne 2 : client + regle
        const clientRule = [c.clientName, c.ruleName].filter(Boolean).join('  -  ');
        safeText(doc, clientRule || '-', MARGIN + 6, y + 18, {
          width: CONTENT_WIDTH - 12, fontSize: 7, color: COLORS.muted,
        });

        // Ligne 3 : dates
        const dates: string[] = [];
        if (c.closedAt) dates.push(`Signe : ${formatDate(c.closedAt)}`);
        if (c.validatedAt) dates.push(`Valide : ${formatDate(c.validatedAt)}`);
        if (c.clientPaidAt) dates.push(`Paiement client : ${formatDate(c.clientPaidAt)}`);
        safeText(doc, dates.length > 0 ? dates.join('     ') : '-', MARGIN + 6, y + 31, {
          width: CONTENT_WIDTH - 12, fontSize: 7, color: COLORS.muted,
        });

        y += blockH;
        drawHLine(doc, y);
      });
    }

    // ── Primes d'objectifs ──
    if (data.bonusFromObjectives > 0) {
      if (needsNewPage(y, 40)) y = addPage(doc);
      y += 8;
      safeText(doc, "Primes d'objectifs", MARGIN, y, {
        fontSize: 10, font: 'Helvetica-Bold', color: COLORS.text,
      });
      y += 16;
      safeText(doc, `Total primes objectifs sur la periode : ${formatEuro(data.bonusFromObjectives)}`, MARGIN, y, {
        fontSize: 9, color: COLORS.muted,
      });
      y += 14;
    }

    // ── Ajustements ──
    if (data.adjustments.length > 0) {
      if (needsNewPage(y, 60)) y = addPage(doc);
      y += 8;
      safeText(doc, 'Ajustements / Regularisations', MARGIN, y, {
        fontSize: 10, font: 'Helvetica-Bold', color: COLORS.text,
      });
      y += 16;

      const adjCols = [
        { label: 'Date', width: 80 },
        { label: 'Motif', width: 315 },
        { label: 'Montant', width: 100, align: 'right' as const },
      ];
      y = drawTableHeader(doc, y, adjCols);

      data.adjustments.forEach((a, i) => {
        if (needsNewPage(y, 20)) y = addPage(doc);
        y = drawTableRow(doc, y, [
          { value: formatDate(a.createdAt), width: 80 },
          { value: truncate(a.reason, 55), width: 315 },
          { value: formatEuro(a.amount), width: 100, align: 'right', color: a.amount < 0 ? COLORS.negative : COLORS.positive },
        ], i % 2 === 0);
      });
    }
  }

  return y;
}

// ─── Generation complete du PDF ───────────────────────────────

export async function generatePayrollReport(params: {
  tenantId: string;
  userIds?: string[];
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { tenantId, userIds: requestedUserIds, callerId, callerRole, periodStart, periodEnd } = params;

  let userIds: string[];
  if (requestedUserIds && requestedUserIds.length > 0) {
    userIds = requestedUserIds;
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

  const monthsInPeriod = Math.max(
    1,
    (periodEnd.getFullYear() - periodStart.getFullYear()) * 12 +
      (periodEnd.getMonth() - periodStart.getMonth()) + 1,
  );

  const usersData = await Promise.all(
    userIds.map((uid) => collectUserData(uid, tenantId, periodStart, periodEnd, monthsInPeriod)),
  );

  // ── Construire le PDF ──
  // autoFirstPage: false => on controle entierement la creation des pages
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

  // ── Une page (ou plus) par utilisateur ──
  usersData.forEach((data) => {
    // Nouvelle page
    doc.addPage({ size: 'A4', margin: MARGIN });

    // Header
    safeText(doc, 'GrowCom', MARGIN, MARGIN, {
      fontSize: 18, font: 'Helvetica-Bold', color: COLORS.primary,
    });
    safeText(doc, 'Rapport de paie', PAGE_WIDTH - MARGIN - 200, MARGIN, {
      width: 200, fontSize: 13, font: 'Helvetica-Bold', color: COLORS.text, align: 'right',
    });
    safeText(doc, `Periode : ${periodLabel}`, PAGE_WIDTH - MARGIN - 200, MARGIN + 18, {
      width: 200, fontSize: 9, color: COLORS.muted, align: 'right',
    });
    safeText(doc, `Genere le ${genDate}`, PAGE_WIDTH - MARGIN - 200, MARGIN + 30, {
      width: 200, fontSize: 9, color: COLORS.muted, align: 'right',
    });
    drawHLine(doc, MARGIN + 42, COLORS.primary);

    // Contenu utilisateur — demarre apres le header (ligne a MARGIN+42 + marge 12pt)
    renderUserSection(doc, data, MARGIN + 54);
  });

  // ── Footers sur toutes les pages ──
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  const legalNote =
    'Ce document est un recapitulatif interne genere par GrowCom. ' +
    'Il ne se substitue pas au bulletin de salaire officiel.';

  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    drawHLine(doc, FOOTER_Y - 5, COLORS.border);
    safeText(doc, `GrowCom - Rapport de paie - ${genDate}`, MARGIN, FOOTER_Y, {
      width: CONTENT_WIDTH - 50, fontSize: 7, color: COLORS.muted,
    });
    safeText(doc, `${i + 1} / ${pageCount}`, MARGIN, FOOTER_Y, {
      width: CONTENT_WIDTH, fontSize: 7, color: COLORS.muted, align: 'right',
    });
    // Mention legale sur la derniere page
    if (i === pageCount - 1) {
      safeText(doc, legalNote, MARGIN, FOOTER_Y + 10, {
        width: CONTENT_WIDTH, fontSize: 6, color: COLORS.muted, align: 'center',
      });
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

// ─── Preview (JSON leger, sans PDF) ──────────────────────────

export async function generatePayrollPreview(params: {
  tenantId: string;
  userIds?: string[];
  callerId: string;
  callerRole: UserRole;
  periodStart: Date;
  periodEnd: Date;
}): Promise<PayrollReportPreview> {
  const { tenantId, userIds: requestedUserIds, callerId, callerRole, periodStart, periodEnd } = params;

  let userIds: string[];
  if (requestedUserIds && requestedUserIds.length > 0) {
    userIds = requestedUserIds;
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
