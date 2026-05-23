/**
 * Nevada 2026 LIHTC QAP — focused, typed reference.
 *
 * Hand-maintained per plan year (mirrors the `limits-2026.generated.ts` style,
 * but authored not generated: the QAP is a 53-page legal document, not a data
 * export). This module encodes ONLY the subset the Frank-Pilot funnel directly
 * feeds — the set-aside/geographic accounts, the income/rent elections, and the
 * scoring criteria whose evidence is AMI-qualified demand. The full 97-point
 * §7 rubric, pro-forma feasibility, and the 4%-bond Board-of-Finance flow are
 * intentionally out of scope (see docs/qap-acquisitions.md).
 *
 * Source: Nevada Housing Division — 2026 Qualified Allocation Plan
 * (rev. 03.25.2026). Section citations (§) refer to that document.
 */

// ── Set-aside accounts (§3) ──────────────────────────────────────────────────
// Federal credit ceiling is carved into set-aside accounts before the
// geographic split. Percentages are of the annual state credit ceiling.

export type SetAsideAccount = 'NONPROFIT' | 'USDA_RD' | 'TRIBAL' | 'ADDITIONAL';

export interface SetAside {
  readonly account: SetAsideAccount;
  readonly label: string;
  readonly ceilingPct: number;
  readonly note: string;
}

export const SET_ASIDES: Readonly<Record<SetAsideAccount, SetAside>> = {
  NONPROFIT: {
    account: 'NONPROFIT',
    label: 'Nonprofit',
    ceilingPct: 10,
    note: 'Federal minimum 10% set-aside for qualified nonprofit ownership (IRC §42(h)(5)).',
  },
  USDA_RD: {
    account: 'USDA_RD',
    label: 'USDA Rural Development',
    ceilingPct: 10,
    note: 'Rural projects with USDA-RD financing (§514/515/538).',
  },
  TRIBAL: {
    account: 'TRIBAL',
    label: 'Tribal',
    ceilingPct: 15,
    note: 'Projects on or serving Tribal lands.',
  },
  ADDITIONAL: {
    account: 'ADDITIONAL',
    label: 'Additional / general',
    ceilingPct: 10,
    note: 'General pool for projects not competing in another set-aside.',
  },
} as const;

// ── Geographic accounts (§3) ─────────────────────────────────────────────────
// After set-asides, credits are split across three geographic accounts by the
// state's population/need formula. This is the bucket every demand rollup maps
// to — the QAP competes projects WITHIN their geographic account.

export type GeographicAccount = 'CLARK' | 'WASHOE' | 'OTHER';

export interface GeoAccount {
  readonly account: GeographicAccount;
  readonly label: string;
  readonly ceilingPct: number;
}

export const GEOGRAPHIC_ACCOUNTS: Readonly<Record<GeographicAccount, GeoAccount>> = {
  CLARK: { account: 'CLARK', label: 'Clark County', ceilingPct: 54 },
  WASHOE: { account: 'WASHOE', label: 'Washoe County', ceilingPct: 29 },
  OTHER: { account: 'OTHER', label: 'Balance of State', ceilingPct: 17 },
} as const;

// ── Income / rent elections (§6.3) ───────────────────────────────────────────
// The minimum set-aside election the project commits to at application. Drives
// per-unit AMI designation (Phase 3) and the low-income targeting score below.

export type ElectionKind = 'STD_40_60' | 'STD_20_50' | 'AVERAGE_INCOME';

export interface RentElection {
  readonly kind: ElectionKind;
  readonly label: string;
  readonly minSetAsidePct: number; // % of units that must be rent/income-restricted
  readonly ceilingAmiPct: number; // the AMI ceiling those units are capped at
  readonly note: string;
}

export const RENT_ELECTIONS: Readonly<Record<ElectionKind, RentElection>> = {
  STD_40_60: {
    kind: 'STD_40_60',
    label: '40% @ 60% AMI',
    minSetAsidePct: 40,
    ceilingAmiPct: 60,
    note: 'At least 40% of units at or below 60% AMI.',
  },
  STD_20_50: {
    kind: 'STD_20_50',
    label: '20% @ 50% AMI',
    minSetAsidePct: 20,
    ceilingAmiPct: 50,
    note: 'At least 20% of units at or below 50% AMI.',
  },
  AVERAGE_INCOME: {
    kind: 'AVERAGE_INCOME',
    label: 'Average income (≤60% avg)',
    minSetAsidePct: 40,
    ceilingAmiPct: 80,
    note: 'Units 20–80% AMI averaging ≤60%; min 40% of units restricted (Appendix B).',
  },
} as const;

// ── §7.4.1 Low-Rent Targeting (6 pts) ────────────────────────────────────────
// Points scale with the share of units committed at the deepest rent tiers.
// The funnel proves there is qualified demand AT those tiers — the evidence
// that makes a deep-targeting commitment credible to the allocator.

export interface LowRentTier {
  readonly amiPct: 30 | 50 | 60;
  /** % of total units committed at or below this AMI to earn `points`. */
  readonly unitSharePct: number;
  readonly points: number;
}

/** Highest-first so a project's deepest qualifying commitment scores first. */
export const LOW_RENT_TARGETING: ReadonlyArray<LowRentTier> = [
  { amiPct: 30, unitSharePct: 10, points: 6 },
  { amiPct: 30, unitSharePct: 5, points: 4 },
  { amiPct: 50, unitSharePct: 20, points: 3 },
  { amiPct: 50, unitSharePct: 10, points: 2 },
  { amiPct: 60, unitSharePct: 40, points: 1 },
] as const;

export const LOW_RENT_TARGETING_MAX_POINTS = 6;

// ── §7.4.2 Low-Income Targeting (2 pts) ──────────────────────────────────────
// A flat bonus for electing the deeper 20%@50% (or average-income) set-aside
// over the standard 40%@60%.

export const LOW_INCOME_TARGETING = {
  maxPoints: 2,
  /** Elections that earn the deep-targeting bonus. */
  qualifyingElections: ['STD_20_50', 'AVERAGE_INCOME'] as ReadonlyArray<ElectionKind>,
} as const;

// ── §7.4.3 Resident Services (6 pts) ─────────────────────────────────────────
// Points for committed on-site services. Encoded as a menu; a project's score
// is the sum of selected services capped at the section max.

export type ResidentService =
  | 'after_school'
  | 'job_training'
  | 'health_screening'
  | 'financial_literacy'
  | 'transportation'
  | 'case_management';

export const RESIDENT_SERVICES: Readonly<Record<ResidentService, { label: string; points: number }>> = {
  after_school: { label: 'After-school program', points: 1 },
  job_training: { label: 'Job training / placement', points: 1 },
  health_screening: { label: 'Health screening', points: 1 },
  financial_literacy: { label: 'Financial literacy', points: 1 },
  transportation: { label: 'Transportation assistance', points: 1 },
  case_management: { label: 'Case management', points: 2 },
} as const;

export const RESIDENT_SERVICES_MAX_POINTS = 6;

// ── §7.3.1 Location / basis boost (§11) ──────────────────────────────────────

export const LOCATION_SCORING = {
  /** Points for siting in a HUD Qualified Census Tract or Difficult Dev. Area. */
  qctDdaPoints: 3,
  /** Eligible-basis boost granted to QCT/DDA projects (§11). */
  basisBoostPct: 30,
} as const;

// ── §6.1 Market study triggers (Appendix A) ──────────────────────────────────
// The allocator requires a market study demonstrating demand. These thresholds
// are what the Demand-Evidence packet is measured against.

export const MARKET_STUDY = {
  /** Max acceptable capture rate (qualified demand absorbed by the project). */
  maxCaptureRatePct: 30,
  /** Minimum months of absorption demand the study must show. */
  minAbsorptionMonths: 6,
} as const;

// ── Eligibility floor (§7) ───────────────────────────────────────────────────
// A project must score at least this share of available points to be eligible
// for an allocation, regardless of competitive rank.
export const MIN_ELIGIBILITY_PCT = 60;
