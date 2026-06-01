/**
 * fileImport.service.ts
 * Service d'import de fichiers Excel/CSV vers le schéma Deal normalisé.
 * N'interagit pas avec le code Odoo.
 */

import * as XLSX from 'xlsx';
import { z } from 'zod';
import { DealStatus, CommissionStatus as PrismaCommissionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { dealRepository } from '../repositories/deal.repository';
import { importLogRepository } from '../repositories/importLog.repository';
import { userRepository } from '../repositories/user.repository';
import { commissionService } from './commission.service';
import { logger } from '../config/logger';
import type { ImportPreview, ImportPreviewRow, ImportRowError, FileImportConfirmResult } from '../../../shared/types';
import { ImportSource as PrismaImportSource } from '@prisma/client';
import {
  detectColumnMapping,
  applyCustomMapping,
  extractRowWithMapping,
  normalizeHeader as mapperNormalizeHeader,
  type ColumnMapping,
  type DealField,
} from './excelColumnMapper.service';

// ─── Constantes ──────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'];

// ─── Aliases de colonnes ─────────────────────────────────────────────────────
// Le dictionnaire de synonymes est maintenant dans excelColumnMapper.service.ts
// L'ancien système COLUMN_ALIASES est remplacé par detectColumnMapping().

// ─── Schéma Zod de validation d'une ligne ────────────────────────────────────

const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

// Nettoie une valeur monétaire : "14 800 €" → "14800", "9 600,50 €" → "9600.50"
function cleanCurrencyValue(v: unknown): unknown {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || v.trim() === '') return v;
  return v
    .replace(/[€$£¥\s]/g, '')   // supprime les symboles monétaires et espaces (séparateur milliers)
    .replace(',', '.');           // virgule décimale FR → point
}

// Convertit une date vers le format ISO YYYY-MM-DD.
// Gère 3 cas selon ce que la bibliothèque XLSX retourne :
//   1. Objet JS Date  (cellDates: true)         → "2026-04-02"
//   2. String DD/MM/YYYY (format FR)             → "2026-04-02"
//   3. String M/D/YY (format US, fallback Excel) → "2026-04-02"
function toIsoDate(v: unknown): unknown {
  // Cas 1 : objet Date JS — c'est le cas normal avec cellDates: true
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  // Déjà au format ISO — rien à faire
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return v;
  // Cas 2 : DD/MM/YYYY (format français avec année 4 chiffres)
  const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Cas 3 : M/D/YY (format US à 2 chiffres, ex: "4/2/26" = 2 avril 2026)
  const mdyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyy) {
    const [, m, d, yy] = mdyy;
    return `20${yy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return v;
}

const DealRowSchema = z.object({
  external_id:       z.string().min(1, 'external_id est requis'),
  deal_name:         z.string().min(1, 'deal_name est requis'),
  // Preprocessing : strip "€", espaces et virgule décimale avant conversion numérique
  amount:            z.preprocess(
    cleanCurrencyValue,
    z.coerce.number({ invalid_type_error: 'amount doit être un nombre' }).nonnegative('amount doit être positif ou nul'),
  ),
  currency:          z.string().regex(/^[A-Z]{3}$/, 'currency doit être un code ISO 3 lettres (ex: EUR)').default('EUR'),
  // Preprocessing : accepte DD/MM/YYYY (factures FR) en plus du format ISO 8601
  closed_at:         z.preprocess(
    toIsoDate,
    z.string().regex(dateRegex, 'closed_at doit être une date ISO 8601 (ex: 2024-01-15) ou JJ/MM/AAAA'),
  ),
  // Au moins un des deux est requis (vérifié via superRefine ci-dessous)
  commercial_email:  z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().email('commercial_email doit être un email valide').optional(),
  ),
  commercial_name:   z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  client_name:       z.string().optional(),
  deal_type:         z.string().optional(),
  notes:             z.string().optional(),
  // payment_status : normalise "Payé"/"Paid" → "PAID" et "En attente"/"Pending" → "PENDING"
  payment_status:    z.preprocess((v) => {
    if (v === '' || v === undefined || v === null) return undefined;
    const s = String(v).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (['paye', 'paid', 'regle', 'encaisse', 'oui', 'yes'].includes(s)) return 'PAID';
    if (['en attente', 'pending', 'attente', 'non paye', 'non paye', 'non'].includes(s)) return 'PENDING';
    return undefined;
  }, z.enum(['PAID', 'PENDING']).optional()),
  cost_amount:       z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : cleanCurrencyValue(v)),
    z.coerce.number().nonnegative('cost_amount doit être positif ou nul').optional(),
  ),
  margin_amount:     z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : cleanCurrencyValue(v)),
    z.coerce.number().optional(),
  ),
}).superRefine((data, ctx) => {
  if (!data.commercial_email && !data.commercial_name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['commercial_email'],
      message: 'commercial_email ou commercial_name est requis (l\'un des deux suffit)',
    });
  }
});

export type DealRow = z.infer<typeof DealRowSchema>;

// ─── Types internes ──────────────────────────────────────────────────────────

interface ParsedRow {
  rowIndex: number;
  data: Record<string, unknown>;
}

interface ValidationResult {
  valid: DealRow[];
  errors: ImportRowError[];
}

// ─── Parsing fichier ─────────────────────────────────────────────────────────

// Les fonctions normalizeHeader / normalizeHeaders sont maintenant dans excelColumnMapper.service.ts
// On les ré-exporte pour rétrocompatibilité.
function normalizeHeader(h: string): string {
  return mapperNormalizeHeader(h).replace(/ /g, '_');
}

function normalizeHeaders(headers: string[]): string[] {
  return headers.map(normalizeHeader);
}

/**
 * Résultat du parsing avec le mapping détecté.
 */
interface ParseResult {
  rows: ParsedRow[];
  mapping: ColumnMapping;
  originalHeaders: string[];
}

/**
 * Sélectionne le meilleur onglet dans un classeur multi-onglets.
 * Retourne l'onglet avec le plus de colonnes du dictionnaire reconnues.
 */
function selectBestSheet(workbook: XLSX.WorkBook): { sheetName: string; sheet: XLSX.WorkSheet; mapping: ColumnMapping; headers: string[] } {
  let bestMatch: { sheetName: string; sheet: XLSX.WorkSheet; mapping: ColumnMapping; headers: string[]; score: number } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
    if (raw.length < 2) continue;

    const headers = (raw[0] as string[]).map((h) => String(h ?? ''));
    const mapping = detectColumnMapping(headers);
    const score = Object.keys(mapping.mapped).length;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { sheetName, sheet, mapping, headers, score };
    }
  }

  if (!bestMatch) throw new Error('Le fichier est vide ou ne contient pas de feuille de données exploitable');
  return bestMatch;
}

/**
 * Tente de fusionner un onglet secondaire (ex: onglet "Marge") avec les données principales.
 * Fusionne sur la clé (clientName, dealTitle).
 */
function mergeSecondarySheets(
  workbook: XLSX.WorkBook,
  primarySheetName: string,
  primaryRows: ParsedRow[],
  primaryMapping: ColumnMapping,
): void {
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === primarySheetName) continue;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
    if (raw.length < 2) continue;

    const headers = (raw[0] as string[]).map((h) => String(h ?? ''));
    const secondaryMapping = detectColumnMapping(headers);

    // L'onglet secondaire doit avoir au moins un champ d'identification + un champ enrichissement
    const hasId = secondaryMapping.mapped.clientName !== undefined || secondaryMapping.mapped.dealTitle !== undefined;
    const enrichFields: DealField[] = ['marginAmount', 'costAmount', 'notes', 'paymentStatus'];
    const hasEnrichment = enrichFields.some((f) => secondaryMapping.mapped[f] !== undefined && primaryMapping.mapped[f] === undefined);

    if (!hasId || !hasEnrichment) continue;

    // Construire un index des données secondaires
    const secondaryIndex = new Map<string, Record<string, unknown>>();
    for (let i = 1; i < raw.length; i++) {
      const cols = raw[i] as unknown[];
      if (cols.every((c) => c === '' || c === null || c === undefined)) continue;

      const rowData = extractRowWithMapping(cols, secondaryMapping);
      const key = `${String(rowData.client_name ?? '').toLowerCase().trim()}|${String(rowData.deal_name ?? '').toLowerCase().trim()}`;
      if (key !== '|') secondaryIndex.set(key, rowData);
    }

    // Fusionner les données enrichissantes dans les rows principales
    for (const row of primaryRows) {
      const key = `${String(row.data.client_name ?? '').toLowerCase().trim()}|${String(row.data.deal_name ?? '').toLowerCase().trim()}`;
      const secondary = secondaryIndex.get(key);
      if (!secondary) continue;

      for (const field of enrichFields) {
        const canonical = field === 'marginAmount' ? 'margin_amount'
          : field === 'costAmount' ? 'cost_amount'
          : field === 'paymentStatus' ? 'payment_status'
          : field;
        if (secondary[canonical] !== undefined && secondary[canonical] !== '' && !row.data[canonical]) {
          row.data[canonical] = secondary[canonical];
        }
      }
    }

    logger.info('[FileImport] Onglet secondaire fusionné', { sheetName, mergedFields: enrichFields.filter((f) => secondaryMapping.mapped[f] !== undefined) });
  }
}

function parseBuffer(
  buffer: Buffer,
  _originalName: string,
  customMapping?: Partial<Record<DealField, string>>,
): ParseResult {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    codepage: 65001,
    cellDates: true,
  });

  // Sélectionner le meilleur onglet (multi-onglets)
  const { sheetName, sheet, mapping: autoMapping, headers: originalHeaders } = selectBestSheet(workbook);

  // Appliquer le mapping custom si fourni (fallback manuel)
  let finalMapping = autoMapping;
  if (customMapping && Object.keys(customMapping).length > 0) {
    finalMapping = applyCustomMapping(autoMapping, customMapping, originalHeaders);
  }

  // Lire les données brutes
  const raw = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
  }) as unknown[][];

  if (raw.length < 2) throw new Error('Le fichier doit contenir au moins une ligne d\'en-tête et une ligne de données');

  // Extraire les lignes en utilisant le mapping
  const rows: ParsedRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const cols = raw[i] as unknown[];
    if (cols.every((c) => c === '' || c === null || c === undefined)) continue;

    const data = extractRowWithMapping(cols, finalMapping);
    rows.push({ rowIndex: i + 1, data });
  }

  // Tenter de fusionner les onglets secondaires (enrichissement marge, etc.)
  if (workbook.SheetNames.length > 1) {
    mergeSecondarySheets(workbook, sheetName, rows, finalMapping);
  }

  logger.info('[FileImport] Parsing terminé', {
    sheet: sheetName,
    totalSheets: workbook.SheetNames.length,
    mappedFields: Object.keys(finalMapping.mapped),
    unmappedHeaders: finalMapping.unmapped,
    missingRequired: finalMapping.missing,
  });

  return { rows, mapping: finalMapping, originalHeaders };
}

// ─── Validation Zod ligne par ligne ──────────────────────────────────────────

function validateRows(rows: ParsedRow[]): ValidationResult {
  const valid: DealRow[] = [];
  const errors: ImportRowError[] = [];

  for (const { rowIndex, data } of rows) {
    const result = DealRowSchema.safeParse(data);

    if (result.success) {
      // Vérification devise supportée
      const currency = result.data.currency.toUpperCase();
      if (!SUPPORTED_CURRENCIES.includes(currency)) {
        errors.push({
          row: rowIndex,
          column: 'currency',
          message: `Devise "${currency}" non supportée. Devises acceptées : ${SUPPORTED_CURRENCIES.join(', ')}`,
          value: currency,
        });
        continue;
      }
      valid.push({ ...result.data, currency });
    } else {
      for (const issue of result.error.issues) {
        errors.push({
          row: rowIndex,
          column: issue.path.join('.') || 'inconnu',
          message: issue.message,
          value: String(data[issue.path[0] as string] ?? ''),
        });
      }
    }
  }

  return { valid, errors };
}

// ─── Prévisualisation avant confirmation ─────────────────────────────────────

export async function previewImport(
  tenantId: string,
  uploadedBy: string,
  buffer: Buffer,
  originalName: string,
  customMapping?: Partial<Record<DealField, string>>,
): Promise<ImportPreview> {
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(`Fichier trop volumineux. Taille max : 10 MB`);
  }

  // 1. Parsing avec auto-détection des colonnes
  const { rows: parsedRows, mapping } = parseBuffer(buffer, originalName, customMapping);

  // 1b. Si des colonnes obligatoires manquent → retourner les infos de mapping
  //     Le frontend affichera alors l'UI de mapping manuel.
  if (mapping.missing.length > 0) {
    // On retourne un ImportPreview "vide" avec les infos de mapping
    // Le frontend détecte que mappingIncomplete === true et affiche le mapping manuel
    return {
      importLogId: '',
      totalRows: parsedRows.length,
      validRows: 0,
      errorRows: 0,
      duplicateRows: 0,
      unmatchedCommercials: 0,
      errors: [],
      unmatchedIdentifiers: [],
      sample: [],
      // Champs de mapping pour le frontend
      mappingIncomplete: true,
      mappingDetails: {
        mapped: Object.entries(mapping.mapped).map(([field, idx]) => ({
          field: field as DealField,
          label: mapping.fieldLabels[field] ?? field,
          columnIndex: idx!,
          columnName: mapping.allHeaders[idx!] ?? '',
        })),
        unmapped: mapping.unmapped,
        missing: mapping.missing.map((field, i) => ({
          field,
          label: mapping.missingLabels[i] ?? field,
        })),
        allHeaders: mapping.allHeaders,
        fieldLabels: mapping.fieldLabels,
      },
    } as ImportPreview;
  }

  // 2. Validation Zod
  const { valid, errors } = validateRows(parsedRows);

  // 3. Détection doublons (external_id déjà en BDD)
  let duplicateRows = 0;
  const duplicateExternalIds = new Set<string>();
  for (const row of valid) {
    const existing = await dealRepository.findByFileExternalId(row.external_id, tenantId);
    if (existing) {
      duplicateRows++;
      duplicateExternalIds.add(row.external_id);
    }
  }

  // 4. Matching commerciaux par email OU par nom
  const allUsers = await userRepository.findByTenantId(tenantId);
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
  const userByName = buildUserByNameMap(allUsers);

  const unmatchedIdentifiersSet = new Set<string>();
  for (const row of valid) {
    const user = findUserByCommercial(row, userByEmail, userByName);
    if (!user) {
      const identifier = row.commercial_email ?? row.commercial_name ?? '';
      if (identifier) unmatchedIdentifiersSet.add(identifier.toLowerCase());
    }
  }
  const unmatchedCommercials = unmatchedIdentifiersSet.size;

  // 5. Aperçu des 5 premières lignes valides
  const sample: ImportPreviewRow[] = valid.slice(0, 5).map((row) => {
    const user = findUserByCommercial(row, userByEmail, userByName);
    return {
      externalId: row.external_id,
      dealName: row.deal_name,
      amount: row.amount,
      currency: row.currency,
      closedAt: row.closed_at,
      commercialEmail: row.commercial_email ?? null,
      commercialIdentifier: row.commercial_email ?? row.commercial_name ?? '',
      commercialName: user ? `${user.firstName} ${user.lastName}` : null,
      clientName: row.client_name ?? null,
      dealType: row.deal_type ?? null,
      isDuplicate: duplicateExternalIds.has(row.external_id),
      isUnmatched: !user,
    };
  });

  // 6. Sauvegarder l'ImportLog en PENDING avec les lignes valides (pour confirmation ultérieure)
  const importLog = await importLogRepository.create({
    tenantId,
    uploadedBy,
    fileName: originalName,
    totalRows: parsedRows.length,
    errorRows: errors.length,
    errors,
    pendingRows: valid,
  });

  return {
    importLogId: importLog.id,
    totalRows: parsedRows.length,
    validRows: valid.length,
    errorRows: errors.length,
    duplicateRows,
    unmatchedCommercials,
    errors,
    unmatchedIdentifiers: Array.from(unmatchedIdentifiersSet),
    sample,
  };
}

// ─── Dédoublonnage ──────────────────────────────────────────────────────────

/**
 * Construit une clé de dédoublonnage normalisée : clientName|title|date (YYYY-MM-DD).
 * Deux deals avec la même clé sont considérés comme identiques.
 */
function buildDedupeKey(clientName: string, title: string, date: Date): string {
  const normalizedClient = clientName.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return `${normalizedClient}|${normalizedTitle}|${normalizedDate}`;
}

/**
 * Cherche un deal existant qui matche la clé de dédoublonnage.
 * Recherche insensible à la casse sur clientName et title, et même jour sur closedAt.
 */
async function findDealByDedupeKey(
  tenantId: string,
  clientName: string,
  title: string,
  date: Date,
): Promise<import('@prisma/client').Deal | null> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  return prisma.deal.findFirst({
    where: {
      tenantId,
      clientName: { equals: clientName.trim(), mode: 'insensitive' },
      title: { equals: title.trim(), mode: 'insensitive' },
      closedAt: { gte: dayStart, lte: dayEnd },
    },
  });
}

// ─── Types pour les snapshots de deals mis à jour ───────────────────────────

interface DealSnapshot {
  dealId: string;
  previousValues: Record<string, unknown>;
  previousImportBatchId: string | null;
}

// ─── Helpers calcul marge ───────────────────────────────────────────────────

function computeMarginFields(row: DealRow): {
  costAmount: number | null;
  marginAmount: number | null;
  marginSource: string | null;
} {
  let costAmount: number | null = null;
  let marginAmount: number | null = null;
  let marginSource: string | null = null;

  if (row.margin_amount !== undefined) {
    marginAmount = row.margin_amount;
    marginSource = 'CSV_IMPORT';
    costAmount = row.cost_amount !== undefined ? row.cost_amount : row.amount - row.margin_amount;
  } else if (row.cost_amount !== undefined) {
    costAmount = row.cost_amount;
    marginAmount = row.amount - row.cost_amount;
    marginSource = 'CSV_IMPORT';
  }

  return { costAmount, marginAmount, marginSource };
}

// ─── Gestion commissions post-import ────────────────────────────────────────

async function handlePostImportCommissions(
  dealId: string,
  tenantId: string,
  paymentStatus: string | undefined,
  closedAt: Date | null,
): Promise<void> {
  await commissionService.recalculateForDeal(dealId, tenantId);

  const now = new Date();
  const closedDate = closedAt ?? now;

  if (paymentStatus === 'PAID') {
    await prisma.commission.updateMany({
      where: { dealId, tenantId, status: PrismaCommissionStatus.PENDING },
      data: {
        status: PrismaCommissionStatus.VALIDATED,
        validatedAt: closedDate,
        awaitingClientPayment: false,
        clientPaidAt: closedDate,
      },
    });
  } else if (paymentStatus === 'PENDING') {
    await prisma.commission.updateMany({
      where: { dealId, tenantId, status: PrismaCommissionStatus.PENDING },
      data: { awaitingClientPayment: true },
    });
  }
}

// ─── Confirmation de l'import (avec dédoublonnage + ImportBatch) ─────────────

export async function confirmImport(
  importLogId: string,
  tenantId: string,
): Promise<FileImportConfirmResult> {
  const importLog = await importLogRepository.findById(importLogId);
  if (!importLog) throw new Error('Import introuvable');
  if (importLog.tenantId !== tenantId) throw new Error('Accès non autorisé à cet import');
  if (importLog.status !== 'PENDING') throw new Error('Cet import a déjà été traité');

  const pendingRows = importLog.pendingRows as DealRow[] | null;
  if (!pendingRows || pendingRows.length === 0) {
    await importLogRepository.update(importLogId, {
      status: 'SUCCESS',
      successRows: 0,
      skippedRows: 0,
      completedAt: new Date(),
      pendingRows: null,
    });
    return { created: 0, skipped: 0, errors: 0, importLogId };
  }

  await importLogRepository.update(importLogId, { status: 'PROCESSING' });

  // Déterminer la source du fichier
  const ext = importLog.fileName.split('.').pop()?.toLowerCase() ?? '';
  const importSource: PrismaImportSource = ext === 'csv' ? 'CSV' : 'XLSX';

  // Créer le batch (compteurs mis à jour à la fin)
  const batch = await prisma.importBatch.create({
    data: {
      tenantId,
      importedBy: importLog.uploadedBy,
      source: importSource,
      originalFileName: importLog.fileName,
      totalRows: pendingRows.length,
      createdRows: 0,
      updatedRows: 0,
      errorRows: 0,
      status: 'COMPLETED',
    },
  });

  const allUsers = await userRepository.findByTenantId(tenantId);
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
  const userByName = buildUserByNameMap(allUsers);

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  const confirmErrors: ImportRowError[] = [];
  const updatedDealSnapshots: DealSnapshot[] = [];

  // Map des deals déjà traités dans ce fichier (dédoublonnage interne)
  const processedDedupeKeys = new Map<string, string>(); // dedupeKey → dealId

  for (let i = 0; i < pendingRows.length; i++) {
    const row = pendingRows[i];
    try {
      const user = findUserByCommercial(row, userByEmail, userByName);
      const { costAmount, marginAmount, marginSource } = computeMarginFields(row);
      const closedAt = new Date(row.closed_at);

      // ── Étape 1 : chercher un doublon ──

      // D'abord par external_id (le plus fiable)
      let existingDeal = await dealRepository.findByFileExternalId(row.external_id, tenantId);

      // Ensuite par clé de dédoublonnage (clientName + title + date)
      if (!existingDeal && row.client_name) {
        const dedupeKey = buildDedupeKey(row.client_name, row.deal_name, closedAt);

        // Vérifier les doublons internes au fichier
        const internalDealId = processedDedupeKeys.get(dedupeKey);
        if (internalDealId) {
          existingDeal = await prisma.deal.findUnique({ where: { id: internalDealId } });
        }

        // Vérifier en base
        if (!existingDeal) {
          existingDeal = await findDealByDedupeKey(tenantId, row.client_name, row.deal_name, closedAt);
        }
      }

      if (existingDeal) {
        // ── Deal existant → UPDATE (le nouvel import a toujours raison) ──

        // Sauvegarder l'ancien état pour le rollback
        const previousValues: Record<string, unknown> = {
          title: existingDeal.title,
          clientName: existingDeal.clientName,
          amount: existingDeal.amount,
          currency: existingDeal.currency,
          status: existingDeal.status,
          assignedToId: existingDeal.assignedToId,
          closedAt: existingDeal.closedAt?.toISOString() ?? null,
          dealType: existingDeal.dealType,
          notes: existingDeal.notes,
          costAmount: existingDeal.costAmount,
          marginAmount: existingDeal.marginAmount,
          marginSource: existingDeal.marginSource,
          fileExternalId: existingDeal.fileExternalId,
        };

        updatedDealSnapshots.push({
          dealId: existingDeal.id,
          previousValues,
          previousImportBatchId: existingDeal.importBatchId ?? null,
        });

        // Vérifier si des champs impactant les commissions ont changé
        const amountChanged = existingDeal.amount !== row.amount;
        const statusChanged = existingDeal.status !== DealStatus.WON;
        const marginChanged = marginAmount !== null && existingDeal.marginAmount !== marginAmount;

        // Mise à jour du deal
        await prisma.deal.update({
          where: { id: existingDeal.id },
          data: {
            title: row.deal_name,
            clientName: row.client_name ?? existingDeal.clientName,
            amount: row.amount,
            currency: row.currency,
            status: DealStatus.WON,
            assignedToId: user?.id ?? existingDeal.assignedToId,
            closedAt,
            dealType: row.deal_type ?? existingDeal.dealType,
            notes: row.notes ?? existingDeal.notes,
            fileExternalId: row.external_id || existingDeal.fileExternalId,
            costAmount: costAmount ?? existingDeal.costAmount,
            marginAmount: marginAmount ?? existingDeal.marginAmount,
            marginSource: marginSource ?? existingDeal.marginSource,
            importBatchId: batch.id,
            importLogId: importLogId,
          },
        });

        // Recalculer les commissions si des champs impactants ont changé
        if (user && (amountChanged || statusChanged || marginChanged)) {
          try {
            await handlePostImportCommissions(existingDeal.id, tenantId, row.payment_status, closedAt);
          } catch (commErr) {
            logger.warn('Erreur recalcul commission lors update deal import', {
              dealId: existingDeal.id,
              error: commErr,
            });
          }
        }

        // Tracker la dedupeKey pour les doublons internes au fichier
        if (row.client_name) {
          const dedupeKey = buildDedupeKey(row.client_name, row.deal_name, closedAt);
          processedDedupeKeys.set(dedupeKey, existingDeal.id);
        }

        updatedCount++;
      } else {
        // ── Nouveau deal → CREATE ──

        const deal = await dealRepository.createFromFileImport({
          tenantId,
          fileExternalId: row.external_id,
          title: row.deal_name,
          clientName: row.client_name ?? null,
          amount: row.amount,
          currency: row.currency,
          status: DealStatus.WON,
          assignedToId: user?.id ?? null,
          closedAt,
          dealType: row.deal_type ?? null,
          notes: row.notes ?? null,
          importLogId,
          costAmount,
          marginAmount,
          marginSource,
        });

        // Rattacher au batch
        await prisma.deal.update({
          where: { id: deal.id },
          data: { importBatchId: batch.id },
        });

        // Déclencher le moteur de commissions si le commercial est reconnu
        if (user) {
          try {
            await handlePostImportCommissions(deal.id, tenantId, row.payment_status, closedAt);
          } catch (commErr) {
            logger.warn('Erreur calcul commission lors import fichier', {
              dealId: deal.id,
              error: commErr,
            });
          }
        }

        // Tracker la dedupeKey pour les doublons internes au fichier
        if (row.client_name) {
          const dedupeKey = buildDedupeKey(row.client_name, row.deal_name, closedAt);
          processedDedupeKeys.set(dedupeKey, deal.id);
        }

        createdCount++;
      }
    } catch (err) {
      errorCount++;
      confirmErrors.push({
        row: i + 2,
        column: 'général',
        message: err instanceof Error ? err.message : 'Erreur inconnue',
      });
      logger.error('Erreur traitement deal lors import fichier', { row, error: err });
    }
  }

  // Mettre à jour le batch avec les compteurs finaux et les snapshots
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      createdRows: createdCount,
      updatedRows: updatedCount,
      errorRows: errorCount,
      updatedDealSnapshots: updatedDealSnapshots.length > 0 ? updatedDealSnapshots as unknown as import('@prisma/client').Prisma.JsonArray : undefined,
      importErrors: confirmErrors.length > 0 ? confirmErrors as unknown as import('@prisma/client').Prisma.JsonArray : undefined,
    },
  });

  const finalStatus = errorCount > 0 ? 'PARTIAL_ERROR' : 'SUCCESS';

  await importLogRepository.update(importLogId, {
    status: finalStatus,
    successRows: createdCount,
    skippedRows: updatedCount, // "skipped" = mis à jour dans le nouveau paradigme
    errorRows: errorCount,
    errors: confirmErrors,
    completedAt: new Date(),
    pendingRows: null, // Nettoyage RGPD
  });

  return {
    created: createdCount,
    skipped: updatedCount,
    errors: errorCount,
    importLogId,
    batchId: batch.id,
  };
}

// ─── Helpers matching commercial ─────────────────────────────────────────────

type UserRecord = { id: string; email: string; firstName: string; lastName: string };

/**
 * Construit une Map nom→utilisateur (prénom nom ET nom prénom, insensible à la casse).
 */
function buildUserByNameMap(users: UserRecord[]): Map<string, UserRecord> {
  const map = new Map<string, UserRecord>();
  for (const u of users) {
    const fn = `${u.firstName} ${u.lastName}`.toLowerCase().trim();
    const ln = `${u.lastName} ${u.firstName}`.toLowerCase().trim();
    map.set(fn, u);
    map.set(ln, u);
  }
  return map;
}

/**
 * Trouve un utilisateur d'abord par email, ensuite par nom complet.
 */
function findUserByCommercial(
  row: DealRow,
  userByEmail: Map<string, UserRecord>,
  userByName: Map<string, UserRecord>,
): UserRecord | undefined {
  if (row.commercial_email) {
    const u = userByEmail.get(row.commercial_email.toLowerCase());
    if (u) return u;
  }
  if (row.commercial_name) {
    return userByName.get(row.commercial_name.toLowerCase().trim());
  }
  return undefined;
}

// ─── Exports pour tests unitaires ────────────────────────────────────────────

export {
  parseBuffer,
  validateRows,
  normalizeHeader,
  normalizeHeaders,
  buildUserByNameMap,
  findUserByCommercial,
  buildDedupeKey,
  DealRowSchema,
  SUPPORTED_CURRENCIES,
};
