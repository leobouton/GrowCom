/**
 * Types publics du moteur de calcul de commission.
 * Aucune dépendance à Prisma, à la base de données ou au réseau.
 */

import type { CommissionRuleConfig, CommissionTier, TierMode } from '../types';

export type { CommissionRuleConfig, CommissionTier, TierMode };

/** Un intervenant sur une vente (même sémantique que DealAssignment.share). */
export interface ParticipantInput {
  id: string;
  label?: string;
  /** Part entre 0 et 1 ; la somme des parts de tous les intervenants vaut 1. */
  share: number;
}

export interface CommissionInput {
  /** Règle à appliquer (PERCENTAGE | FIXED | TIERED, avec floor, cap, tierMode…). */
  config: CommissionRuleConfig;
  /** Base de CETTE vente, déjà résolue (CA, honoraires, marge ou nb de consultants). */
  basisAmount: number;
  /**
   * Base déjà réalisée sur la période avant cette vente (ex. CA depuis le début de l'année).
   * Ne sert qu'aux paliers. Défaut 0 : les paliers s'appliquent à la vente seule (comportement historique).
   */
  priorBasisAmount?: number;
  /** Intervenants et leurs parts. Défaut : un seul intervenant à 100 %. */
  participants?: ParticipantInput[];
  /** Libellé de la base dans l'explication (défaut selon calculationBasis : « CA », « Marge », « Forfait »). */
  basisLabel?: string;
}

export type CalculationLineKind = 'PERCENTAGE' | 'FIXED' | 'PER_UNIT' | 'TIER' | 'RETROACTIVE_CATCH_UP';

/** Une ligne du détail de calcul : « base × taux = montant ». */
export interface CalculationLine {
  kind: CalculationLineKind;
  label: string;
  /** Montant sur lequel le taux s'applique (ou nb d'unités pour PER_UNIT) ; null pour un forfait. */
  base: number | null;
  /** Taux appliqué (0.1 = 10 %) ; pour RETROACTIVE_CATCH_UP, l'écart de taux. null pour un forfait. */
  rate: number | null;
  /** Montant de la ligne, arrondi au centime. */
  amount: number;
  /** Palier concerné (lignes TIER et RETROACTIVE_CATCH_UP). */
  tier?: CommissionTier;
}

export interface ParticipantAmount {
  id: string;
  label?: string;
  share: number;
  amount: number;
}

/** Position dans la grille de paliers après cette vente (règles TIERED uniquement). */
export interface TierProgress {
  /** Base cumulée après la vente (déjà réalisé + cette vente). */
  cumulativeBasis: number;
  /** Palier atteint (null si le premier palier n'est pas encore atteint). */
  currentTier: CommissionTier | null;
  /** Prochain palier (null si le dernier palier est atteint). */
  nextTier: CommissionTier | null;
  /** Base restant à réaliser pour atteindre le prochain palier (null si aucun). */
  remainingToNextTier: number | null;
  /** Avancement entre le palier atteint et le suivant, de 0 à 1 (1 si dernier palier). */
  progressToNextTier: number;
}

export type CommissionSkippedReason = 'BELOW_FLOOR' | 'UNKNOWN_RULE';

export interface CommissionResult {
  /** Commission totale de la vente (tous intervenants), arrondie au centime, jamais négative. */
  totalAmount: number;
  basisAmount: number;
  priorBasisAmount: number;
  tierMode: TierMode;
  /** Détail ligne par ligne ; la somme des lignes vaut le total avant plafond. */
  lines: CalculationLine[];
  /** Montant avant plafond et avant borne à 0 (somme des lignes). */
  amountBeforeCap: number;
  capped: boolean;
  /** Détail lisible, au format de Commission.calculationDetail. */
  explanation: string;
  /** Répartition du total ; la somme vaut exactement totalAmount. */
  participants: ParticipantAmount[];
  tierProgress: TierProgress | null;
  skippedReason?: CommissionSkippedReason;
}
