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
