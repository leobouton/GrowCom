/**
 * excelColumnMapper.service.ts
 * Moteur d'auto-détection des colonnes pour l'import Excel/CSV.
 * Mappe les en-têtes de fichiers CRM variés vers les champs Deal normalisés.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type DealField =
  | 'clientName'
  | 'dealTitle'
  | 'amount'
  | 'marginAmount'
  | 'costAmount'
  | 'closedDate'
  | 'expectedCloseDate'
  | 'stage'
  | 'assignedToEmail'
  | 'assignedToName'
  | 'notes'
  | 'externalId'
  | 'currency'
  | 'dealType'
  | 'paymentStatus';

interface FieldSynonyms {
  field: DealField;
  required: boolean;
  label: string; // Libellé français pour l'UI
  synonyms: string[]; // Tous en lowercase, sans accent, espaces normalisés
}

// ─── Dictionnaire de synonymes ──────────────────────────────────────────────

const FIELD_DICTIONARY: FieldSynonyms[] = [
  {
    field: 'externalId',
    required: true,
    label: 'Identifiant unique',
    synonyms: [
      'external id', 'external_id', 'opportunity id', 'deal id', 'crm id',
      'reference', 'ref', 'id', 'identifiant', 'numero', 'no', 'num',
      'n facture', 'numero facture', 'num facture', 'facture', 'no facture',
    ],
  },
  {
    field: 'dealTitle',
    required: true,
    label: 'Titre du deal',
    synonyms: [
      'titre', 'title', 'deal', 'affaire', 'opportunite', 'opportunity',
      'mission', 'projet', 'name', 'libelle', 'objet', 'description courte',
      'nom', 'nom du deal', 'nom opportunite', 'designation', 'intitule',
      'nom affaire', 'deal name', 'deal_name',
      'produit service', 'produit', 'prestation',
    ],
  },
  {
    field: 'amount',
    required: true,
    label: 'Montant',
    synonyms: [
      'montant', 'amount', 'value', 'valeur', 'ca',
      'chiffre affaires', 'chiffre d affaires', 'prix', 'revenue',
      'expected revenue', 'total', 'ht', 'montant ht', 'montant total',
      'montant ttc', 'prix vente', 'chiffre affaire', 'ca ht',
    ],
  },
  {
    field: 'closedDate',
    required: true,
    label: 'Date de clôture',
    synonyms: [
      'date signature', 'date de signature', 'closed date', 'won date',
      'date gagne', 'date cloture', 'date close', 'closure date',
      'date facturation', 'close date', 'closing date', 'won at',
      'date fermeture', 'date vente', 'ferme le', 'date', 'date closing',
      'closed at', 'close at', 'cloture',
    ],
  },
  {
    field: 'clientName',
    required: false,
    label: 'Nom du client',
    synonyms: [
      'client', 'customer', 'compte', 'entreprise', 'account',
      'societe', 'organisation', 'company', 'nom du client',
      'raison sociale', 'denomination', 'nom client',
    ],
  },
  {
    field: 'marginAmount',
    required: false,
    label: 'Marge',
    synonyms: [
      'marge', 'margin', 'profit', 'benefice', 'gross margin',
      'marge brute', 'marge nette', 'profit brut', 'margin amount',
    ],
  },
  {
    field: 'costAmount',
    required: false,
    label: 'Coût',
    synonyms: [
      'cout', 'cost', 'achat', 'planned cost', 'cout achat',
      'cout total', 'sous traitance', 'cost amount',
    ],
  },
  {
    field: 'expectedCloseDate',
    required: false,
    label: 'Date prévue',
    synonyms: [
      'date prevue', 'expected close', 'closing date prevue', 'date prevu',
      'echeance', 'deadline', 'date previsionnelle', 'expected close date',
    ],
  },
  {
    field: 'stage',
    required: false,
    label: 'Étape / Statut',
    synonyms: [
      'stage', 'etape', 'statut', 'status', 'phase', 'etat',
      'pipeline stage', 'pipeline',
    ],
  },
  {
    field: 'assignedToEmail',
    required: false,
    label: 'Email du commercial',
    synonyms: [
      'email commercial', 'sales owner', 'salesperson email', 'rep email',
      'user email', 'email', 'mail commercial', 'email vendeur',
      'commercial email',
    ],
  },
  {
    field: 'assignedToName',
    required: false,
    label: 'Nom du commercial',
    synonyms: [
      'commercial', 'sales rep', 'owner', 'attribue', 'assigne',
      'responsable', 'vendeur', 'salesperson', 'commercial name',
      'nom commercial', 'nom vendeur', 'charge de compte',
      'assigned to', 'representative', 'rep',
    ],
  },
  {
    field: 'notes',
    required: false,
    label: 'Notes',
    synonyms: [
      'notes', 'commentaire', 'commentaires', 'remarques', 'comment',
      'description',
    ],
  },
  {
    field: 'currency',
    required: false,
    label: 'Devise',
    synonyms: [
      'currency', 'devise', 'monnaie',
    ],
  },
  {
    field: 'dealType',
    required: false,
    label: 'Type de deal',
    synonyms: [
      'deal type', 'type', 'categorie', 'secteur', 'secteur activite',
    ],
  },
  {
    field: 'paymentStatus',
    required: false,
    label: 'Statut paiement',
    synonyms: [
      'statut paiement', 'payment status', 'paiement', 'paid',
    ],
  },
];

// ─── Normalisation ──────────────────────────────────────────────────────────

export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire accents
    .replace(/[_\-/\\]+/g, ' ')                        // _ - / \ → espace
    .replace(/[^a-z0-9 ]/g, '')                        // retire caractères spéciaux
    .replace(/\s+/g, ' ')                              // multiples espaces → un
    .trim();
}

// ─── Mapping principal ──────────────────────────────────────────────────────

export interface ColumnMapping {
  mapped: Partial<Record<DealField, number>>;   // field → index colonne
  unmapped: string[];                            // headers du fichier non identifiés
  unmappedIndices: number[];                     // indices des colonnes non identifiées
  missing: DealField[];                          // champs requis non trouvés
  missingLabels: string[];                       // libellés français des champs requis manquants
  allHeaders: string[];                          // tous les headers originaux du fichier
  fieldLabels: Record<string, string>;           // field → label français
}

export function detectColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapped: Partial<Record<DealField, number>> = {};
  const matchedIndices = new Set<number>();

  // Pour chaque entrée du dictionnaire, cherche un header qui match
  for (const entry of FIELD_DICTIONARY) {
    for (let i = 0; i < normalized.length; i++) {
      if (matchedIndices.has(i)) continue;
      if (!normalized[i]) continue;
      if (entry.synonyms.includes(normalized[i])) {
        mapped[entry.field] = i;
        matchedIndices.add(i);
        break;
      }
    }
  }

  // Headers non identifiés
  const unmapped: string[] = [];
  const unmappedIndices: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (!matchedIndices.has(i) && headers[i]?.trim()) {
      unmapped.push(headers[i]);
      unmappedIndices.push(i);
    }
  }

  // Champs requis non trouvés
  const missing: DealField[] = [];
  const missingLabels: string[] = [];
  for (const entry of FIELD_DICTIONARY) {
    if (entry.required && mapped[entry.field] === undefined) {
      missing.push(entry.field);
      missingLabels.push(entry.label);
    }
  }

  // Table label pour le frontend
  const fieldLabels: Record<string, string> = {};
  for (const entry of FIELD_DICTIONARY) {
    fieldLabels[entry.field] = entry.label;
  }

  return { mapped, unmapped, unmappedIndices, missing, missingLabels, allHeaders: headers, fieldLabels };
}

// ─── Application d'un mapping custom (fallback manuel) ──────────────────────

export function applyCustomMapping(
  mapping: ColumnMapping,
  customMapping: Partial<Record<DealField, string>>, // field → nom de colonne original
  headers: string[],
): ColumnMapping {
  const result = { ...mapping, mapped: { ...mapping.mapped }, missing: [...mapping.missing], missingLabels: [...mapping.missingLabels] };

  for (const [field, headerName] of Object.entries(customMapping)) {
    if (!headerName) continue;
    const idx = headers.findIndex((h) => h === headerName);
    if (idx === -1) continue;
    result.mapped[field as DealField] = idx;
    // Retirer de missing si c'était manquant
    const missingIdx = result.missing.indexOf(field as DealField);
    if (missingIdx !== -1) {
      result.missing.splice(missingIdx, 1);
      result.missingLabels.splice(missingIdx, 1);
    }
  }

  // Recalculer unmapped
  const matchedIndicesSet = new Set(Object.values(result.mapped));
  result.unmapped = [];
  result.unmappedIndices = [];
  for (let i = 0; i < headers.length; i++) {
    if (!matchedIndicesSet.has(i) && headers[i]?.trim()) {
      result.unmapped.push(headers[i]);
      result.unmappedIndices.push(i);
    }
  }

  return result;
}

// ─── Mapping DealField → noms canoniques du schéma existant ─────────────────
// Traduit les DealField vers les noms attendus par le DealRowSchema Zod.

export const DEAL_FIELD_TO_CANONICAL: Record<DealField, string> = {
  externalId: 'external_id',
  dealTitle: 'deal_name',
  amount: 'amount',
  closedDate: 'closed_at',
  clientName: 'client_name',
  marginAmount: 'margin_amount',
  costAmount: 'cost_amount',
  expectedCloseDate: 'expected_close_date',
  stage: 'stage',
  assignedToEmail: 'commercial_email',
  assignedToName: 'commercial_name',
  notes: 'notes',
  currency: 'currency',
  dealType: 'deal_type',
  paymentStatus: 'payment_status',
};

/**
 * Extrait une ligne de données à partir d'une row brute et du mapping détecté.
 * Retourne un objet avec les noms canoniques utilisés par le DealRowSchema.
 */
export function extractRowWithMapping(
  row: unknown[],
  mapping: ColumnMapping,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [field, colIndex] of Object.entries(mapping.mapped)) {
    if (colIndex === undefined || colIndex === null) continue;
    const canonicalName = DEAL_FIELD_TO_CANONICAL[field as DealField];
    if (!canonicalName) continue;
    result[canonicalName] = row[colIndex] ?? '';
  }

  return result;
}

// ─── Exports pour le dictionnaire (utile pour le frontend) ──────────────────

export function getFieldDictionary(): Array<{ field: DealField; required: boolean; label: string }> {
  return FIELD_DICTIONARY.map(({ field, required, label }) => ({ field, required, label }));
}
