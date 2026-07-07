// ============================================================
// SHARED TYPES — GrowCom
// Partagés entre frontend et backend
// ============================================================

// --- Enums ---

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  MANAGER = 'MANAGER',
  TEAM_LEAD = 'TEAM_LEAD',
  BU_MANAGER = 'BU_MANAGER',
  RECRUITER = 'RECRUITER',
  COMMERCIAL = 'COMMERCIAL',
}

export enum TenantPlan {
  TRIAL = 'TRIAL',
  STARTER = 'STARTER',
  PRO = 'PRO',
}

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
}

export enum CommissionRuleType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
  TIERED = 'TIERED',
}

export enum DealStatus {
  OPEN = 'OPEN',
  WON = 'WON',
  LOST = 'LOST',
}

export type DisputeStatus = 'OPEN' | 'RESOLVED_ACCEPTED' | 'RESOLVED_REJECTED';

export enum CommissionStatus {
  PENDING = 'PENDING',
  VALIDATED = 'VALIDATED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum RuleScope {
  INDIVIDUAL = 'INDIVIDUAL',
  TEAM = 'TEAM',
  GLOBAL = 'GLOBAL',
}

export enum AssigneeType {
  INDIVIDUAL = 'INDIVIDUAL',
  TEAM = 'TEAM',
}

export enum ContestMetric {
  REVENUE = 'REVENUE',
  DEAL_COUNT = 'DEAL_COUNT',
  MARGIN = 'MARGIN',
}

export enum ContestStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

export enum DealSource {
  ODOO = 'ODOO',
  HUBSPOT = 'HUBSPOT',
  FILE = 'FILE',
}

export enum ImportStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  PARTIAL_ERROR = 'PARTIAL_ERROR',
  FAILED = 'FAILED',
}

export enum ImportBatchStatus {
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  PARTIALLY_CANCELLED = 'PARTIALLY_CANCELLED',
}

export enum ImportSource {
  CSV = 'CSV',
  XLSX = 'XLSX',
}

// --- Moteur de règles avancé (Session B) ---

// 'PER_UNIT' (Session F) : forfait par unité = fixedAmount × nb consultants placés
export type CommissionCalculationBasis = 'REVENUE' | 'MARGIN' | 'PER_UNIT';
export type CommissionPaymentTrigger = 'DEAL_WON' | 'CLIENT_PAID';

// --- Objectifs — modes bonus et récurrence (Session B) ---

export type ObjectiveBonusMode = 'none' | 'simple' | 'tiered';
export type ObjectiveRecurrence = 'none' | 'monthly' | 'quarterly' | 'semester' | 'annual';

// --- Tenant ---

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  createdAt: string;
}

// --- Objectif commercial ---

export type ObjectivePeriodType = 'monthly' | 'quarterly' | 'semester' | 'annual' | 'custom';

export interface ObjectiveBonus {
  enabled: boolean;
  type: 'percentage' | 'fixed'; // % des ventes au-dessus / montant fixe
  value: number;                // ex : 10 pour 10 %, ou 500 pour 500 €
}

export interface ObjectiveBonusTier {
  threshold: number;  // % d'atteinte (ex: 80 pour 80%)
  reward: {
    type: 'fixed' | 'percentage'; // Fixe en €, ou % sur CA réalisé
    value: number;
  };
}

export interface Objective {
  id: string;
  label: string;
  target: number;
  unit: string;             // '€' | 'deals' | '%' | string libre
  periodType: ObjectivePeriodType;
  // mensuel → month (1-12) + year
  month?: number;
  year?: number;
  // trimestriel → quarter (1-4) + year
  quarter?: number;
  // semestriel → semester (1-2) + year
  semester?: number;
  // personnalisé → plage de dates ISO
  startDate?: string;
  endDate?: string;
  // prime de dépassement
  bonus?: ObjectiveBonus;
  // mode bonus étendu (Session B) — défaut: 'simple' si bonus.enabled, sinon 'none'
  bonusMode?: ObjectiveBonusMode;
  bonusTiers?: ObjectiveBonusTier[];  // utilisé seulement si bonusMode === 'tiered'
  // récurrence (Session B)
  recurrence?: ObjectiveRecurrence;        // défaut: 'none'
  recurrenceEndDate?: string;              // date ISO limite de génération
  parentObjectiveId?: string;              // id du template si occurrence générée
  // désactivé = archivé (false = objectif inactif, masqué par défaut)
  isActive?: boolean;
}

// --- User ---

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  fixedSalary: number;
  objectives: Objective[];
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export type PublicUser = Omit<User, 'tenantId'> & { tenantId: string | null };

// --- Commission Rule ---

export interface CommissionTier {
  min: number;
  max: number | null;
  rate: number;
}

export interface CommissionExample {
  saleAmount: number;
  commission: number;
  explanation: string;
}

export interface CommissionRuleConfig {
  type: CommissionRuleType;
  description: string;
  tiers?: CommissionTier[];
  rate?: number;         // Pour PERCENTAGE simple
  fixedAmount?: number;  // Pour FIXED
  examples: CommissionExample[];
  // Champs Session B — tous optionnels pour rétrocompatibilité
  calculationBasis?: CommissionCalculationBasis; // Défaut: 'REVENUE'
  paymentTrigger?: CommissionPaymentTrigger;      // Défaut: 'DEAL_WON'
  cap?: number;    // Plafond absolu en € (null = pas de plafond)
  floor?: number;  // Montant min du deal pour déclencher (null = pas de seuil)
  // Champ Session F — type d'événement ciblé (défaut: 'DEAL_WON')
  // 'MISSION_MONTH' = règle appliquée à chaque mois d'une mission ESN active
  appliesToEventType?: CommissionEventType;
}

export interface CommissionRule {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: CommissionRuleType;
  config: CommissionRuleConfig;
  scope: RuleScope;
  dealType: string | null;
  paymentDelayDays: number | null;
  isActive: boolean;
  isArchived: boolean;
  validatedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RuleAssignment {
  id: string;
  tenantId: string;
  ruleId: string;
  assignedToType: AssigneeType;
  userId: string | null;
  teamName: string | null;
  // Session F — paramètres surchargés pour cette assignation (template + override)
  overrides: Partial<CommissionRuleConfig> | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  rule: Pick<CommissionRule, 'id' | 'name' | 'type' | 'dealType' | 'scope' | 'config'>;
}

/** Sous-ensemble des paramètres d'une règle qui peuvent être surchargés par assignation. */
export type OverridableRuleParams = Pick<
  CommissionRuleConfig,
  'rate' | 'fixedAmount' | 'cap' | 'floor' | 'tiers'
>;

// --- Deal ---

export interface Deal {
  id: string;
  tenantId: string;
  odooId: string | null;
  fileExternalId: string | null;
  source: DealSource;
  title: string;
  clientName: string | null;
  amount: number;
  currency: string;
  status: DealStatus;
  probability: number;
  assignedToId: string | null;
  closedAt: string | null;
  syncedAt: string;
  createdAt: string;
  dealType: string | null;
  notes: string | null;
  importLogId: string | null;
  importBatchId: string | null;
  costAmount: number | null;
  marginAmount: number | null;
  marginSource: 'ODOO' | 'CSV_IMPORT' | 'COMPUTED' | null;
}

// --- Deal Assignment ---

export interface DealAssignment {
  id: string;
  tenantId: string;
  dealId: string;
  userId: string;
  share: number;        // 0.0 - 1.0
  role: string | null;
  createdAt: string;
  user?: Pick<User, 'firstName' | 'lastName' | 'email'>;
}

// --- Commission ---

export interface Commission {
  id: string;
  tenantId: string;
  userId: string;
  dealId: string;
  ruleId: string;
  amount: number;
  status: CommissionStatus;
  calculatedAt: string;
  scheduledPaymentAt: string | null;
  validatedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  // Champs Session B — mode "paiement client"
  awaitingClientPayment: boolean;
  clientPaidAt: string | null;
  clientPaidBy: string | null;
  // Récurrent ESN : mission source et mois de rattachement de la commission.
  // periodMonth = 1er jour du mois pour une commission de mission ;
  // sentinelle 1970-01-01 pour une commission de deal one-shot.
  missionId?: string | null;
  periodMonth?: string;
}

export interface CommissionWithDetails extends Commission {
  deal: Pick<Deal, 'title' | 'clientName' | 'amount' | 'status' | 'closedAt'>;
  rule: Pick<CommissionRule, 'name' | 'config'>;
  user: Pick<User, 'firstName' | 'lastName' | 'email'>;
  calculationDetail: string;
  // Dispute sur cette commission (null si aucun)
  dispute?: { id: string; status: DisputeStatus; managerResponse: string | null; reason: string } | null;
}

// --- Session C — CommissionAdjustment (clawbacks) ---

export interface CommissionAdjustment {
  id: string;
  tenantId: string;
  userId: string;
  originalCommissionId: string | null;
  amount: number;  // Peut être négatif (clawback) ou positif (bonus exceptionnel)
  reason: string;
  status: CommissionStatus;
  createdBy: string;
  createdAt: string;
  paidAt: string | null;
}

// --- Session C — CommissionDispute (contestations) ---

export interface CommissionDispute {
  id: string;
  tenantId: string;
  commissionId: string;
  raisedBy: string;
  reason: string;
  status: DisputeStatus;
  managerResponse: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  // Relations incluses par le backend
  raiser?: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
  commission?: {
    id: string;
    userId: string;
    dealId: string;
    ruleId: string;
    amount: number;
    status: string;
    deal: Pick<Deal, 'id' | 'title' | 'clientName' | 'amount' | 'currency' | 'status' | 'dealType' | 'closedAt' | 'notes'>;
    rule: Pick<CommissionRule, 'id' | 'name' | 'config'>;
  };
}

// --- Contest ---

export interface Contest {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  prize: string;
  metric: ContestMetric;
  scope: RuleScope;
  teamName: string | null;
  participantIds: string[];
  periodStart: string;
  periodEnd: string;
  status: ContestStatus;
  anonymousLeaderboard: boolean;
  createdBy: string;
  createdAt: string;
}

/** Réponse anonymisée pour un commercial sur un concours anonyme */
export interface AnonymousLeaderboardResult {
  myRank: number;
  totalParticipants: number;
  myScore: number;
  leaderScore: number; // Score du 1er sans nom
}

export interface ContestDealDetail {
  dealId: string;
  dealTitle: string;
  clientName: string | null;
  amount: number;
  marginAmount: number | null;
  costAmount: number | null;
  valueUsed: number;
  share: number;
  contribution: number;
  source: string;
}

export interface ContestLeaderboardEntry {
  rank: number;
  user: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
  value: number;
  details?: ContestDealDetail[];
}

// --- Audit Log ---

export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// --- API Response Wrapper ---

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// --- Auth ---

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: PublicUser;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
  companySlug: string;
}

// --- Dashboard Stats ---

export interface ManagerDashboardStats {
  totalPendingCommissions: number;
  totalValidatedCommissions: number;
  totalPaidCommissions: number;
  totalDeferredCommissions: number;
  commercialsSummary: Array<{
    user: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
    totalRevenue: number;
    dealCount: number;
    totalCommissions: number;
    pendingCount: number;
  }>;
  deferredCommissions: CommissionWithDetails[];
  recentlyProcessedCommissions: CommissionWithDetails[];
  openDisputeCount: number;
  totalAdjustmentsThisPeriod: number;
}

export interface CommercialDashboardStats {
  totalEarnedThisMonth: number;
  totalPendingValidation: number;
  projectedCommissions: number;
  adjustments: CommissionAdjustment[];
}

// --- Odoo Sync ---

export interface OdooConfig {
  url: string;
  database: string;
  apiKey: string;
}

export interface OdooSyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
  syncedAt: string;
}

export interface HubspotSyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
  syncedAt: string;
}

// --- Import Batch ---

export interface ImportBatch {
  id: string;
  tenantId: string;
  importedBy: string;
  source: ImportSource;
  originalFileName: string | null;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  errorRows: number;
  status: ImportBatchStatus;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  cancellationSummary: { deletedDeals: number; keptDeals: number; restoredDeals: number; reason: string } | null;
  importErrors: ImportRowError[] | null;
  createdAt: string;
}

export interface ImportBatchWithDetails extends ImportBatch {
  importer: Pick<User, 'firstName' | 'lastName' | 'email'>;
  deals?: Array<Pick<Deal, 'id' | 'title' | 'clientName' | 'amount' | 'status'>>;
}

export interface CancelPreviewResult {
  toBeDeleted: number;
  toBeRestored: number;
  toBeKept: number;
  affectedCommissions: {
    pending: number;
    validated: number;
    paid: number;
  };
}

// --- File Import ---

export interface ImportLog {
  id: string;
  tenantId: string;
  uploadedBy: string;
  fileName: string;
  status: ImportStatus;
  totalRows: number;
  successRows: number;
  errorRows: number;
  skippedRows: number;
  errors: ImportRowError[];
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRowError {
  row: number;
  column: string;
  message: string;
  value?: string;
}

export interface ImportMappingField {
  field: string;
  label: string;
  columnIndex: number;
  columnName: string;
}

export interface ImportMappingMissing {
  field: string;
  label: string;
}

export interface ImportMappingDetails {
  mapped: ImportMappingField[];
  unmapped: string[];
  missing: ImportMappingMissing[];
  allHeaders: string[];
  fieldLabels: Record<string, string>;
}

export interface ImportPreview {
  importLogId: string;              // ID de l'ImportLog PENDING (vide si mappingIncomplete)
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;            // external_id déjà existant
  unmatchedCommercials: number;     // commercial non trouvé (ni par email, ni par nom)
  openRows: number;                 // deals en statut OPEN (pistes, opportunités) — pas de commission
  errors: ImportRowError[];
  unmatchedIdentifiers: string[];   // emails ou noms non reconnus
  sample: ImportPreviewRow[];       // Aperçu des 5 premières lignes valides
  // Champs de mapping intelligent (Chantier A)
  mappingIncomplete?: boolean;      // true si des colonnes obligatoires manquent
  mappingDetails?: ImportMappingDetails; // Détails du mapping pour l'UI de fallback
}

export interface ImportPreviewRow {
  externalId: string;
  dealName: string;
  amount: number;
  currency: string;
  closedAt: string;
  commercialEmail: string | null;     // null si le fichier ne contient qu'un nom
  commercialIdentifier: string;       // valeur brute du fichier (email ou nom)
  commercialName: string | null;      // nom résolu depuis GrowCom, null si non reconnu
  clientName: string | null;
  dealType: string | null;
  inferredStatus: DealStatus;         // statut déduit depuis le stage CRM (WON, OPEN, LOST)
  isDuplicate: boolean;
  isUnmatched: boolean;
}

export interface FileImportConfirmResult {
  created: number;
  skipped: number;
  errors: number;
  importLogId: string;
  batchId?: string;
}

// --- Payroll Report Preview ---

/** Détail d'une commission incluse dans la paie (drill-down auditabilité). */
export interface PayrollCommissionLine {
  commissionId: string;
  dealTitle: string;
  clientName: string | null;
  dealAmount: number;
  amount: number;
  ruleName: string;
  scheduledPaymentAt: string | null;
  validatedAt: string | null;
}

/** Détail d'un ajustement inclus dans la paie (clawback ou bonus exceptionnel). */
export interface PayrollAdjustmentLine {
  adjustmentId: string;
  reason: string;
  amount: number;
  createdAt: string;
}

export interface PayrollReportPreviewItem {
  userId: string;
  user: Pick<User, 'firstName' | 'lastName' | 'email'>;
  role: string;
  fixedSalaryTotal: number;
  commissionsTotal: number;
  adjustmentsTotal: number;
  bonusTotal: number;
  /** Ce qui part réellement à la paie : commissions + ajustements + primes. */
  variableTotal: number;
  /** Affichage écran uniquement (fixe + variable). Jamais dans l'export paie. */
  netTotal: number;
  commissions: PayrollCommissionLine[];
  adjustments: PayrollAdjustmentLine[];
}

/** Raison d'exclusion d'une commission de la paie de la période. */
export type PayrollExclusionReason =
  | 'PENDING'
  | 'AWAITING_CLIENT_PAYMENT'
  | 'DISPUTED';

/** Commission présente sur la période mais exclue de la paie (transparence). */
export interface PayrollExcludedCommission {
  commissionId: string;
  userId: string;
  user: Pick<User, 'firstName' | 'lastName' | 'email'>;
  dealTitle: string;
  clientName: string | null;
  amount: number;
  status: string;
  reason: PayrollExclusionReason;
  reasonLabel: string;
}

/** Informations de verrouillage d'une période figée. */
export interface PayrollLockInfo {
  lockedAt: string;
  lockedBy: string;
  lockedByName: string | null;
  totalAmount: number;
  userCount: number;
}

export interface PayrollReportPreview {
  periodStart: string;
  periodEnd: string;
  items: PayrollReportPreviewItem[];
  /** Commissions PENDING / en litige / en attente de paiement client, exclues. */
  excluded: PayrollExcludedCommission[];
  /** Total écran (fixe + variable) — conservé pour la vue d'ensemble. */
  grandTotal: number;
  /** Total qui part réellement à la paie (somme des variableTotal). */
  variableGrandTotal: number;
  /** Non nul si la période est déjà figée (lecture seule). */
  locked: PayrollLockInfo | null;
}

/** Entrée d'historique des périodes de paie figées. */
export interface PayrollPeriodHistoryItem {
  id: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generatedBy: string;
  generatedByName: string | null;
  totalAmount: number;
  userCount: number;
}

// --- Objective Snapshot (Session B - Chantier 7) ---

export interface ObjectiveSnapshot {
  id: string;
  tenantId: string;
  userId: string;
  objectiveId: string;
  periodLabel: string;   // "Janvier 2026", "T1 2026", "Année 2026"
  snapshotData: Objective;
  actualValue: number;
  bonusEarned: number;
  snapshotAt: string;
}

// --- Plan de variable + récurrent ESN (Session F) ---

export type VariablePlanAggregation = 'SUM';
export type PlanComponentKind = 'COMMISSION_RULE' | 'OBJECTIVE';
export type CommissionEventType = 'DEAL_WON' | 'MISSION_MONTH' | 'MANUAL';
export type MissionType = 'MARGIN_MENSUELLE' | 'FORFAIT_PAR_CONSULTANT';
export type MissionStatus = 'ACTIVE' | 'ENDED';

/** Un composant d'un plan = une règle de commission OU un objectif. */
export interface PlanComponent {
  id: string;
  tenantId: string;
  planId: string;
  kind: PlanComponentKind;
  ruleId: string | null;              // si kind = COMMISSION_RULE
  objectiveConfig: Objective | null;  // si kind = OBJECTIVE (snapshot config)
  appliesToEventType: CommissionEventType;
  sortOrder: number;
  createdAt: string;
}

/** Conteneur agrégeant les composants de rémunération variable d'un commercial. */
export interface VariablePlan {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  isTemplate: boolean;
  aggregation: VariablePlanAggregation;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  components?: PlanComponent[];
}

/** Paramètres surchargeables par personne pour un composant donné. */
export type PlanComponentOverrides = Record<string, Partial<CommissionRuleConfig>>;

// ─── Plan de variable — simulation (refonte page unifiée) ───
// Les types du brouillon IA (GeneratedPlanDraft, GeneratedPlanComponentDraft,
// PlanObjectiveInput) sont définis plus bas dans ce fichier.

/** Scénario paramétrable du dashboard de simulation (tout recalcul passe par l'API). */
export interface PlanSimulationScenario {
  dealAmount: number;                  // montant d'un deal one-shot simulé
  dealMargin: number | null;           // marge du deal (null = inconnue → repli moteur)
  missionMonthlyAmount: number;        // CA mensuel d'une mission récurrente simulée
  missionMonthlyMargin: number | null; // marge mensuelle de la mission
  consultantCount: number;             // consultants placés (forfait PER_UNIT)
  missionMonths: number;               // durée simulée de la mission (mois)
  objectiveAchievementPct: number;     // % d'atteinte des objectifs (100 = pile la cible)
}

/** Une ligne de décomposition de la simulation (un composant du plan). */
export interface PlanSimulationLine {
  componentIndex: number;
  componentName: string;
  kind: 'ONE_SHOT' | 'RECURRING' | 'OBJECTIVE_BONUS';
  amount: number;           // one-shot : montant ; récurrent : montant MENSUEL ; bonus : prime
  monthlyAmount?: number;   // récurrent uniquement
  months?: number;          // récurrent uniquement
  projectedTotal?: number;  // récurrent : mensuel × durée simulée
  explanation: string;      // explication moteur, lisible
}

/** Résultat de POST /variable-plans/simulate (calculé par le moteur réel, jamais côté front). */
export interface PlanSimulationResult {
  totalOneShot: number;
  totalMonthly: number;         // somme des composants récurrents, par mois
  totalObjectiveBonus: number;
  grandTotal: number;           // one-shot + mensuel × durée + primes, sur la durée simulée
  lines: PlanSimulationLine[];
}

export interface PlanAssignment {
  id: string;
  tenantId: string;
  planId: string;
  assignedToType: AssigneeType;
  userId: string | null;
  teamName: string | null;
  overrides: PlanComponentOverrides | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Miroir enrichi d'une mission/abonnement récurrent du CRM. Alimenté par le sync CRM. */
export interface Mission {
  id: string;
  tenantId: string;
  dealId: string;
  userId: string | null;
  type: MissionType;
  monthlyAmount: number;      // marge mensuelle récurrente OU forfait mensuel
  consultantCount: number;    // nb consultants placés
  startDate: string;
  expectedEndDate: string | null;  // null = jusqu'à arrêt côté CRM
  status: MissionStatus;
  source: DealSource;
  odooId: string | null;
  hubspotId: string | null;
  marginAmount: number | null;
  marginSource: 'ODOO' | 'HUBSPOT' | 'COMPUTED' | null;
  syncedAt: string;
  createdAt: string;
}

/** Unité de calcul du moteur (deal WON, mois de mission, ou manuel). */
export interface CommissionableEvent {
  id: string;
  tenantId: string;
  type: CommissionEventType;
  dealId: string | null;
  missionId: string | null;
  userId: string;
  periodMonth: string | null;   // 1er jour du mois pour MISSION_MONTH
  amount: number;               // base CA/revenu
  marginAmount: number | null;
  unitCount: number | null;     // nb consultants (forfait)
  marginSource: string | null;
  occurredAt: string;
  createdAt: string;
}

// --- DTO IA : brouillon de plan multi-composants (non persisté) ---

/** Objectif tel que proposé par l'IA (sous-ensemble d'Objective, sans id/occurrences). */
export interface PlanObjectiveInput {
  label: string;
  target: number;
  unit: string;
  periodType: ObjectivePeriodType;
  month?: number;
  quarter?: number;
  semester?: number;
  year?: number;
  bonus?: ObjectiveBonus;
  bonusMode?: ObjectiveBonusMode;
  bonusTiers?: ObjectiveBonusTier[];
  recurrence?: ObjectiveRecurrence;
}

export interface GeneratedPlanCommissionComponent {
  kind: 'COMMISSION_RULE';
  name: string;
  config: CommissionRuleConfig;
  /** Présent en mode ÉDITION d'un plan sauvegardé : la règle réelle à mettre à jour. */
  ruleId?: string;
}

export interface GeneratedPlanObjectiveComponent {
  kind: 'OBJECTIVE';
  objective: PlanObjectiveInput;
}

export type GeneratedPlanComponentDraft =
  | GeneratedPlanCommissionComponent
  | GeneratedPlanObjectiveComponent;

/** Sortie de l'IA : plan de variable multi-composants prêt à alimenter le futur wizard. */
export interface GeneratedPlanDraft {
  name: string;
  description: string;
  components: GeneratedPlanComponentDraft[];
}

// --- Progression d'objectif calculée par le moteur backend (Lot 1) ---

/**
 * Progression et prime d'un objectif, calculées par le POINT D'ENTRÉE UNIQUE
 * du moteur (objectiveProgress.service). Le front affiche ces nombres, il ne
 * recalcule jamais. source = SNAPSHOT pour un objectif terminé déjà figé
 * (valeurs lues depuis ObjectiveSnapshot, pas recalculées).
 */
export interface ObjectiveProgressItem {
  objectiveId: string;
  actualValue: number;
  pct: number;
  bonusProjected: number;
  dealsWithoutMargin: number;
  source: 'LIVE' | 'SNAPSHOT';
  // Transparence : part de l'actualValue venant du CA récurrent des missions
  // (0 pour les objectifs en nb de deals ; absent pour les snapshots historiques)
  recurringValue?: number;
}

// --- DTO Mission enrichie (endpoints manager) ---

export interface MissionWithDetails extends Mission {
  deal: Pick<Deal, 'title' | 'clientName'>;
  commercial: Pick<User, 'firstName' | 'lastName' | 'email'> | null;
}

/** Projection d'une mission active : commission mensuelle et mois restants. */
export interface RecurringProjectionMission {
  missionId: string;
  dealId: string;
  dealTitle: string;
  clientName: string | null;
  monthlyCommission: number;      // commission récurrente estimée par mois
  monthlyAmount: number;          // MRR de la mission (base)
  consultantCount: number;
  startDate: string;
  expectedEndDate: string | null;
  monthsRemaining: number | null; // null = tant que la mission tourne
  projectedRemaining: number | null; // monthlyCommission × mois restants (null si indéterminé)
}

/** Récurrent d'un commercial : total mensuel + détail des missions actives. */
export interface RecurringProjection {
  monthlyTotal: number;
  activeMissionCount: number;
  missions: RecurringProjectionMission[];
}

/** Commission récurrente (issue d'une mission) exposée côté endpoints/UX. */
export interface RecurringCommissionDTO {
  id: string;
  userId: string;
  missionId: string | null;
  periodMonth: string;
  amount: number;
  status: CommissionStatus;
  calculationDetail: string | null;
  dealTitle: string;
  clientName: string | null;
  ruleName: string;
}

// --- Stripe ---

export interface BillingInfo {
  plan: TenantPlan;
  status: TenantStatus;
  activeUsers: number;
  monthlyAmount: number;
  nextBillingDate: string | null;
  invoices: Array<{
    id: string;
    amount: number;
    status: string;
    date: string;
    pdfUrl: string | null;
  }>;
}
