// ── Auth (shared shape with the staff console) ───────────────────────────────

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

export function formatRole(role: UserRole): string {
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Acquisitions / QAP demand (mirrors src/modules/acquisitions) ─────────────

export type GeographicAccount = 'CLARK' | 'WASHOE' | 'OTHER';
export type AmiTier = '30' | '50' | '60' | '80';

export const GEO_LABELS: Record<GeographicAccount, string> = {
  CLARK: 'Clark County',
  WASHOE: 'Washoe County',
  OTHER: 'Balance of State',
};

export interface DemandCell {
  account: GeographicAccount;
  bedrooms: number;
  tier: AmiTier;
  qualifiedApplicants: number;
}

export interface SupplyCell {
  account: GeographicAccount;
  bedrooms: number;
  availableUnits: number;
  totalUnits: number;
  waitlistDepth: number;
}

export interface DemandRollup {
  filters: { account?: GeographicAccount; bedrooms?: number; tier?: AmiTier };
  demand: DemandCell[];
  supply: SupplyCell[];
  totals: {
    qualifiedApplicants: number;
    waitlistDepth: number;
    availableUnits: number;
    totalUnits: number;
  };
}

export interface DemandPacket {
  account: GeographicAccount;
  accountLabel: string;
  generatedAt: string;
  demand: {
    qualifiedApplicants: number;
    waitlistDepth: number;
    deepDemandSharePct: number;
  };
  supply: {
    availableUnits: number;
    totalUnits: number;
  };
  targetingMix: Array<{ tier: AmiTier; qualifiedApplicants: number; sharePct: number }>;
  marketStudy: {
    captureRatePct: number | null;
    maxAcceptableCaptureRatePct: number;
    meetsCaptureThreshold: boolean;
  };
  basisBoost: {
    properties: number;
    qctOrDdaProperties: number;
    boostPct: number;
    eligible: boolean;
  };
}

export function bedroomLabel(n: number): string {
  return n === 0 ? 'Studio' : `${n} BR`;
}

// ── Candidate projects + scoring (Phase 2, mirrors scoring.ts / qap-2026.ts) ──

export type SetAsideAccount = 'NONPROFIT' | 'USDA_RD' | 'TRIBAL' | 'ADDITIONAL';
export type ElectionKind = 'STD_40_60' | 'STD_20_50' | 'AVERAGE_INCOME';
export type ResidentService =
  | 'after_school'
  | 'job_training'
  | 'health_screening'
  | 'financial_literacy'
  | 'transportation'
  | 'case_management';

export const SET_ASIDE_LABELS: Record<SetAsideAccount, string> = {
  NONPROFIT: 'Nonprofit',
  USDA_RD: 'USDA Rural Development',
  TRIBAL: 'Tribal',
  ADDITIONAL: 'Additional / general',
};

export const ELECTION_LABELS: Record<ElectionKind, string> = {
  STD_40_60: '40% @ 60% AMI',
  STD_20_50: '20% @ 50% AMI',
  AVERAGE_INCOME: 'Average income (≤60% avg)',
};

// Per-service points mirror RESIDENT_SERVICES in qap-2026.ts (case mgmt = 2).
export const RESIDENT_SERVICE_OPTIONS: Array<{ key: ResidentService; label: string; points: number }> = [
  { key: 'after_school', label: 'After-school program', points: 1 },
  { key: 'job_training', label: 'Job training / placement', points: 1 },
  { key: 'health_screening', label: 'Health screening', points: 1 },
  { key: 'financial_literacy', label: 'Financial literacy', points: 1 },
  { key: 'transportation', label: 'Transportation assistance', points: 1 },
  { key: 'case_management', label: 'Case management', points: 2 },
];

export interface ProjectInput {
  name: string;
  geographicAccount: GeographicAccount;
  city?: string | null;
  setAside?: SetAsideAccount | null;
  electionKind: ElectionKind;
  totalUnits: number;
  units30Ami: number;
  units50Ami: number;
  units60Ami: number;
  isQct: boolean;
  isDda: boolean;
  residentServices: ResidentService[];
  notes?: string | null;
}

export interface AcqProject extends ProjectInput {
  id: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CriterionScore {
  key: string;
  section: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface ProjectScore {
  funnelPoints: number;
  funnelMaxPoints: number;
  criteria: CriterionScore[];
  marketStudy: {
    affordableUnits: number;
    qualifiedDemand: number;
    captureRatePct: number | null;
    maxAcceptableCaptureRatePct: number;
    meetsThreshold: boolean;
  };
  basisBoost: {
    eligible: boolean;
    boostPct: number;
  };
  eligibility: {
    minPct: number;
    subsetPct: number;
    note: string;
  };
}

export interface ScoredProject {
  project: AcqProject;
  score: ProjectScore;
}

// ── Awards + compliance bridge (Phase 3, mirrors award-service.ts) ────────────

export type AmiDesignation = '30' | '50' | 'market';
// The persisted designation also allows '60'; kept as a union for the grid.
export type UnitDesignation = '30' | '50' | '60' | 'market';
export type AwardStatus = 'reserved' | 'placed_in_service' | 'in_service' | 'closed';

export const AWARD_STATUS_LABELS: Record<AwardStatus, string> = {
  reserved: 'Reserved',
  placed_in_service: 'Placed in service',
  in_service: 'In service',
  closed: 'Closed',
};

export const DESIGNATION_LABELS: Record<UnitDesignation, string> = {
  '30': '30% AMI',
  '50': '50% AMI',
  '60': '60% AMI',
  market: 'Market',
};

export interface AcqAward {
  id: string;
  acqProjectId: string;
  propertyId: string | null;
  status: AwardStatus;
  reservationAmount: number | null;
  awardDate: string | null;
  placedInServiceDeadline: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AwardCreateInput {
  acqProjectId: string;
  propertyId?: string | null;
  status?: AwardStatus;
  reservationAmount?: number | null;
  awardDate?: string | null;
  placedInServiceDeadline?: string | null;
  notes?: string | null;
}

export interface DesignationPlanRow {
  designation: UnitDesignation;
  ceilingAmiPct: number | null;
  committed: number;
  assigned: number;
  remaining: number;
}

export interface DesignationPlan {
  electionLabel: string;
  committedRestricted: number;
  assignedRestricted: number;
  propertyUnits: number;
  rows: DesignationPlanRow[];
  meetsCommitment: boolean;
  note: string;
}

export interface BoundUnit {
  id: string;
  unitNumber: string;
  bedrooms: number;
  amiDesignation: UnitDesignation | null;
}

// Minimal property shape from GET /api/properties (root list).
export interface PropertyLite {
  id: string;
  name: string;
  city?: string | null;
}

// ── Recertifications (Phase 3.1 — income ceiling enforcement) ────────────────

export type RecertStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'waived'
  | 'overdue';

export const RECERT_STATUS_LABELS: Record<RecertStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  waived: 'Waived',
  overdue: 'Overdue',
};

export interface Recertification {
  id: string;
  tenantId: string;
  tenantName: string | null;
  propertyId: string | null;
  propertyName: string | null;
  unitId: string | null;
  unitNumber: string | null;
  designation: UnitDesignation | null;
  status: RecertStatus;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// GET /api/recertifications/:id/income-check
export type IncomeVerdict =
  | 'not_restricted'
  | 'qualified'
  | 'over_income_aur'
  | 'over_income'
  | 'indeterminate';

export interface RecertIncomeCheckContext {
  recertId: string;
  tenantName?: string | null;
  unitNumber: string | null;
  designation: UnitDesignation | null;
  amiArea: string | null;
  limitYear: number | null;
  [key: string]: unknown;
}

export interface RecertIncomeCheckResult {
  verdict: IncomeVerdict;
  ceilingAmiPct: number | null;
  applicableLimit: number | null;
  aurThreshold: number | null;
  householdIncome: number | null;
  pctOfLimit: number | null;
  note: string | null;
}

export interface RecertIncomeCheck {
  context: RecertIncomeCheckContext;
  check: RecertIncomeCheckResult;
}

// GET /api/acquisitions/aur-queue
// Backend nau_status column (Lane 1): 'open' once an over_income obligation is
// triggered, 'satisfied' when a comparable unit resolves it, 'lost' on failure,
// or null when there is no NAU obligation (e.g. over_income_aur rows).
export type NauStatus = 'open' | 'satisfied' | 'lost' | null;

export interface AurQueueItem {
  recertId: string;
  tenantName: string | null;
  propertyName: string | null;
  unitNumber: string | null;
  designation: UnitDesignation | null;
  verdict: IncomeVerdict;
  householdIncome: number | null;
  applicableLimit: number | null;
  aurThreshold: number | null;
  nauStatus: NauStatus;
}

export interface AurQueueResponse {
  queue: AurQueueItem[];
  total: number;
}

// POST /api/recertifications/:id/nau-resolve
export interface NauResolveInput {
  resolvingUnitId: string;
  notes?: string | null;
}

export interface NauResolveResponse {
  id: string;
  [key: string]: unknown;
}
