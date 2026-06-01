import { logger } from "../../utils/logger";
import { resolveVendor } from "./vendors";
import {
  evaluateCriminalHistory,
  type CriminalDecision,
  type CriminalAssessmentFactors,
} from "./hud-criminal-decision";

export interface BackgroundCheckResult {
  result: "pass" | "fail" | "review_required" | "could_not_screen";
  details: {
    felonies: number;
    sexOffenses: boolean;
    violentCrimes: boolean;
    misdemeanors: number;
    riskScore: number;
    /** HUD/FHA decision from the criminal-history engine (omitted on could_not_screen). */
    decision?: CriminalDecision;
    /** Human-readable rationale lines (surfaced in the staff review queue). */
    reasons?: string[];
    /** CFR / FHA citations backing the decision. */
    citations?: string[];
    /** Castro §III.B factors — present only when an individualized assessment is required. */
    assessmentFactors?: CriminalAssessmentFactors;
    rawResponse?: Record<string, unknown>;
  };
}

/**
 * Third-party background check integration.
 *
 * The denial logic is the HUD/FHA individualized-assessment engine
 * (hud-criminal-decision.ts), NOT a blanket ban:
 *   - federal mandatory floors (§5.856 / §960.204) → "fail" (immediate FCRA notice)
 *   - a discretionary record in lookback → "review_required" carrying
 *     details.decision="individualized_review" → the orchestrator HOLDs it in
 *     screening_review for a Castro §III.B assessment (never auto-fail, never auto-pass)
 *   - everything else ("clear") → the legacy misdemeanor soft-risk score
 *
 * The raw vendor response comes from the screening vendor seam
 * (resolveVendor("background")); this service owns only Frank's evaluation
 * policy (evaluateResults) and the fail-loud catch → could_not_screen HOLD.
 */
export class BackgroundCheckService {
  async runCheck(input: {
    firstName: string;
    lastName: string;
    ssnLast4: string;
    dateOfBirth: string;
    state: string;
    screeningTag?: string;
  }): Promise<BackgroundCheckResult> {
    logger.info("Initiating background check", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    try {
      const response = await this.callScreeningAPI(input);
      return this.evaluateResults(response);
    } catch (err) {
      logger.error("Background check API error", { error: (err as Error).message });
      // A thrown error means the vendor never produced a verdict — we could NOT
      // screen. This must HOLD the application (not pass it, not treat it as a
      // borderline review), so it lands in screening_review for staff resolution.
      return {
        result: "could_not_screen",
        details: {
          felonies: 0,
          sexOffenses: false,
          violentCrimes: false,
          misdemeanors: 0,
          riskScore: -1,
          rawResponse: { error: "Screening vendor unavailable — could not screen" },
        },
      };
    }
  }

  private async callScreeningAPI(input: {
    firstName: string;
    lastName: string;
    ssnLast4: string;
    dateOfBirth: string;
    state: string;
    screeningTag?: string;
  }): Promise<any> {
    // Delegate the raw pull to the configured vendor. The vendor self-gates on
    // the stub policy: keyless production THROWS here → caught above → HOLD.
    return resolveVendor("background").background(input);
  }

  private evaluateResults(response: any): BackgroundCheckResult {
    // CRIMINAL_DECISION_ENGINE_ENABLED gates the HUD/FHA individualized-assessment
    // engine. Default OFF → the pre-engine blanket-ban path runs and
    // `background_check_details` is byte-identical to pre-engine behaviour (none
    // of the engine keys are written), so the engine ships DARK: merging and
    // deploying changes nothing until the flag is deliberately turned on. Flip it
    // to "true" to activate the matrix-driven engine (mandatory federal floors
    // auto-deny; discretionary in-lookback hits HOLD for individualized review).
    if (process.env.CRIMINAL_DECISION_ENGINE_ENABLED === "true") {
      return this.evaluateWithEngine(response);
    }
    return this.evaluateLegacy(response);
  }

  /**
   * Pre-engine blanket-ban path — the flag-off default. Auto-fail on any felony /
   * sex offense / violent crime; misdemeanor soft-risk scoring otherwise. Kept
   * verbatim so flag-off is byte-identical to the historical behaviour.
   */
  private evaluateLegacy(response: any): BackgroundCheckResult {
    const felonies = response.felonies || 0;
    const sexOffenses = response.sexOffenses || false;
    const violentCrimes = response.violentCrimes || false;
    const misdemeanors = (response.misdemeanors || []).length;

    // Auto-fail criteria
    if (felonies > 0 || sexOffenses || violentCrimes) {
      return {
        result: "fail",
        details: { felonies, sexOffenses, violentCrimes, misdemeanors, riskScore: 100, rawResponse: response },
      };
    }

    // Risk scoring for misdemeanors
    let riskScore = 0;
    if (misdemeanors === 1) riskScore = 25;
    else if (misdemeanors === 2) riskScore = 50;
    else if (misdemeanors >= 3) riskScore = 75;

    if (riskScore >= 75) {
      return {
        result: "review_required",
        details: { felonies, sexOffenses, violentCrimes, misdemeanors, riskScore, rawResponse: response },
      };
    }

    return {
      result: "pass",
      details: { felonies, sexOffenses, violentCrimes, misdemeanors, riskScore, rawResponse: response },
    };
  }

  /**
   * HUD/FHA individualized-assessment engine path (flag-on only). Mandatory
   * federal floors → fail; discretionary in-lookback hits → review_required
   * tagged decision="individualized_review" for the orchestrator to HOLD.
   */
  private evaluateWithEngine(response: any): BackgroundCheckResult {
    const felonies = response.felonies || 0;
    const sexOffenses = response.sexOffenses || false;
    const violentCrimes = response.violentCrimes || false;
    const misdemeanors = (response.misdemeanors || []).length;

    // Run the HUD/FHA decision engine. Structured `criminalRecords` (real vendor
    // path) are authoritative; the legacy summary flags drive the engine when no
    // structured records are present (current sandbox path).
    const decision = evaluateCriminalHistory({
      records: Array.isArray(response.criminalRecords) ? response.criminalRecords : undefined,
      felonies,
      sexOffenses,
      violentCrimes,
      methManufactureOnAssistedProperty: response.methManufactureOnAssistedProperty,
      currentIllegalDrugUse: response.currentIllegalDrugUse,
      drugRelatedEvictionWithinLookback: response.drugRelatedEvictionWithinLookback,
    });

    const baseDetails = {
      felonies,
      sexOffenses,
      violentCrimes,
      misdemeanors,
      decision: decision.decision,
      reasons: decision.reasons,
      citations: decision.citations,
      ...(decision.assessmentFactors ? { assessmentFactors: decision.assessmentFactors } : {}),
      rawResponse: response,
    };

    // Mandatory federal floor (§5.856 / §960.204) → hard fail. The orchestrator
    // fires the FCRA adverse-action notice on this immediately.
    if (decision.decision === "mandatory_denial") {
      return { result: "fail", details: { ...baseDetails, riskScore: 100 } };
    }

    // Discretionary record in lookback (or open/undated) → individualized
    // assessment. We surface this as review_required, but tag it with
    // decision="individualized_review" so the orchestrator routes it to a
    // screening_review HOLD rather than the review_required auto-pass.
    // NEVER auto-fail (Castro forbids time-blind bans); NEVER auto-pass.
    if (decision.decision === "individualized_review") {
      return { result: "review_required", details: { ...baseDetails, riskScore: 90 } };
    }

    // decision === "clear": no denial-consideration record. Preserve the legacy
    // misdemeanor soft-risk behaviour (3+ → review_required passthrough).
    let riskScore = 0;
    if (misdemeanors === 1) riskScore = 25;
    else if (misdemeanors === 2) riskScore = 50;
    else if (misdemeanors >= 3) riskScore = 75;

    if (riskScore >= 75) {
      return { result: "review_required", details: { ...baseDetails, riskScore } };
    }

    return { result: "pass", details: { ...baseDetails, riskScore } };
  }
}
