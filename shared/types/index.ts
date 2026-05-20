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
}

export enum ContestStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

export enum DealSource {
  ODOO = 'ODOO',
  FILE = 'FILE',
}

export enum ImportStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  PARTIAL_ERROR = 'PARTIAL_ERROR',
  FAILED = 'FAILED',
}

// --- Moteur de règles avancé (Session B) ---

export type CommissionCalculationBasis = 'REVENUE' | 'MARGIN';
export type CommissionPaymentTrigger = 'DEAL_WON' | 'CLIENT_PAID';

// --- Objectifs — modes bonus et récurrence (Session B) ---

export type ObjectiveBonusMode = 'none' | 'simple' | 'tiered';
export type ObjectiveRecurrence = 'none' | 'monthly' | 'quarterly' | 'annual';

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

export type ObjectivePeriodType = 'monthly' | 'quarterly' | 'annual' | 'custom';

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
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  rule: Pick<CommissionRule, 'id' | 'name' | 'type' | 'dealType' | 'scope'>;
}

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
}

export interface CommissionWithDetails extends Commission {
  deal: Pick<Deal, 'title' | 'clientName' | 'amount' | 'status' | 'closedAt'>;
  rule: Pick<CommissionRule, 'name' | 'config'>;
  user: Pick<User, 'firstName' | 'lastName' | 'email'>;
  calculationDetail: string;
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
  createdBy: string;
  createdAt: string;
}

export interface ContestLeaderboardEntry {
  rank: number;
  user: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
  value: number;
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
    totalCommissions: number;
    pendingCount: number;
  }>;
  deferredCommissions: CommissionWithDetails[];
}

export interface CommercialDashboardStats {
  totalEarnedThisMonth: number;
  totalPendingValidation: number;
  projectedCommissions: number;
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

export interface ImportPreview {
  importLogId: string;              // ID de l'ImportLog PENDING
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;            // external_id déjà existant
  unmatchedCommercials: number;     // commercial non trouvé (ni par email, ni par nom)
  errors: ImportRowError[];
  unmatchedIdentifiers: string[];   // emails ou noms non reconnus
  sample: ImportPreviewRow[];       // Aperçu des 5 premières lignes valides
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
  isDuplicate: boolean;
  isUnmatched: boolean;
}

export interface FileImportConfirmResult {
  created: number;
  skipped: number;
  errors: number;
  importLogId: string;
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
