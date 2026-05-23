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
