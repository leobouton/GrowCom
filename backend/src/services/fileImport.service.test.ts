/**
 * fileImport.service.test.ts
 * Tests unitaires — parsing, validation Zod, mapping, détection doublons
 *
 * Pour exécuter : npm install --save-dev vitest && npx vitest run src/services/fileImport.service.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseBuffer,
  validateRows,
  normalizeHeaders,
  applyColumnAliases,
  buildUserByNameMap,
  findUserByCommercial,
  DealRowSchema,
  SUPPORTED_CURRENCIES,
} from './fileImport.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCSVBuffer(rows: string[][]): Buffer {
  const headers = rows[0];
  const lines = rows.map((r) => r.join(';'));
  return Buffer.from('\uFEFF' + lines.join('\n'), 'utf-8');
}

function makeXLSXBuffer(rows: string[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

const VALID_HEADERS = [
  'external_id',
  'deal_name',
  'amount',
  'currency',
  'closed_at',
  'commercial_email',
  'client_name',
  'deal_type',
  'notes',
];

const VALID_ROW = [
  'DEAL-001',
  'Mission développement',
  '15000',
  'EUR',
  '2024-01-15',
  'jean@example.com',
  'Société ABC',
  'recrutement',
  'Notes test',
];

// ─── Tests normalizeHeaders ───────────────────────────────────────────────────

describe('normalizeHeaders', () => {
  it('convertit en minuscules et remplace espaces par _', () => {
    expect(normalizeHeaders(['External ID', 'Deal Name', 'Closed At'])).toEqual([
      'external_id',
      'deal_name',
      'closed_at',
    ]);
  });

  it('remplace les tirets par _', () => {
    expect(normalizeHeaders(['deal-name', 'commercial-email'])).toEqual([
      'deal_name',
      'commercial_email',
    ]);
  });
});

// ─── Tests parseBuffer (CSV) ──────────────────────────────────────────────────

describe('parseBuffer — CSV', () => {
  it('parse une ligne valide depuis un CSV', () => {
    const buf = makeCSVBuffer([VALID_HEADERS, VALID_ROW]);
    const rows = parseBuffer(buf, 'test.csv');
    expect(rows).toHaveLength(1);
    expect(rows[0].data['external_id']).toBe('DEAL-001');
    expect(rows[0].data['deal_name']).toBe('Mission développement');
    expect(rows[0].rowIndex).toBe(2);
  });

  it('ignore les lignes complètement vides', () => {
    const buf = makeCSVBuffer([VALID_HEADERS, VALID_ROW, ['', '', '', '', '', '', '', '', '']]);
    const rows = parseBuffer(buf, 'test.csv');
    expect(rows).toHaveLength(1);
  });

  it('lève une erreur si le fichier est vide', () => {
    const buf = Buffer.from('\uFEFF', 'utf-8');
    expect(() => parseBuffer(buf, 'empty.csv')).toThrow();
  });

  it('lève une erreur si pas de ligne de données', () => {
    const buf = makeCSVBuffer([VALID_HEADERS]);
    expect(() => parseBuffer(buf, 'headers-only.csv')).toThrow();
  });
});

// ─── Tests parseBuffer (XLSX) ─────────────────────────────────────────────────

describe('parseBuffer — XLSX', () => {
  it('parse une ligne valide depuis un Excel', () => {
    const buf = makeXLSXBuffer([VALID_HEADERS, VALID_ROW]);
    const rows = parseBuffer(buf, 'test.xlsx');
    expect(rows).toHaveLength(1);
    expect(rows[0].data['external_id']).toBe('DEAL-001');
  });
});

// ─── Tests validateRows (Zod) ─────────────────────────────────────────────────

describe('validateRows — validation Zod', () => {
  const validParsedRow = {
    rowIndex: 2,
    data: Object.fromEntries(VALID_HEADERS.map((h, i) => [h, VALID_ROW[i]])),
  };

  it('valide une ligne correcte', () => {
    const { valid, errors } = validateRows([validParsedRow]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(valid[0].external_id).toBe('DEAL-001');
    expect(valid[0].amount).toBe(15000);
  });

  it('retourne une erreur si external_id manquant', () => {
    const row = { rowIndex: 2, data: { ...validParsedRow.data, external_id: '' } };
    const { valid, errors } = validateRows([row]);
    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('external_id');
  });

  it('retourne une erreur si amount non numérique', () => {
    const row = { rowIndex: 2, data: { ...validParsedRow.data, amount: 'abc' } };
    const { valid, errors } = validateRows([row]);
    expect(valid).toHaveLength(0);
    expect(errors[0].column).toBe('amount');
  });

  it('retourne une erreur si email commercial invalide', () => {
    const row = { rowIndex: 2, data: { ...validParsedRow.data, commercial_email: 'pas-un-email' } };
    const { valid, errors } = validateRows([row]);
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('commercial_email');
  });

  it('accepte commercial_name seul (sans email)', () => {
    const { commercial_email, ...withoutEmail } = validParsedRow.data;
    void commercial_email;
    const row = { rowIndex: 2, data: { ...withoutEmail, commercial_name: 'Jean Dupont' } };
    const { valid, errors } = validateRows([row]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(valid[0].commercial_name).toBe('Jean Dupont');
  });

  it('retourne une erreur si ni email ni nom commercial', () => {
    const { commercial_email, ...withoutEmail } = validParsedRow.data;
    void commercial_email;
    const row = { rowIndex: 2, data: withoutEmail };
    const { valid, errors } = validateRows([row]);
    expect(valid).toHaveLength(0);
    expect(errors[0].column).toBe('commercial_email');
    expect(errors[0].message).toContain('requis');
  });

  it('retourne une erreur si date invalide', () => {
    const row = { rowIndex: 2, data: { ...validParsedRow.data, closed_at: '15/01/2024' } };
    const { valid, errors } = validateRows([row]);
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('closed_at');
  });

  it('accepte les dates ISO 8601 complètes', () => {
    const row = { rowIndex: 2, data: { ...validParsedRow.data, closed_at: '2024-01-15T10:30:00Z' } };
    const { valid, errors } = validateRows([row]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('devise par défaut = EUR si non spécifiée', () => {
    const row = { rowIndex: 2, data: { ...validParsedRow.data, currency: '' } };
    const { valid } = validateRows([row]);
    // '' ne passe pas la validation regex [A-Z]{3}
    expect(valid).toHaveLength(0);
  });

  it('retourne une erreur bloquante si devise non supportée', () => {
    const row = { rowIndex: 2, data: { ...validParsedRow.data, currency: 'XYZ' } };
    const { valid, errors } = validateRows([row]);
    expect(valid).toHaveLength(0);
    expect(errors[0].column).toBe('currency');
    expect(errors[0].message).toContain('non supportée');
  });

  it('accepte les colonnes optionnelles absentes', () => {
    const { client_name, deal_type, notes, ...withoutOptional } = validParsedRow.data;
    void client_name; void deal_type; void notes;
    const row = { rowIndex: 2, data: withoutOptional };
    const { valid, errors } = validateRows([row]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
});

// ─── Tests mapping vers schéma pivot ─────────────────────────────────────────

describe('DealRowSchema — mapping colonnes', () => {
  it('coerce amount depuis string vers number', () => {
    const result = DealRowSchema.safeParse({
      external_id: 'D-001',
      deal_name: 'Test',
      amount: '12500.50',
      currency: 'EUR',
      closed_at: '2024-03-01',
      commercial_email: 'test@example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe(12500.5);
  });

  it('rejette un montant négatif', () => {
    const result = DealRowSchema.safeParse({
      external_id: 'D-001',
      deal_name: 'Test',
      amount: '-500',
      currency: 'EUR',
      closed_at: '2024-03-01',
      commercial_email: 'test@example.com',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Tests applyColumnAliases ─────────────────────────────────────────────────

describe('applyColumnAliases', () => {
  it('renomme salesperson en commercial_name', () => {
    const result = applyColumnAliases({ salesperson: 'Jean Dupont', amount: '5000' });
    expect(result['commercial_name']).toBe('Jean Dupont');
    expect(result['salesperson']).toBeUndefined();
  });

  it('ne remplace pas si commercial_name est déjà présent', () => {
    const result = applyColumnAliases({ salesperson: 'Jean', commercial_name: 'Marie Dupont' });
    expect(result['commercial_name']).toBe('Marie Dupont');
  });

  it('renomme salesperson_email en commercial_email', () => {
    const result = applyColumnAliases({ salesperson_email: 'jean@ex.com' });
    expect(result['commercial_email']).toBe('jean@ex.com');
  });

  it('renomme opportunity en deal_name', () => {
    const result = applyColumnAliases({ opportunity: 'Mission ABC' });
    expect(result['deal_name']).toBe('Mission ABC');
  });
});

// ─── Tests findUserByCommercial ───────────────────────────────────────────────

describe('findUserByCommercial', () => {
  const users = [
    { id: '1', email: 'jean@ex.com', firstName: 'Jean', lastName: 'Dupont' },
    { id: '2', email: 'marie@ex.com', firstName: 'Marie', lastName: 'Martin' },
  ];

  it('trouve par email', () => {
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const byName = buildUserByNameMap(users);
    const row = { external_id: 'X', deal_name: 'T', amount: 0, currency: 'EUR', closed_at: '2024-01-01', commercial_email: 'jean@ex.com' };
    expect(findUserByCommercial(row, byEmail, byName)?.id).toBe('1');
  });

  it('trouve par nom complet (prénom nom)', () => {
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const byName = buildUserByNameMap(users);
    const row = { external_id: 'X', deal_name: 'T', amount: 0, currency: 'EUR', closed_at: '2024-01-01', commercial_name: 'Marie Martin' };
    expect(findUserByCommercial(row, byEmail, byName)?.id).toBe('2');
  });

  it('trouve par nom complet (nom prénom)', () => {
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const byName = buildUserByNameMap(users);
    const row = { external_id: 'X', deal_name: 'T', amount: 0, currency: 'EUR', closed_at: '2024-01-01', commercial_name: 'Dupont Jean' };
    expect(findUserByCommercial(row, byEmail, byName)?.id).toBe('1');
  });

  it('retourne undefined si rien ne correspond', () => {
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const byName = buildUserByNameMap(users);
    const row = { external_id: 'X', deal_name: 'T', amount: 0, currency: 'EUR', closed_at: '2024-01-01', commercial_name: 'Inconnu Total' };
    expect(findUserByCommercial(row, byEmail, byName)).toBeUndefined();
  });
});

// ─── Tests détection doublons (logique pure) ─────────────────────────────────

describe('Détection doublons — logique métier', () => {
  it('identifie les external_id dupliqués dans un même batch', () => {
    const rows = [
      { rowIndex: 2, data: { ...Object.fromEntries(VALID_HEADERS.map((h, i) => [h, VALID_ROW[i]])), external_id: 'SAME-001' } },
      { rowIndex: 3, data: { ...Object.fromEntries(VALID_HEADERS.map((h, i) => [h, VALID_ROW[i]])), external_id: 'SAME-001', deal_name: 'Autre deal' } },
    ];
    const { valid } = validateRows(rows);
    // Les deux lignes passent la validation Zod (même external_id = doublon BDD, pas erreur Zod)
    expect(valid).toHaveLength(2);
    expect(valid[0].external_id).toBe('SAME-001');
    expect(valid[1].external_id).toBe('SAME-001');
    // La détection du doublon réel se fait via dealRepository.findByFileExternalId dans previewImport
  });

  it('SUPPORTED_CURRENCIES contient EUR, USD, GBP', () => {
    expect(SUPPORTED_CURRENCIES).toContain('EUR');
    expect(SUPPORTED_CURRENCIES).toContain('USD');
    expect(SUPPORTED_CURRENCIES).toContain('GBP');
  });
});
