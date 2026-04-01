export type UserRole =
  | 'leasing_agent'
  | 'senior_manager'
  | 'regional_manager'
  | 'asset_manager'
  | 'system_admin';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  propertyIds: string[];
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface ApiError {
  error: string;
  details?: unknown[];
}

const ROLE_LEVEL: Record<UserRole, number> = {
  leasing_agent: 1,
  senior_manager: 2,
  regional_manager: 3,
  asset_manager: 4,
  system_admin: 5,
};

export function hasMinRole(userRole: UserRole, minRole: UserRole): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[minRole];
}

export function formatRole(role: UserRole): string {
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Application types ─────────────────────────────────────────────

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'screening' | 'screening_passed' | 'screening_failed'
  | 'tier1_review' | 'tier1_approved' | 'tier1_denied'
  | 'tier2_review' | 'tier2_approved' | 'tier2_denied'
  | 'tier3_review' | 'tier3_approved' | 'tier3_denied'
  | 'lease_generated' | 'onboarded' | 'cancelled';

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
  ssn_masked?: string;
  created_at: string;
  submitted_at: string | null;
  income_verified?: boolean;
  income_verified_by?: string | null;
  income_verified_at?: string | null;
  onesite_lease_id?: string | null;
  loft_tenant_id?: string | null;
}

export interface ApplicationListResponse {
  applications: Application[];
}

// ── Property types ────────────────────────────────────────────────

export interface Property {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
  unitCount: number;
  amiArea: string;
  onesitePropertyId: string | null;
  loftPropertyId: string | null;
  createdAt: string;
}

export interface PropertyListResponse {
  properties: Property[];
  total: number;
}

// ── Staff user types ──────────────────────────────────────────────

export interface StaffUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  propertyIds: string[];
  createdAt: string;
  lastLogin: string | null;
}

export interface UserListResponse {
  users: StaffUser[];
  total: number;
}

// ── Screening types ───────────────────────────────────────────────

export interface ScreeningResult {
  overallResult: 'pass' | 'fail' | 'review_required';
  background: { status: string; details?: unknown };
  credit: { status: string; score?: number; details?: unknown };
  compliance: { status: string; amiQualified?: boolean; details?: unknown };
}

export interface FraudFlag {
  id: string;
  application_id: string;
  flag_type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

// ── Approval types ────────────────────────────────────────────────

export interface TierStatus {
  required: boolean;
  completed: boolean;
  decision: 'pass' | 'fail' | null;
  reviewerId: string | null;
  decidedAt: string | null;
  notes: string | null;
}

export interface ApprovalStatus {
  applicationId: string;
  currentStatus: string;
  tier1: TierStatus;
  tier2: TierStatus;
  tier3: TierStatus;
}

// ── Audit types ───────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  action: string;
  actor_id: string;
  actor_role: string;
  application_id: string | null;
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown>;
  created_at: string;
  ip_address?: string;
}

export interface AuditLogResponse {
  logs: AuditEntry[];
}

// ── Compliance types ──────────────────────────────────────────────

// ── Lease types ──────────────────────────────────────────────────

export interface LeaseStatus {
  applicationId: string;
  status: string;
  onesiteLeaseId: string | null;
  loftTenantId: string | null;
  autoPayEnrolled: boolean;
}

// ── Adverse Action types ─────────────────────────────────────────

export interface AdverseActionNotice {
  noticeId: string;
  applicationId: string;
  reason: string;
  reasonDetail: string | null;
  sentAt: string;
  sentVia: string;
}

// ── Compliance types ─────────────────────────────────────────────

export interface ComplianceReport {
  reportGeneratedAt: string;
  propertyId: string | null;
  decisionOutcomes: {
    totalApplications: number;
    approved: number;
    denied: number;
    approvalRate: number;
  };
  adverseActionCompleteness: {
    deniedApplications: number;
    noticesIssued: number;
    noticeCompleteness: number;
  };
  objectiveCriteriaDocumentation: {
    applicationsReviewed: number;
    criteriaApplied: string[];
    consistencyScore: number;
  };
}
