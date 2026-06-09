import { logger } from "../../utils/logger";
import { query } from "../../config/database";
import { resolveVendor } from "./vendors";
import {
  evaluateCriminalHistory,
  type CriminalDecision,
  type CriminalAssessmentFactors,
  type CriminalRecord,
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

/** Categorical report reference + status returned by createReport(). */
export interface BackgroundReportHandle {
  /** The CRA report/order reference id (e.g. Checkr `rep_…`). */
  reportId: string;
  /** CRA-reported categorical status (e.g. `pending`, `complete`). */
  status: string;
  /** The hosted invitation/consent url the applicant completes, when provided. */
  url: string | null;
}

/**
 * Third-party background check integration.
 *
 * Two lifecycles coexist behind `CONSUMER_REPORT_ENABLED`:
 *
 *   - **Checkr CRA (production, flag ON)** — asynchronous + applicant-mediated.
 *     submit() calls `createReport()` → the applicant authorizes the pull +
 *     passes KBA on Checkr's hosted flow → the report arrives by WEBHOOK
 *     (`report.completed`), which maps + persists a categorical verdict onto the
 *     application row. At screening time `resolve()` READS that persisted verdict
 *     (it never initiates the pull); a report still pending → `could_not_screen`
 *     HOLD (never an auto-pass).
 *
 *   - **Legacy synchronous (flag OFF / MOCK / stub)** — `runCheck()` pulls the
 *     raw response from the vendor seam (resolveVendor("background")) inline.
 *     This path is byte-identical to the pre-CRA behaviour; the seam self-gates
 *     on the stub policy (keyless prod → STUB_GATE_ERROR → caught → HOLD).
 *
 * The denial logic is the HUD/FHA individualized-assessment engine
 * (hud-criminal-decision.ts), NOT a blanket ban:
 *   - federal mandatory floors (§5.856 / §960.204) → "fail" (immediate FCRA notice)
 *   - a discretionary record in lookback → "review_required" carrying
 *     details.decision="individualized_review" → the orchestrator HOLDs it in
 *     screening_review for a Castro §III.B assessment (never auto-fail, never auto-pass)
 *   - everything else ("clear") → the legacy misdemeanor soft-risk score
 *
 * Both paths converge on the same evaluateResults(), so the verdict math is
 * single-sourced regardless of how the raw response was produced.
 */
export class BackgroundCheckService {
  // ── Checkr CRA lifecycle (background + credit adapter) ───────────────────────

  /**
   * Create a Checkr background report/order for an application. Called from
   * submit() on the armed path; returns the report reference + hosted invitation
   * `url` the applicant uses to authorize the pull and complete KBA.
   *
   * Two-step Checkr flow (the only one usable here — we hold ssnLast4, NOT the
   * full SSN the direct report API needs):
   *   1. POST /v1/candidates  → candidate id (name + email; the hosted flow
   *      collects the full SSN from the applicant — no full SSN leaves us).
   *   2. POST /v1/invitations → the hosted `invitation_url`. Checkr auto-creates
   *      the report only AFTER the applicant completes the invitation; the
   *      `report.completed` webhook then carries `candidate_id` — our durable
   *      join key — so we persist candidate.id as the report handle (`reportId`)
   *      and the webhook resolves the application by it.
   *
   * KEYLESS ⇒ FAIL-LOUD: with no CHECKR_API_KEY the create throws (never a
   * fabricated invitation handle — that would be a phantom consumer-report
   * order). submit() catches the throw and leaves the app in `submitted` (no
   * silent screening skip), so flag-off / keyless is byte-identical to today.
   *
   * Activation: CHECKR_API_KEY (+ optional CHECKR_API_URL, CHECKR_PACKAGE). The
   * webhook half verifies CHECKR_WEBHOOK_SECRET — see cra-webhook.ts.
   */
  async createReport(input: {
    applicationId: string;
    firstName: string;
    lastName: string;
    ssnLast4: string;
    dateOfBirth: string;
    state: string;
    email?: string;
    returnUrl?: string;
  }): Promise<BackgroundReportHandle> {
    const apiKey = process.env.CHECKR_API_KEY || "";
    if (!apiKey || apiKey === "changeme") {
      // Dormant. Fail-loud, NEVER a fabricated handle. Unlike the synchronous
      // vendor seam there is no meaningful "stub handle" to return — a fake
      // invitation url is a phantom order. Keep the historical message so the
      // keyless contract test (`/not yet configured/i`) stays green.
      throw new Error("Checkr background report integration not yet configured");
    }
    // Checkr needs an email to create + invite the candidate. Missing email is
    // fail-loud — we never create a half-formed candidate.
    if (!input.email) {
      throw new Error("Checkr candidate requires an applicant email");
    }

    const base = (process.env.CHECKR_API_URL || "https://api.checkr.com").replace(/\/$/, "");
    // Package slug is account-specific; MUST be set to a real package at arm
    // time. The default is a common Checkr test package, not a guarantee.
    const pkg = process.env.CHECKR_PACKAGE || "tasker_standard";

    // 1) Candidate — name + email (+ DOB to lift match rate; Checkr is the
    //    authorized CRA recipient). The full SSN is NOT sent: the hosted
    //    invitation collects it from the applicant directly.
    const candidate = (await this.checkrFetch(base, apiKey, "/v1/candidates", {
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      ...(input.dateOfBirth ? { dob: input.dateOfBirth } : {}),
    })) as { id?: string };
    if (!candidate?.id) {
      throw new Error("Checkr candidate create returned no id");
    }

    // 2) Invitation — hand the applicant the hosted apply flow for `package`.
    const invitation = (await this.checkrFetch(base, apiKey, "/v1/invitations", {
      candidate_id: candidate.id,
      package: pkg,
      work_locations: [{ country: "US", state: input.state || "NV" }],
    })) as { invitation_url?: string; status?: string };

    return {
      // candidate.id (NOT the not-yet-existent report id) is the webhook join key.
      reportId: candidate.id,
      status: invitation.status || "pending",
      url: invitation.invitation_url || null,
    };
  }

  /**
   * Is the Checkr CRA armed? True only when a real CHECKR_API_KEY is present —
   * the SAME predicate createReport() gates its keyless fail-loud throw on.
   * submit() uses this as an atomic preflight: creating a Checkr candidate also
   * emails the applicant a hosted invitation (a real, billable, applicant-facing
   * side effect), so it must never fire unless every required CRA vendor can also
   * produce its report. Keep this in lockstep with createReport()'s key check.
   */
  isConfigured(): boolean {
    const apiKey = process.env.CHECKR_API_KEY || "";
    return !!apiKey && apiKey !== "changeme";
  }

  /**
   * POST to the Checkr API with HTTP Basic auth (API key as username, empty
   * password: `Basic base64(key + ":")`). Any non-2xx THROWS with a categorical
   * detail — the submit() caller turns that into a fail-loud HOLD, never a
   * fabricated handle. Mirrors the plaid/work-number fetch idiom.
   */
  private async checkrFetch(
    base: string,
    apiKey: string,
    path: string,
    body: Record<string, unknown>
  ): Promise<unknown> {
    const auth = Buffer.from(`${apiKey}:`).toString("base64");
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = (await res.json()) as any;
        detail = err?.error
          ? String(err.error)
          : Array.isArray(err?.errors)
            ? err.errors.join("; ")
            : JSON.stringify(err);
      } catch {
        /* keep HTTP status */
      }
      throw new Error(`Checkr ${path} failed — ${detail}`);
    }
    return res.json();
  }

  /**
   * Screening-time background entry point under CONSUMER_REPORT_ENABLED — reads
   * the webhook-persisted Checkr verdict off the application row and re-evaluates
   * it through the SAME evaluateResults() the synchronous path uses. Returns
   * `could_not_screen` (a HOLD, never a pass) when:
   *   - no report was ever created (`background_report_id` null), or
   *   - the report hasn't completed yet (`background_check_completed_at` null —
   *     applicant still authorizing / Checkr still running county searches), or
   *   - the persisted detail isn't in the expected shape, or
   *   - the lookup itself throws.
   *
   * The webhook stores the FULL mapped vendor response in
   * `background_check_details.rawResponse` (categorical only), so re-running
   * evaluateResults() here yields a verdict identical to what the webhook would
   * have computed — the HUD engine flag (CRIMINAL_DECISION_ENGINE_ENABLED) is
   * applied at screening time, not frozen at webhook time.
   */
  async resolve(applicationId: string): Promise<BackgroundCheckResult> {
    try {
      const res = await query(
        `SELECT background_report_id,
                background_check_completed_at,
                background_check_details
           FROM applications
          WHERE id = $1`,
        [applicationId]
      );
      const row = res.rows[0];

      if (!row || !row.background_report_id) {
        return this.couldNotScreen("no Checkr background report on file");
      }
      if (!row.background_check_completed_at) {
        return this.couldNotScreen("Checkr background report still pending");
      }

      const stored = row.background_check_details;
      const raw =
        stored && typeof stored === "object"
          ? (stored as Record<string, unknown>).rawResponse
          : undefined;
      if (raw && typeof raw === "object") {
        return this.evaluateResults(raw);
      }
      return this.couldNotScreen("Checkr background verdict not in expected shape");
    } catch (err) {
      logger.error("Failed to resolve Checkr background report", {
        error: (err as Error).message,
        applicationId,
      });
      return this.couldNotScreen("Checkr background lookup failed");
    }
  }

  /**
   * Map a Checkr `report` to the BackgroundVendorResponse shape evaluateResults()
   * consumes. Pure + side-effect-free — the webhook calls this then persists the
   * result; the unit tests exercise it table-driven.
   *
   * `criminalRecords` is authoritative (the HUD engine reads it directly);
   * `felonies`/`sexOffenses`/`violentCrimes`/`misdemeanors` are DERIVED summary
   * flags that drive the legacy (engine-off) path.
   *
   * PII discipline: nothing here is persisted except what evaluateResults() folds
   * into `rawResponse`, which the caller MUST restrict to categorical fields
   * (reportId, candidateId, status, per-search statuses, adjudication) — never
   * charge narratives, addresses, or full DOB/SSN, which live on Checkr.
   */
  mapCheckrReportToResponse(report: any): {
    felonies: number;
    sexOffenses: boolean;
    violentCrimes: boolean;
    misdemeanors: unknown[];
    records: unknown[];
    criminalRecords: CriminalRecord[];
  } {
    // TODO(credentialing): confirm field paths against a live Checkr sandbox
    // report. The paths below follow Checkr's published report schema
    // (sex_offender_search, national_criminal_search, county_criminal_searches[])
    // but are unverified until a sandbox account exists.
    const sexOffenderRecords = this.asArray(report?.sex_offender_search?.records);
    const sexOffenses = sexOffenderRecords.length > 0;

    // Aggregate the criminal search sections into a flat charge list. Checkr
    // splits results across national + county searches; each carries a `records`
    // (or `charges`) array.
    const charges: any[] = [
      ...this.asArray(report?.national_criminal_search?.records),
      ...this.asArray(report?.national_criminal_search?.charges),
      ...this.asArray(report?.county_criminal_searches).flatMap((s: any) => [
        ...this.asArray(s?.records),
        ...this.asArray(s?.charges),
      ]),
    ];

    const criminalRecords: CriminalRecord[] = [];
    // Sex-offender registry hits map to the §5.856 lifetime-registrant mandatory
    // floor regardless of how the criminal searches classify them.
    for (const _hit of sexOffenderRecords) {
      criminalRecords.push({
        category: "sex_offense_lifetime_registrant",
        disposition: "convicted",
        lifetimeRegistrant: true,
      });
    }
    for (const charge of charges) {
      criminalRecords.push(this.mapCheckrCharge(charge));
    }

    // Derived summary flags for the legacy (engine-off) path.
    let felonies = 0;
    let violentCrimes = false;
    const misdemeanors: unknown[] = [];
    for (const rec of criminalRecords) {
      if (rec.category.startsWith("felony")) felonies += 1;
      if (rec.category === "felony_violent" || rec.category === "misdemeanor_violent") {
        violentCrimes = true;
      }
      if (rec.category.startsWith("misdemeanor")) misdemeanors.push({ category: rec.category });
    }

    return {
      felonies,
      sexOffenses,
      violentCrimes,
      misdemeanors,
      // `records` is the legacy summary array; `criminalRecords` is the
      // engine-authoritative structured list. evaluateWithEngine reads the latter.
      records: criminalRecords,
      criminalRecords,
    };
  }

  /** Map one Checkr charge to a CriminalRecord. CREDENTIALING-GATED field paths. */
  private mapCheckrCharge(charge: any): CriminalRecord {
    // TODO(credentialing): confirm Checkr charge field paths (classification,
    // disposition, offense_date, etc.) against a live sandbox response.
    const classification = String(charge?.classification ?? charge?.type ?? "").toLowerCase();
    const isFelony = classification.includes("felony");
    const isViolent =
      /violen|assault|battery|homicide|robbery|weapon/.test(
        String(charge?.charge ?? charge?.description ?? "").toLowerCase()
      );

    let category: CriminalRecord["category"];
    if (isFelony) {
      category = isViolent ? "felony_violent" : "felony_nonviolent";
    } else {
      category = isViolent ? "misdemeanor_violent" : "misdemeanor_nonviolent";
    }

    return {
      category,
      // Default to the conservative "convicted" only when Checkr reports a
      // conviction disposition; otherwise leave undefined so the engine's
      // undated/open handling (never silent-clear) applies.
      disposition: this.mapCheckrDisposition(charge?.disposition),
      offenseDate: typeof charge?.offense_date === "string" ? charge.offense_date : undefined,
      dispositionDate:
        typeof charge?.disposition_date === "string" ? charge.disposition_date : undefined,
    };
  }

  private mapCheckrDisposition(d: unknown): CriminalRecord["disposition"] {
    const s = String(d ?? "").toLowerCase();
    if (s.includes("convict") || s.includes("guilty")) return "convicted";
    if (s.includes("dismiss")) return "dismissed";
    if (s.includes("acquit")) return "acquitted";
    if (s.includes("expunge")) return "expunged";
    if (s.includes("pending")) return "pending";
    if (s) return "unknown";
    return undefined;
  }

  private asArray(v: unknown): any[] {
    return Array.isArray(v) ? v : [];
  }

  /** Standard `could_not_screen` HOLD result (reason is categorical, no PII). */
  private couldNotScreen(reason: string): BackgroundCheckResult {
    return {
      result: "could_not_screen",
      details: {
        felonies: 0,
        sexOffenses: false,
        violentCrimes: false,
        misdemeanors: 0,
        riskScore: -1,
        rawResponse: { reason },
      },
    };
  }

  // ── Legacy synchronous path (flag OFF / MOCK / stub) — unchanged ─────────────

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
