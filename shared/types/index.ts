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
  odooId: string;
  title: string;
  clientName: string | null;
  amount: number;
  status: DealStatus;
  probability: number;
  assignedToId: string | null;
  closedAt: string | null;
  syncedAt: string;
  createdAt: string;
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
}

export interface CommissionWithDetails extends Commission {
  deal: Pick<Deal, 'title' | 'clientName' | 'amount' | 'status'>;
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
