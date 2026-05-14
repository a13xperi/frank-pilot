// ── Tenant portal types ──────────────────────────────────────────
// Simplified types for the tenant-facing portal. Applicants and
// tenants only — no staff roles, no RBAC tiers.

export type TenantRole = 'applicant' | 'tenant';

export interface TenantUser {
  id: string;
  email: string;
  role: TenantRole;
  firstName: string;
  lastName: string;
  applicationId?: string | null;
}

export interface ApiError {
  error: string;
  details?: unknown[];
}

// ── Application ──────────────────────────────────────────────────

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'screening'
  | 'screening_passed'
  | 'screening_failed'
  | 'tier1_review'
  | 'tier1_approved'
  | 'tier1_denied'
  | 'tier2_review'
  | 'tier2_approved'
  | 'tier2_denied'
  | 'tier3_review'
  | 'tier3_approved'
  | 'tier3_denied'
  | 'lease_generated'
  | 'onboarded'
  | 'cancelled';

export interface Application {
  id: string;
  status: ApplicationStatus;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  property_id: string;
  property_name?: string;
  unit_number: string | null;
  annual_income: number | null;
  household_size: number;
  created_at: string;
  submitted_at: string | null;
}

// ── Payment ──────────────────────────────────────────────────────

export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded';

export type PaymentMethod = 'ach' | 'card' | 'check' | 'cash' | 'money_order';

export interface Payment {
  id: string;
  applicationId: string;
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  description: string | null;
  reference: string | null;
  createdAt: string;
  processedAt: string | null;
}

// ── Ledger ───────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  applicationId: string;
  propertyId: string;
  entryType: string;
  status: string;
  description: string;
  amount: number;
  balanceAfter: number;
  billingPeriod: string | null;
  dueDate: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface LedgerResponse {
  entries: LedgerEntry[];
  total: number;
}

export interface LedgerBalanceResponse {
  applicationId: string;
  balance: number;
  lastPaymentDate: string | null;
  nextDueDate: string | null;
}

// ── Maintenance ──────────────────────────────────────────────────

export interface WorkOrder {
  id: string;
  property_id: string;
  property_name: string;
  unit_number: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  category: string | null;
  is_emergency: boolean;
  submitted_by_name: string | null;
  assigned_to_name: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  created_at: string;
}
