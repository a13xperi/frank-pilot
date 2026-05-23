/**
 * Compliance Bridge — pure designation/ceiling math (Phase 3).
 *
 * Closes the flywheel: an acq_project that won credits (an acq_award), once
 * bound to a managed property, commits a unit mix at given AMI tiers. This
 * module turns that commitment into a per-unit AMI designation plan and derives
 * the rent/income ceiling each designation enforces — the LURA obligation the
 * credits were awarded for.
 *
 * Pure and DB-free: the service (award-service.ts) reads the project's
 * commitment + the property's current unit designations and passes plain
 * numbers in, so the math stays deterministic and unit-testable.
 */
import { RENT_ELECTIONS, type ElectionKind } from './qap-2026';

/** A unit's AMI designation. Mirrors the units.ami_designation CHECK. */
export type AmiDesignation = '30' | '50' | '60' | 'market';

/** The three restricted tiers, deepest first (placement priority). */
export const RESTRICTED_DESIGNATIONS: ReadonlyArray<Exclude<AmiDesignation, 'market'>> = [
  '30',
  '50',
  '60',
] as const;

/**
 * Rent/income ceiling a designation enforces, as a % of Area Median Income.
 * `market` units carry no AMI ceiling (null). This is what a recertification
 * income check measures a household against (next slice).
 */
export function amiCeilingPct(designation: AmiDesignation): number | null {
  switch (designation) {
    case '30':
      return 30;
    case '50':
      return 50;
    case '60':
      return 60;
    case 'market':
      return null;
  }
}

/** The project's committed unit mix — the counts persisted on acq_projects. */
export interface CommittedMix {
  totalUnits: number;
  units30Ami: number;
  units50Ami: number;
  units60Ami: number;
  electionKind: ElectionKind;
}

/** Committed count per designation, derived from the project's mix. */
export type DesignationTargets = Record<AmiDesignation, number>;

/**
 * The project commits N units at each restricted tier; the balance up to
 * totalUnits is market-rate. Restricted commitments above totalUnits are
 * clamped (the Phase 2 schema already guards this, but stay defensive).
 */
export function designationTargets(mix: CommittedMix): DesignationTargets {
  const restricted = mix.units30Ami + mix.units50Ami + mix.units60Ami;
  const market = Math.max(0, mix.totalUnits - restricted);
  return {
    '30': mix.units30Ami,
    '50': mix.units50Ami,
    '60': mix.units60Ami,
    market,
  };
}

export interface DesignationPlanRow {
  designation: AmiDesignation;
  /** AMI ceiling this designation enforces, or null for market. */
  ceilingAmiPct: number | null;
  /** Units the award commits at this designation. */
  committed: number;
  /** Units on the bound property currently carrying this designation. */
  assigned: number;
  /** committed − assigned; negative = over-assigned past the commitment. */
  remaining: number;
}

export interface DesignationPlan {
  /** Election the commitment derives from, for display. */
  electionLabel: string;
  /** Total restricted units the award commits (30+50+60). */
  committedRestricted: number;
  /** Restricted units currently designated on the property. */
  assignedRestricted: number;
  /** Actual unit count on the bound property. */
  propertyUnits: number;
  rows: DesignationPlanRow[];
  /** True once the property's restricted designations meet the commitment. */
  meetsCommitment: boolean;
  note: string;
}

/**
 * Build the plan that drives the UI: per-designation committed vs currently
 * assigned on the bound property, and whether the LURA commitment is met.
 *
 * @param mix              the project's committed unit mix
 * @param currentCounts    units on the property by current designation
 * @param propertyUnits    total unit rows on the bound property
 */
export function buildDesignationPlan(
  mix: CommittedMix,
  currentCounts: DesignationTargets,
  propertyUnits: number,
): DesignationPlan {
  const targets = designationTargets(mix);
  const designations: AmiDesignation[] = ['30', '50', '60', 'market'];

  const rows: DesignationPlanRow[] = designations.map((designation) => {
    const committed = targets[designation];
    const assigned = currentCounts[designation] ?? 0;
    return {
      designation,
      ceilingAmiPct: amiCeilingPct(designation),
      committed,
      assigned,
      remaining: committed - assigned,
    };
  });

  const committedRestricted = mix.units30Ami + mix.units50Ami + mix.units60Ami;
  const assignedRestricted = RESTRICTED_DESIGNATIONS.reduce(
    (sum, d) => sum + (currentCounts[d] ?? 0),
    0,
  );

  // Commitment is met when each restricted tier is designated at or above its
  // committed count — under-designating any deep tier is a LURA shortfall.
  const meetsCommitment = RESTRICTED_DESIGNATIONS.every(
    (d) => (currentCounts[d] ?? 0) >= targets[d],
  );

  let note: string;
  if (committedRestricted === 0) {
    note = 'Award commits no restricted units.';
  } else if (meetsCommitment) {
    note = `All ${committedRestricted} committed restricted units are designated.`;
  } else {
    note = `${assignedRestricted}/${committedRestricted} committed restricted units designated.`;
  }

  return {
    electionLabel: RENT_ELECTIONS[mix.electionKind].label,
    committedRestricted,
    assignedRestricted,
    propertyUnits,
    rows,
    meetsCommitment,
    note,
  };
}

/**
 * Available Unit Rule factor (IRC §42(g)(2)(D)(ii)). At recertification a
 * household keeps qualifying until its income exceeds 140% of the applicable
 * income limit. Past that the unit no longer counts toward the set-aside until
 * the Next Available Unit Rule is satisfied — the *initial* certification uses
 * 100% of the limit, but recerts use this higher ceiling.
 */
export const RECERT_AUR_FACTOR = 1.4;

/**
 * Verdict of a recertification income-ceiling check against the unit's actual
 * AMI designation:
 *  - not_restricted: market unit (or undesignated) — no LIHTC income ceiling.
 *  - qualified:      income at or under the applicable limit.
 *  - over_income_aur: over the limit but ≤140% — still LIHTC-qualified, but the
 *      Available Unit Rule now governs the next comparable vacancy.
 *  - over_income:    over 140% — unit out of compliance until AUR is satisfied.
 *  - indeterminate:  missing designation/limit/income — needs manual review.
 */
export type RecertIncomeVerdict =
  | 'not_restricted'
  | 'qualified'
  | 'over_income_aur'
  | 'over_income'
  | 'indeterminate';

export interface RecertIncomeInput {
  /** The occupied unit's AMI designation (units.ami_designation), or null. */
  designation: AmiDesignation | null;
  /** Applicable annual income limit ($) for the tier + household size, or null. */
  applicableLimit: number | null;
  /** Recertified household annual income ($), or null if not on file. */
  householdIncome: number | null;
}

export interface RecertIncomeCheck {
  verdict: RecertIncomeVerdict;
  /** AMI ceiling % the designation enforces (30/50/60), or null. */
  ceilingAmiPct: number | null;
  /** The applicable income limit ($) measured against, or null. */
  applicableLimit: number | null;
  /** 140% Available Unit Rule threshold ($), or null when not restricted. */
  aurThreshold: number | null;
  /** Income measured ($), or null. */
  householdIncome: number | null;
  /** Income as a % of the applicable limit, or null. */
  pctOfLimit: number | null;
  /** Human-readable explanation for the reviewer / tape evidence. */
  note: string;
}

/**
 * Evaluate a household's recertified income against the income ceiling its
 * occupied unit's AMI designation enforces, applying the 140% Available Unit
 * Rule. Pure: the service resolves designation + limit + income from the DB and
 * passes plain numbers in.
 */
export function evaluateRecertIncome(input: RecertIncomeInput): RecertIncomeCheck {
  const { designation, applicableLimit, householdIncome } = input;
  const ceilingAmiPct = designation ? amiCeilingPct(designation) : null;

  // Market or undesignated unit → no LIHTC income ceiling to enforce.
  if (designation === null || designation === 'market') {
    return {
      verdict: 'not_restricted',
      ceilingAmiPct: null,
      applicableLimit: null,
      aurThreshold: null,
      householdIncome,
      pctOfLimit: null,
      note:
        designation === 'market'
          ? 'Unit is market-rate — no LIHTC income ceiling applies.'
          : 'Unit has no AMI designation — no income ceiling to enforce.',
    };
  }

  if (applicableLimit === null || householdIncome === null) {
    return {
      verdict: 'indeterminate',
      ceilingAmiPct,
      applicableLimit,
      aurThreshold: applicableLimit === null ? null : applicableLimit * RECERT_AUR_FACTOR,
      householdIncome,
      pctOfLimit:
        applicableLimit && householdIncome !== null
          ? (householdIncome / applicableLimit) * 100
          : null,
      note:
        applicableLimit === null
          ? `No income limit on file for the ${ceilingAmiPct}% AMI tier and household size — manual review required.`
          : 'No recertified income on file — manual review required.',
    };
  }

  const aurThreshold = applicableLimit * RECERT_AUR_FACTOR;
  const pctOfLimit = (householdIncome / applicableLimit) * 100;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  let verdict: RecertIncomeVerdict;
  let note: string;
  if (householdIncome <= applicableLimit) {
    verdict = 'qualified';
    note = `Income ${fmt(householdIncome)} is within the ${ceilingAmiPct}% AMI limit ${fmt(applicableLimit)}.`;
  } else if (householdIncome <= aurThreshold) {
    verdict = 'over_income_aur';
    note = `Income ${fmt(householdIncome)} exceeds the ${ceilingAmiPct}% AMI limit ${fmt(applicableLimit)} but is within 140% (${fmt(aurThreshold)}). Household stays qualified; the Available Unit Rule now governs the next comparable vacancy.`;
  } else {
    verdict = 'over_income';
    note = `Income ${fmt(householdIncome)} exceeds 140% of the ${ceilingAmiPct}% AMI limit (${fmt(aurThreshold)}). Unit is out of compliance until the Next Available Unit Rule is satisfied.`;
  }

  return {
    verdict,
    ceilingAmiPct,
    applicableLimit,
    aurThreshold,
    householdIncome,
    pctOfLimit,
    note,
  };
}

export interface AssignmentError {
  unitId: string;
  reason: string;
}

/**
 * Validate a proposed { unitId → designation } assignment against the set of
 * units that actually belong to the bound property. Returns the list of
 * problems (empty = valid). Keeps the service's apply path honest without a DB
 * round-trip per row.
 */
export function validateAssignments(
  assignments: ReadonlyArray<{ unitId: string; designation: AmiDesignation }>,
  propertyUnitIds: ReadonlySet<string>,
): AssignmentError[] {
  const errors: AssignmentError[] = [];
  const seen = new Set<string>();
  const valid: AmiDesignation[] = ['30', '50', '60', 'market'];

  for (const { unitId, designation } of assignments) {
    if (!propertyUnitIds.has(unitId)) {
      errors.push({ unitId, reason: 'Unit does not belong to the bound property.' });
    }
    if (!valid.includes(designation)) {
      errors.push({ unitId, reason: `Invalid designation "${designation}".` });
    }
    if (seen.has(unitId)) {
      errors.push({ unitId, reason: 'Duplicate assignment for unit.' });
    }
    seen.add(unitId);
  }
  return errors;
}
