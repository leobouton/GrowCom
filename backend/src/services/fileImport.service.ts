/**
 * fileImport.service.ts
 * Service d'import de fichiers Excel/CSV vers le schéma Deal normalisé.
 * N'interagit pas avec le code Odoo.
 */

import * as XLSX from 'xlsx';
import { z } from 'zod';
import { DealStatus } from '@prisma/client';
import { dealRepository } from '../repositories/deal.repository';
import { importLogRepository } from '../repositories/importLog.repository';
import { userRepository } from '../repositories/user.repository';
import { commissionService } from './commission.service';
import { logger } from '../config/logger';
import type { ImportPreview, ImportPreviewRow, ImportRowError, FileImportConfirmResult } from '../../../shared/types';

// ─── Constantes ──────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'];

// ─── Aliases de colonnes CRM → noms canoniques ───────────────────────────────
// Permet de lire les exports de n'importe quel CRM sans renommer les colonnes.

const COLUMN_ALIASES: Record<string, string> = {
  // Identification du commercial — via email
  salesperson_email:  'commercial_email',
  rep_email:          'commercial_email',
  user_email:         'commercial_email',
  email_commercial:   'commercial_email',
  mail_commercial:    'commercial_email',
  // Identification du commercial — via nom
  salesperson:        'commercial_name',
  commercial:         'commercial_name',
  owner:              'commercial_name',
  assigned_to:        'commercial_name',
  vendeur:            'commercial_name',
  rep:                'commercial_name',
  representative:     'commercial_name',
  responsable:        'commercial_name',
  charge_de_compte:   'commercial_name',
  // Nom du deal
  opportunity:        'deal_name',
  objet:              'deal_name',
  titre:              'deal_name',
  name:               'deal_name',
  // Montant
  value:              'amount',
  revenue:            'amount',
  total:              'amount',
  montant:            'amount',
  valeur:             'amount',
  chiffre_affaires:   'amount',
  ca:                 'amount',
  // Date de clôture
  close_date:         'closed_at',
  closing_date:       'closed_at',
  won_at:             'closed_at',
  date_cloture:       'closed_at',
  close_at:           'closed_at',
  cloture:            'closed_at',
  // Identifiant unique
  opportunity_id:     'external_id',
  deal_id:            'external_id',
  crm_id:             'external_id',
  reference:          'external_id',
  ref:                'external_id',
  // Coût du deal
  cost:               'cost_amount',
  cout:               'cost_amount',
  coût:               'cost_amount',
  // Marge
  marge:              'margin_amount',
};

// ─── Schéma Zod de validation d'une ligne ────────────────────────────────────

const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const DealRowSchema = z.object({
  external_id:       z.string().min(1, 'external_id est requis'),
  deal_name:         z.string().min(1, 'deal_name est requis'),
  amount:            z.coerce.number({ invalid_type_error: 'amount doit être un nombre' }).nonnegative('amount doit être positif ou nul'),
  currency:          z.string().regex(/^[A-Z]{3}$/, 'currency doit être un code ISO 3 lettres (ex: EUR)').default('EUR'),
  closed_at:         z.string().regex(dateRegex, 'closed_at doit être une date ISO 8601 (ex: 2024-01-15)'),
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
  cost_amount:       z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().nonnegative('cost_amount doit être positif ou nul').optional(),
  ),
  margin_amount:     z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
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

function normalizeHeaders(headers: string[]): string[] {
  return headers.map((h) =>
    String(h).trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_'),
  );
}

/**
 * Applique les alias CRM : si une colonne porte un nom connu (ex: "salesperson"),
 * elle est renommée vers son nom canonique (ex: "commercial_name").
 * Les colonnes déjà au bon nom ne sont pas touchées.
 */
function applyColumnAliases(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...obj };
  for (const [alias, canonical] of Object.entries(COLUMN_ALIASES)) {
    if (alias in obj && !(canonical in obj)) {
      result[canonical] = obj[alias];
      delete result[alias];
    }
  }
  return result;
}

function parseBuffer(buffer: Buffer, originalName: string): ParsedRow[] {
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    codepage: 65001, // UTF-8 en priorité
    raw: false,
    cellDates: false, // On veut les strings pour les dates
  });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Le fichier est vide ou ne contient pas de feuille de données');

  const raw = (XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
  }) as unknown) as unknown[][];

  if (raw.length < 2) throw new Error('Le fichier doit contenir au moins une ligne d\'en-tête et une ligne de données');

  const headers = normalizeHeaders(raw[0] as string[]);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const cols = raw[i] as unknown[];
    // Ignorer les lignes complètement vides
    if (cols.every((c) => c === '' || c === null || c === undefined)) continue;

    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? '';
    });
    rows.push({ rowIndex: i + 1, data: applyColumnAliases(obj) }); // +1 car ligne 1 = en-têtes
  }

  void ext; // utilisé implicitement via XLSX.read
  return rows;
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
): Promise<ImportPreview> {
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(`Fichier trop volumineux. Taille max : 10 MB`);
  }

  // 1. Parsing
  const parsedRows = parseBuffer(buffer, originalName);

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

// ─── Confirmation de l'import ─────────────────────────────────────────────────

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

  const allUsers = await userRepository.findByTenantId(tenantId);
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
  const userByName = buildUserByNameMap(allUsers);

  let created = 0;
  let skipped = 0;
  let errorCount = 0;
  const confirmErrors: ImportRowError[] = [];

  for (let i = 0; i < pendingRows.length; i++) {
    const row = pendingRows[i];
    try {
      // Vérification doublon au moment de la confirmation
      const existing = await dealRepository.findByFileExternalId(row.external_id, tenantId);
      if (existing) {
        skipped++;
        confirmErrors.push({
          row: i + 2,
          column: 'external_id',
          message: `Deal avec external_id "${row.external_id}" déjà importé — ignoré`,
        });
        continue;
      }

      const user = findUserByCommercial(row, userByEmail, userByName);

      // Calcul marge depuis le CSV
      let costAmount: number | null = null;
      let marginAmount: number | null = null;
      let marginSource: string | null = null;

      if (row.margin_amount !== undefined) {
        marginAmount = row.margin_amount;
        marginSource = 'CSV_IMPORT';
        if (row.cost_amount !== undefined) {
          costAmount = row.cost_amount;
        } else {
          costAmount = row.amount - row.margin_amount;
        }
      } else if (row.cost_amount !== undefined) {
        costAmount = row.cost_amount;
        marginAmount = row.amount - row.cost_amount;
        marginSource = 'CSV_IMPORT';
      }

      const deal = await dealRepository.createFromFileImport({
        tenantId,
        fileExternalId: row.external_id,
        title: row.deal_name,
        clientName: row.client_name ?? null,
        amount: row.amount,
        currency: row.currency,
        status: DealStatus.WON,
        assignedToId: user?.id ?? null,
        closedAt: new Date(row.closed_at),
        dealType: row.deal_type ?? null,
        notes: row.notes ?? null,
        importLogId,
        costAmount,
        marginAmount,
        marginSource,
      });

      // Déclencher le moteur de commissions si le commercial est reconnu
      if (user) {
        try {
          await commissionService.recalculateForDeal(deal.id, tenantId);
        } catch (commErr) {
          logger.warn('Erreur calcul commission lors import fichier', {
            dealId: deal.id,
            error: commErr,
          });
        }
      }

      created++;
    } catch (err) {
      errorCount++;
      confirmErrors.push({
        row: i + 2,
        column: 'général',
        message: err instanceof Error ? err.message : 'Erreur inconnue',
      });
      logger.error('Erreur création deal lors import fichier', { row, error: err });
    }
  }

  const finalStatus = errorCount > 0 ? 'PARTIAL_ERROR' : 'SUCCESS';

  await importLogRepository.update(importLogId, {
    status: finalStatus,
    successRows: created,
    skippedRows: skipped,
    errorRows: errorCount,
    errors: confirmErrors,
    completedAt: new Date(),
    pendingRows: null, // Nettoyage RGPD
  });

  return { created, skipped, errors: errorCount, importLogId };
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
  normalizeHeaders,
  applyColumnAliases,
  buildUserByNameMap,
  findUserByCommercial,
  DealRowSchema,
  SUPPORTED_CURRENCIES,
};
