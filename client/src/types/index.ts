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

export function formatRole(role: UserRole | null | undefined): string {
  // System-generated audit events (payment webhooks, ledger postings) carry a
  // null actor_role — render those as "System" rather than crashing on .split().
  if (!role) return 'System';
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Application types ─────────────────────────────────────────────

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'screening' | 'screening_review' | 'screening_passed' | 'screening_failed'
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
  // W0 AMI pre-qualifier — set from the apply wizard's income calculator.
  // Null when the applicant skipped income or is over-income for the 80% tier.
  qualifying_ami_tier?: '30' | '50' | '60' | '80' | null;
}

export interface ApplicationListResponse {
  applications: Application[];
}

// ── Property types ────────────────────────────────────────────────

export type PropertyType = 'senior' | 'family' | 'mixed_use';

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
  phone: string | null;
  email: string | null;
  propertyManager: string | null;
  propertyType: PropertyType;
  lihtcType: string | null;
  amiSetAside: string | null;
  compliancePeriodStart: string | null;
  compliancePeriodEnd: string | null;
  hasLura: boolean;
  hasMortgage: boolean;
  jurisdiction: string | null;
  unitMix: Record<string, number>;
  rentSchedule: Record<string, number>;
  totalVacancy: number;
  waitingListEnabled: boolean;
  createdAt: string;
  /** Optional cover photo. Not yet returned by /api/properties — when the
   *  backend adds it, the Properties list thumbnail lights up automatically. */
  photoUrl?: string | null;
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

export interface SignupStatsResponse {
  registered: number;
  verified: number;
}

// ── Screening types ───────────────────────────────────────────────

export interface ScreeningResult {
  overallResult: 'pass' | 'fail' | 'review_required' | 'could_not_screen';
  background: { status: string; details?: unknown };
  credit: { status: string; score?: number; details?: unknown };
  compliance: { status: string; amiQualified?: boolean; details?: unknown };
}

// Staff review queue — applications held in `screening_review` because the
// screening pipeline could not produce an automated verdict (a vendor check
// returned could_not_screen). Shape mirrors GET /api/screening/review-queue.
export interface ReviewQueueItem {
  id: string;
  first_name: string;
  last_name: string;
  property_id: string;
  created_at: string;
  overall_screening_result: string | null;
  identity_verification_result: string | null;
  background_check_result: string | null;
  credit_check_result: string | null;
  compliance_check_result: string | null;
  status_history?: unknown;
  // Per-check vendor detail payloads. Each *_details is a JSON object whose shape
  // varies by vendor (may be null when the check never produced a payload). Surfaced
  // in the resolve modal so the reviewer can see WHY each check landed where it did.
  identity_verification_details?: Record<string, unknown> | null;
  identity_verification_completed_at?: string | null;
  background_check_details?: Record<string, unknown> | null;
  background_check_completed_at?: string | null;
  credit_check_details?: Record<string, unknown> | null;
  credit_check_completed_at?: string | null;
  compliance_check_details?: Record<string, unknown> | null;
  compliance_check_completed_at?: string | null;
}

export interface ReviewQueueResponse {
  queue: ReviewQueueItem[];
}

// Server-rendered §1681m adverse-action letter preview. Returned by
// GET /api/screening/:applicationId/adverse-action/draft — the client renders
// noticeText for confirmation but NEVER sends the notice (server commits on resolve).
export interface AdverseActionDraft {
  applicationId: string;
  applicantName: string;
  propertyName: string;
  noticeText: string;
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

// ── Recertification types ────────────────────────────────────────

export interface Recertification {
  id: string;
  applicationId: string;
  propertyId: string;
  propertyName: string | null;
  tenantName: string;
  type: 'annual' | 'interim';
  status: string;
  anniversaryDate: string;
  cutoffDate: string;
  tracsDeadline: string;
  reminder120SentAt: string | null;
  reminder90SentAt: string | null;
  reminder60SentAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewDecision: string | null;
  reviewNotes: string | null;
  previousAnnualIncome: number | null;
  newAnnualIncome: number | null;
  rentAdjustment: number | null;
  createdAt: string;
}

export interface RecertificationListResponse {
  recertifications: Recertification[];
  total: number;
}

// ── Ledger types ─────────────────────────────────────────────────

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

export interface DelinquencyRecord {
  applicationId: string;
  tenantName: string;
  propertyName: string;
  balance: number;
  oldestUnpaidDate: string | null;
  daysOverdue: number;
  latePaymentCount12Mo: number;
  evictionTrigger: boolean;
}

export interface DelinquencyResponse {
  delinquencies: DelinquencyRecord[];
}

// ── Inspection types ─────────────────────────────────────────────

export interface Inspection {
  id: string;
  property_id: string;
  property_name: string;
  unit_number: string | null;
  inspection_type: string;
  status: string;
  scheduled_date: string;
  completed_date: string | null;
  inspector_name: string | null;
  notes: string | null;
  smoke_detector_ok: boolean | null;
  hqs_compliant: boolean | null;
  follow_up_required: boolean;
  created_at: string;
}

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

// ── Renewal types ────────────────────────────────────────────────

export interface LeaseRenewal {
  id: string;
  application_id: string;
  tenant_name: string;
  property_name: string;
  status: string;
  current_rent: number;
  proposed_rent: number;
  rent_change_amount: number;
  proposed_term_months: number;
  tenant_response: string | null;
  counter_rent: number | null;
  offered_at: string | null;
  response_at: string | null;
  response_deadline: string | null;
  approved_at: string | null;
  lease_end_date: string | null;
  created_at: string;
}

// ── Move-Out types ───────────────────────────────────────────────

export interface MoveOut {
  id: string;
  application_id: string;
  tenant_name: string;
  property_name: string;
  status: string;
  notice_date: string;
  expected_vacate_date: string;
  actual_vacate_date: string | null;
  forwarding_address: string | null;
  pre_inspection_date: string | null;
  pre_inspection_notes: string | null;
  final_inspection_date: string | null;
  final_inspection_notes: string | null;
  deposit_amount: number | null;
  deductions_total: number | null;
  deductions_detail: Record<string, number>;
  refund_amount: number | null;
  deposit_deadline: string | null;
  unpaid_rent_balance: number | null;
  created_at: string;
}

// ── Eviction types ───────────────────────────────────────────────

export interface Violation {
  id: string;
  application_id: string;
  property_id: string;
  tenant_name: string;
  property_name: string;
  violation_type: string;
  status: string;
  description: string;
  occurred_at: string;
  is_material_breach: boolean;
  vawa_flagged: boolean;
  warning_issued_at: string | null;
  notice_served_at: string | null;
  cure_deadline: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface EvictionNotice {
  id: string;
  application_id: string;
  violation_id: string | null;
  notice_type: string;
  status: string;
  tenant_name: string;
  property_address: string;
  unit_number: string | null;
  amount_owed: number | null;
  notice_text: string;
  serve_date: string | null;
  expiration_date: string | null;
  certificate_of_mailing: boolean;
  cares_act_applicable: boolean;
  created_at: string;
}

export interface EvictionCase {
  id: string;
  application_id: string;
  tenant_name: string;
  property_name: string;
  status: string;
  case_number: string | null;
  jurisdiction: string | null;
  filing_date: string | null;
  hearing_date: string | null;
  judgment_date: string | null;
  judgment_amount: number | null;
  notes: string | null;
  created_at: string;
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
