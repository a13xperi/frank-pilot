/**
 * HUD / FHA criminal-background decision engine (LIHTC / Section 42, Nevada).
 *
 * This is the compliance heart of the background check. It replaces a naive
 * blanket auto-fail ("any felony / sex offense / violent crime → deny") with the
 * individualized-assessment framework that docs/screening/hud-criminal-decision-matrix.md
 * derives from 24 CFR Part 5 Subpart I, §960.204, the FHA disparate-impact rule
 * (24 CFR §100.500), and the 2016 OGC "Castro" memo §III.
 *
 * Three outcomes:
 *   - "mandatory_denial"        — a federal floor requires denial, no assessment
 *                                 needed (24 CFR §5.856 lifetime registrant;
 *                                 §960.204(a)(2)/(a)(3) current drug use / meth
 *                                 manufacture; §960.204(a)(1) 3-yr drug-eviction).
 *   - "individualized_review"   — a discretionary record inside the lookback (or
 *                                 an open/undated one). MUST route to a HOLD: never
 *                                 auto-deny (Castro forbids time-blind blanket bans),
 *                                 never auto-pass (the assessment must happen first).
 *   - "clear"                   — nothing in scope for denial consideration
 *                                 (aged-out, arrest-only, dismissed, or no record).
 *
 * NOTE ON THE 2025 TURNER RESCISSION: HUD rescinded PIH 2015-19, the Castro memo,
 * and the McCain memo on 2025-11-25, but that is sub-regulatory — the Fair Housing
 * Act and 24 CFR §100.500 are UNCHANGED, so private disparate-impact exposure
 * persists. Per the standing compliance directive, Frank keeps the
 * individualized-assessment workflow + Castro lookback ceilings as DEFAULTS and
 * never ships a blanket ban. An operator may tighten lookbacks via `policy`, but
 * the engine will never auto-fail a discretionary record.
 *
 * Pure & deterministic: no I/O, no env reads, no clock except the injectable
 * `asOf` (defaults to now). Safe to unit-test exhaustively.
 */

export type CriminalDecision = "clear" | "individualized_review" | "mandatory_denial";

/**
 * Offense categories. The first four are the federal mandatory floors; the rest
 * are discretionary and constrained only by the FHA + a published lookback.
 */
export type OffenseCategory =
  // ── Mandatory federal floors ───────────────────────────────────────────────
  | "sex_offense_lifetime_registrant" // §5.856 — current registry status, permanent
  | "meth_manufacture_assisted_property" // §960.204(a)(3) — permanent
  | "current_illegal_drug_use" // §960.204(a)(2) — current behavior
  | "drug_related_eviction" // §960.204(a)(1) — 3-yr lookback from eviction
  // ── Discretionary (individualized assessment required before denial) ────────
  | "felony_violent"
  | "felony_sexual" // a sexual felony that is NOT a lifetime-registry hit
  | "felony_arson"
  | "felony_nonviolent"
  | "misdemeanor_violent"
  | "misdemeanor_nonviolent"
  | "drug_other" // non-meth, non-eviction drug offense
  | "other";

export type Disposition =
  | "convicted"
  | "arrest_only" // Castro §III.A — NEVER use, exclusion not defensible
  | "dismissed"
  | "acquitted"
  | "expunged"
  | "pending" // open charge → no-data → pause (individualized review)
  | "open"
  | "unknown";

export interface CriminalRecord {
  category: OffenseCategory;
  disposition?: Disposition;
  /** ISO date the offense occurred. */
  offenseDate?: string;
  /** ISO date of conviction / disposition. */
  dispositionDate?: string;
  /** ISO date released from custody — preferred anchor for post-release lookbacks. */
  releaseDate?: string;
  /** True when the subject is currently subject to lifetime sex-offender registration. */
  lifetimeRegistrant?: boolean;
  /** For meth-manufacture: occurred on the premises of federally assisted housing. */
  onAssistedProperty?: boolean;
  description?: string;
}

/**
 * Lookback ceilings (years) for the discretionary categories. Defaults reflect
 * the industry-consensus / Castro-era ceilings in the decision matrix §6.
 * Operators may tighten these via policy, but cannot turn a discretionary record
 * into an auto-fail — the engine only ever returns individualized_review for them.
 */
export interface LookbackPolicy {
  felonyViolentYears: number;
  felonyNonviolentYears: number;
  misdemeanorViolentYears: number;
  misdemeanorNonviolentYears: number;
  drugOtherYears: number;
  /** §960.204(a)(1) mandatory window — denial mandated for this many years post-eviction. */
  drugEvictionYears: number;
  /**
   * When a discretionary conviction carries no usable date, treat it as
   * in-lookback (→ individualized review) rather than silently aging it out.
   * Default true — we never silent-clear an undated conviction.
   */
  undatedConvictionInLookback: boolean;
}

export const DEFAULT_LOOKBACK_POLICY: LookbackPolicy = {
  felonyViolentYears: 7, // felony violent / sexual / arson — 5–7 yrs post-release
  felonyNonviolentYears: 5,
  misdemeanorViolentYears: 3,
  misdemeanorNonviolentYears: 1, // 1–3 yrs or skip; conservative 1-yr IA window
  drugOtherYears: 3, // §960.204(a)(1) federal floor by analogy
  drugEvictionYears: 3, // §960.204(a)(1) mandatory
  undatedConvictionInLookback: true,
};

export interface CriminalAssessmentFactors {
  /** Categories / descriptions of the records that triggered the hold. */
  natureAndSeverity: string[];
  /** Smallest years-elapsed among triggering discretionary records; null if undated/open. */
  timeElapsedYears: number | null;
  /** Lookback ceiling applied; null when not date-driven (legacy summary / open case). */
  applicableLookbackYears: number | null;
  mitigatingEvidenceRequired: true;
  /** The Castro §III.B workflow staff must complete before any denial. */
  workflow: string;
}

/** Discretionary categories that may be provided as a legacy summary, plus
 *  optional structured records and explicit mandatory signals. */
export interface CriminalHistoryInput {
  /** Structured records — authoritative when present (real vendor path). */
  records?: CriminalRecord[];
  // ── Legacy summary flags (the current sandbox / integration path) ───────────
  felonies?: number;
  /** Sex-offender registry hit (NSOPW / §5.856) — treated as a mandatory floor. */
  sexOffenses?: boolean;
  violentCrimes?: boolean;
  // ── Explicit mandatory signals (always honored, structured or not) ──────────
  methManufactureOnAssistedProperty?: boolean;
  currentIllegalDrugUse?: boolean;
  /** A drug-related eviction inside the §960.204(a)(1) 3-yr window. */
  drugRelatedEvictionWithinLookback?: boolean;
}

export interface CriminalDecisionResult {
  decision: CriminalDecision;
  reasons: string[];
  citations: string[];
  /** Present only when decision === "individualized_review". */
  assessmentFactors?: CriminalAssessmentFactors;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const CASTRO_WORKFLOW =
  "Castro §III.B: notify the applicant and identify the record relied on → " +
  "give an opportunity to provide mitigating evidence → document the nature & " +
  "severity of the conduct, the time elapsed, and the mitigating evidence → " +
  "issue a written rationale. Retain the file ≥3 years.";

/** Dispositions that must never contribute to a denial. */
const IGNORED_DISPOSITIONS: ReadonlySet<Disposition> = new Set([
  "arrest_only",
  "dismissed",
  "acquitted",
  "expunged",
]);

/** Open / pending charges — no-data, pause for resolution. */
const PENDING_DISPOSITIONS: ReadonlySet<Disposition> = new Set(["pending", "open"]);

/** Years-elapsed from the best available anchor; null when undated/unparseable. */
function yearsElapsed(record: CriminalRecord, asOf: Date): number | null {
  const raw = record.releaseDate || record.dispositionDate || record.offenseDate;
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return (asOf.getTime() - t) / MS_PER_YEAR;
}

function lookbackForCategory(category: OffenseCategory, policy: LookbackPolicy): number | null {
  switch (category) {
    case "felony_violent":
    case "felony_sexual":
    case "felony_arson":
      return policy.felonyViolentYears;
    case "felony_nonviolent":
      return policy.felonyNonviolentYears;
    case "misdemeanor_violent":
      return policy.misdemeanorViolentYears;
    case "misdemeanor_nonviolent":
      return policy.misdemeanorNonviolentYears;
    case "drug_other":
      return policy.drugOtherYears;
    default:
      return null; // mandatory / other — not lookback-driven here
  }
}

interface Accumulator {
  mandatory: boolean;
  needsAssessment: boolean;
  reasons: string[];
  citations: Set<string>;
  natureAndSeverity: string[];
  /** Smallest elapsed among discretionary triggers; null until a dated one is seen. */
  minElapsed: number | null;
  /** Lookback ceiling of the first dated discretionary trigger. */
  appliedLookback: number | null;
}

function addMandatory(acc: Accumulator, reason: string, citation: string): void {
  acc.mandatory = true;
  acc.reasons.push(reason);
  acc.citations.add(citation);
}

function addAssessment(
  acc: Accumulator,
  reason: string,
  citation: string,
  nature: string,
  elapsed: number | null,
  lookback: number | null
): void {
  acc.needsAssessment = true;
  acc.reasons.push(reason);
  acc.citations.add(citation);
  acc.natureAndSeverity.push(nature);
  if (elapsed !== null && (acc.minElapsed === null || elapsed < acc.minElapsed)) {
    acc.minElapsed = elapsed;
  }
  if (lookback !== null && acc.appliedLookback === null) {
    acc.appliedLookback = lookback;
  }
}

function processRecord(acc: Accumulator, record: CriminalRecord, policy: LookbackPolicy, asOf: Date): void {
  const label = record.description || record.category;

  // 1. §5.856 lifetime registrant — current status, disposition-independent.
  if (record.lifetimeRegistrant === true || record.category === "sex_offense_lifetime_registrant") {
    addMandatory(
      acc,
      `Lifetime sex-offender registrant (${label}) — mandatory denial`,
      "24 CFR §5.856; 42 USC §13663"
    );
    return;
  }

  // 2. Disposition gate (Castro §III.A).
  const disposition = record.disposition ?? "unknown";
  if (IGNORED_DISPOSITIONS.has(disposition)) {
    acc.reasons.push(`Ignored ${disposition} record (${label}) — not a usable basis for denial`);
    return;
  }
  if (PENDING_DISPOSITIONS.has(disposition)) {
    addAssessment(
      acc,
      `Open/pending charge (${label}) — treat as no-data; pause for individualized review`,
      "Castro memo §III.A",
      `${label} (pending)`,
      null,
      null
    );
    return;
  }

  // 3. Convicted / unknown disposition → classify.
  switch (record.category) {
    case "meth_manufacture_assisted_property":
      if (record.onAssistedProperty === false) {
        // Meth manufacture NOT on assisted property is discretionary, not the floor.
        addAssessment(
          acc,
          `Meth manufacture not on assisted property (${label}) — individualized review`,
          "Castro memo §III",
          label,
          yearsElapsed(record, asOf),
          policy.felonyViolentYears
        );
      } else {
        addMandatory(
          acc,
          `Methamphetamine manufacture on federally assisted property (${label}) — mandatory denial`,
          "24 CFR §960.204(a)(3); §5.854(b)"
        );
      }
      return;
    case "current_illegal_drug_use":
      addMandatory(
        acc,
        `Current illegal drug use (${label}) — mandatory denial per PHA reasonable cause`,
        "24 CFR §960.204(a)(2)"
      );
      return;
    case "drug_related_eviction": {
      const elapsed = yearsElapsed(record, asOf);
      const within =
        elapsed === null ? policy.undatedConvictionInLookback : elapsed <= policy.drugEvictionYears;
      if (within) {
        addMandatory(
          acc,
          `Drug-related eviction within ${policy.drugEvictionYears} years (${label}) — mandatory denial (waivable on rehab/incarceration)`,
          "24 CFR §960.204(a)(1)"
        );
      } else {
        acc.reasons.push(
          `Drug-related eviction older than ${policy.drugEvictionYears} years (${label}) — aged out of the mandatory window`
        );
      }
      return;
    }
    default: {
      // Discretionary categories (+ "other"): individualized assessment if in
      // lookback, otherwise aged out. Never auto-fail.
      const lookback = lookbackForCategory(record.category, policy);
      const elapsed = yearsElapsed(record, asOf);
      if (lookback === null) {
        // "other" — unknown conviction; conservatively require assessment.
        addAssessment(
          acc,
          `Unclassified conviction (${label}) — individualized review`,
          "Castro memo §III; 24 CFR §100.500",
          label,
          elapsed,
          null
        );
        return;
      }
      const within =
        elapsed === null ? policy.undatedConvictionInLookback : elapsed <= lookback;
      if (within) {
        const when = elapsed === null ? "date unknown" : `${elapsed.toFixed(1)} yrs ago`;
        addAssessment(
          acc,
          `${record.category} within ${lookback}-yr lookback (${label}, ${when}) — individualized assessment required before any denial`,
          "Castro memo §III; 24 CFR §100.500",
          label,
          elapsed,
          lookback
        );
      } else {
        acc.reasons.push(
          `${record.category} (${label}) outside the ${lookback}-yr lookback — aged out, not a basis for denial`
        );
      }
    }
  }
}

/**
 * Evaluate a criminal history into a HUD/FHA-compliant decision.
 *
 * When `records` are provided they are authoritative; the legacy summary flags
 * (`felonies` / `violentCrimes`) are then ignored to avoid double-counting.
 * Explicit mandatory signals (`sexOffenses`, meth, current-drug, drug-eviction)
 * are always honored.
 */
export function evaluateCriminalHistory(
  input: CriminalHistoryInput,
  opts?: { policy?: Partial<LookbackPolicy>; asOf?: Date }
): CriminalDecisionResult {
  const policy: LookbackPolicy = { ...DEFAULT_LOOKBACK_POLICY, ...(opts?.policy ?? {}) };
  const asOf = opts?.asOf ?? new Date();

  const acc: Accumulator = {
    mandatory: false,
    needsAssessment: false,
    reasons: [],
    citations: new Set<string>(),
    natureAndSeverity: [],
    minElapsed: null,
    appliedLookback: null,
  };

  // ── Explicit mandatory signals (always honored) ─────────────────────────────
  // A sex-offender registry hit (NSOPW / §5.856) is modeled in Frank as the
  // `sexOffenses` boolean; it is the lifetime mandatory floor.
  if (input.sexOffenses === true) {
    addMandatory(
      acc,
      "Sex-offender registry match — mandatory denial",
      "24 CFR §5.856; 42 USC §13663"
    );
  }
  if (input.methManufactureOnAssistedProperty === true) {
    addMandatory(
      acc,
      "Methamphetamine manufacture on federally assisted property — mandatory denial",
      "24 CFR §960.204(a)(3); §5.854(b)"
    );
  }
  if (input.currentIllegalDrugUse === true) {
    addMandatory(
      acc,
      "Current illegal drug use — mandatory denial per PHA reasonable cause",
      "24 CFR §960.204(a)(2)"
    );
  }
  if (input.drugRelatedEvictionWithinLookback === true) {
    addMandatory(
      acc,
      "Drug-related eviction within the 3-year window — mandatory denial (waivable on rehab/incarceration)",
      "24 CFR §960.204(a)(1)"
    );
  }

  const records = Array.isArray(input.records) ? input.records : [];
  if (records.length > 0) {
    // Structured path — authoritative.
    for (const record of records) processRecord(acc, record, policy, asOf);
  } else {
    // Legacy summary path — discretionary felony/violent flags → individualized
    // review (no dates available, so undated → in-lookback). Misdemeanor counts
    // are NOT a denial-consideration trigger here; the caller applies its own
    // soft risk-score logic for those.
    if ((input.felonies ?? 0) > 0) {
      addAssessment(
        acc,
        `${input.felonies} felony conviction(s) reported — individualized assessment required before any denial (no time-blind ban)`,
        "Castro memo §III; 24 CFR §100.500",
        "felony conviction (summary)",
        null,
        null
      );
    }
    if (input.violentCrimes === true) {
      addAssessment(
        acc,
        "Violent crime reported — individualized assessment required before any denial",
        "Castro memo §III; 24 CFR §100.500",
        "violent crime (summary)",
        null,
        null
      );
    }
  }

  const citations = Array.from(acc.citations);

  if (acc.mandatory) {
    return { decision: "mandatory_denial", reasons: acc.reasons, citations };
  }
  if (acc.needsAssessment) {
    return {
      decision: "individualized_review",
      reasons: acc.reasons,
      citations,
      assessmentFactors: {
        natureAndSeverity: acc.natureAndSeverity,
        timeElapsedYears: acc.minElapsed === null ? null : Number(acc.minElapsed.toFixed(1)),
        applicableLookbackYears: acc.appliedLookback,
        mitigatingEvidenceRequired: true,
        workflow: CASTRO_WORKFLOW,
      },
    };
  }
  return {
    decision: "clear",
    reasons: acc.reasons.length > 0 ? acc.reasons : ["No criminal record requiring denial consideration"],
    citations,
  };
}
