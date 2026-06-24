import { logger } from "../../utils/logger";
import { query } from "../../config/database";
import { resolveVendor } from "./vendors";

export interface CreditCheckResult {
  result: "pass" | "fail" | "review_required" | "could_not_screen";
  creditScore: number;
  details: {
    paymentHistory: string;
    outstandingDebts: number;
    collections: number;
    evictions: number;
    bankruptcies: number;
    rawResponse?: Record<string, unknown>;
  };
}

/** Categorical report reference + status returned by createReport(). */
export interface CreditReportHandle {
  /** The CRA report/order reference id (e.g. TransUnion ShareAble request id). */
  reportId: string;
  /** CRA-reported categorical status (e.g. `pending`, `complete`). */
  status: string;
  /** The hosted exam/consent url the applicant completes (KBA), when provided. */
  url: string | null;
}

/**
 * Credit check integration.
 * Threshold: 600+ preferred, decision matrix allows exceptions.
 *
 * Two lifecycles coexist behind `CONSUMER_REPORT_ENABLED` (mirrors
 * background-check.ts):
 *
 *   - **TransUnion ShareAble CRA (production, flag ON)** — asynchronous +
 *     applicant-mediated. submit() calls `createReport()` → the applicant
 *     authorizes the pull + passes ShareAble's KBA exam → the credit + eviction
 *     report arrives by WEBHOOK, which maps + persists a categorical verdict onto
 *     the application row. At screening time `resolve()` READS that persisted
 *     verdict (it never initiates the pull); a report still pending →
 *     `could_not_screen` HOLD (never an auto-pass).
 *
 *   - **Legacy synchronous (flag OFF / MOCK / stub)** — `runCheck()` pulls the
 *     raw response from the vendor seam (resolveVendor("credit")) inline,
 *     byte-identical to the pre-CRA behaviour.
 *
 * Both paths converge on the same evaluateResults(): score >= 600 → pass,
 * evictions/bankruptcies > 0 → fail, otherwise review_required.
 */
export class CreditCheckService {
  // ── TransUnion ShareAble CRA lifecycle ───────────────────────────────────────

  /**
   * Create a TransUnion ShareAble credit + eviction report for an application.
   * Called from submit() on the armed path; returns the report reference + the
   * hosted KBA exam url the applicant must complete to authorize the pull.
   *
   * Two-step ShareAble flow (applicant-mediated — we hold ssnLast4, NOT the full
   * SSN; ShareAble's hosted KBA exam collects the full SSN/DOB from the applicant
   * directly, so no full SSN ever leaves us):
   *   1. POST /v1/applicants → applicant id (name + email; DOB lifts match rate).
   *   2. POST /v1/screening-requests → the hosted `exam_url`. ShareAble assembles
   *      the credit + eviction report only AFTER the applicant passes the KBA
   *      exam; the completion webhook then carries the screening-request id — our
   *      durable join key — so we persist request.id as the report handle
   *      (`reportId`) and the webhook resolves the application by it.
   *
   * KEYLESS ⇒ FAIL-LOUD: with no TRANSUNION_SHAREABLE_API_KEY the create throws
   * (never a fabricated exam handle — that would be a phantom consumer-report
   * order). submit() catches the throw and leaves the app in `submitted` (no
   * silent screening skip), so flag-off / keyless is byte-identical to today.
   *
   * Activation: TRANSUNION_SHAREABLE_API_KEY (+ optional
   * TRANSUNION_SHAREABLE_API_URL, TRANSUNION_SHAREABLE_PRODUCT_BUNDLE). The
   * webhook half verifies TRANSUNION_SHAREABLE_WEBHOOK_SECRET — see cra-webhook.ts.
   *
   * CREDENTIALING-GATED shape: ShareAble's exact endpoints, auth scheme, the
   * request-id field, and the exam-url field are confirmed against a live sandbox
   * at arm time (docs/screening/background-credit-cra-adapter.md §4). The
   * structure below follows ShareAble's documented applicant + screening-request
   * model; each assumed path carries a TODO(credentialing) marker.
   */
  async createReport(input: {
    applicationId: string;
    firstName: string;
    lastName: string;
    ssnLast4: string;
    dateOfBirth: string;
    email?: string;
    returnUrl?: string;
  }): Promise<CreditReportHandle> {
    const apiKey = process.env.TRANSUNION_SHAREABLE_API_KEY || "";
    if (!apiKey || apiKey === "changeme") {
      // Dormant. Fail-loud, NEVER a fabricated handle — a fake exam url is a
      // phantom order. Keep the historical message so the keyless contract test
      // (`/not yet configured/i`) stays green.
      throw new Error("TransUnion ShareAble credit report integration not yet configured");
    }
    // ShareAble needs an email to create the applicant + deliver the hosted KBA
    // exam link. Missing email is fail-loud — we never create a half-formed
    // applicant.
    if (!input.email) {
      throw new Error("TransUnion ShareAble applicant requires an email");
    }

    const base = (
      process.env.TRANSUNION_SHAREABLE_API_URL || "https://api.shareable.com"
    ).replace(/\/$/, "");
    // The product bundle slug is account-specific; MUST be set to a real bundle
    // at arm time. The default is a placeholder, not a guarantee.
    const bundle =
      process.env.TRANSUNION_SHAREABLE_PRODUCT_BUNDLE || "credit_eviction";

    // 1) Applicant — name + email (+ DOB to lift match rate). The full SSN is
    //    NOT sent: the hosted KBA exam collects it from the applicant directly.
    // TODO(credentialing): confirm the applicant endpoint + field names.
    const applicant = (await this.shareAbleFetch(base, apiKey, "/v1/applicants", {
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      ...(input.dateOfBirth ? { date_of_birth: input.dateOfBirth } : {}),
    })) as { id?: string };
    if (!applicant?.id) {
      throw new Error("TransUnion ShareAble applicant create returned no id");
    }

    // 2) Screening request — credit + eviction bundle. Returns the hosted KBA
    //    exam url + the request id (our durable webhook join key; no report id
    //    exists until the applicant passes the exam and TU assembles the report).
    // TODO(credentialing): confirm the screening-request endpoint, the request-id
    // field, and the hosted exam-url field.
    const request = (await this.shareAbleFetch(
      base,
      apiKey,
      "/v1/screening-requests",
      {
        applicant_id: applicant.id,
        products: [bundle],
        ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      }
    )) as { id?: string; exam_url?: string; status?: string };
    if (!request?.id) {
      throw new Error("TransUnion ShareAble screening request returned no id");
    }

    return {
      // request.id (NOT the not-yet-existent report id) is the webhook join key.
      reportId: request.id,
      status: request.status || "pending",
      url: request.exam_url || null,
    };
  }

  /**
   * Is the TransUnion ShareAble CRA armed? True only with a real
   * TRANSUNION_SHAREABLE_API_KEY — the SAME predicate createReport() gates its
   * keyless fail-loud throw on. submit() preflights this alongside the Checkr
   * check so it never creates a Checkr order it cannot pair with a credit order.
   * Keep this in lockstep with createReport()'s key check.
   */
  isConfigured(): boolean {
    const apiKey = process.env.TRANSUNION_SHAREABLE_API_KEY || "";
    return !!apiKey && apiKey !== "changeme";
  }

  /**
   * POST to the TransUnion ShareAble API with a Bearer API key. Any non-2xx
   * THROWS with a categorical detail — the submit() caller turns that into a
   * fail-loud HOLD, never a fabricated handle. Mirrors background-check.ts's
   * checkrFetch idiom (ShareAble uses Bearer auth rather than Checkr's HTTP
   * Basic).
   * TODO(credentialing): confirm ShareAble's auth scheme (Bearer vs HTTP Basic /
   * partner-id header) against the sandbox.
   */
  private async shareAbleFetch(
    base: string,
    apiKey: string,
    path: string,
    body: Record<string, unknown>
  ): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      throw new Error(`TransUnion ShareAble ${path} failed — ${detail}`);
    }
    return res.json();
  }

  /**
   * Screening-time credit entry point under CONSUMER_REPORT_ENABLED — reads the
   * webhook-persisted ShareAble verdict off the application row and re-evaluates
   * it through the SAME evaluateResults() the synchronous path uses. Returns
   * `could_not_screen` (a HOLD, never a pass) when:
   *   - no report was ever created (`credit_report_id` null), or
   *   - the report hasn't completed yet (`credit_check_completed_at` null —
   *     applicant still completing the KBA exam / TU still assembling), or
   *   - the persisted detail isn't in the expected shape, or
   *   - the lookup itself throws.
   *
   * The webhook stores the FULL mapped vendor response (categorical only) in
   * `credit_check_details.rawResponse`, so re-running evaluateResults() here
   * yields the same verdict the webhook computed.
   */
  async resolve(applicationId: string): Promise<CreditCheckResult> {
    try {
      const res = await query(
        `SELECT credit_report_id,
                credit_check_completed_at,
                credit_check_details
           FROM applications
          WHERE id = $1`,
        [applicationId]
      );
      const row = res.rows[0];

      if (!row || !row.credit_report_id) {
        return this.couldNotScreen("no TransUnion credit report on file");
      }
      if (!row.credit_check_completed_at) {
        return this.couldNotScreen("TransUnion credit report still pending");
      }

      const stored = row.credit_check_details;
      const raw =
        stored && typeof stored === "object"
          ? (stored as Record<string, unknown>).rawResponse
          : undefined;
      if (raw && typeof raw === "object") {
        return this.evaluateResults(raw);
      }
      return this.couldNotScreen("TransUnion credit verdict not in expected shape");
    } catch (err) {
      logger.error("Failed to resolve TransUnion credit report", {
        error: (err as Error).message,
        applicationId,
      });
      return this.couldNotScreen("TransUnion credit lookup failed");
    }
  }

  /**
   * Map a TransUnion ShareAble report to the CreditVendorResponse shape
   * evaluateResults() consumes. Pure + side-effect-free — the webhook calls this
   * then persists the result; the unit tests exercise it table-driven.
   *
   * PII discipline: this returns ONLY the categorical / integer summary fields
   * (score, eviction count, bankruptcy count, collections count, payment-history
   * label, aggregate debt). The caller persists exactly these (folded into
   * `rawResponse`) — never individual tradeline detail, account numbers,
   * creditor names, or addresses, which live exclusively on TransUnion.
   */
  mapShareAbleReportToResponse(report: any): {
    creditScore: number;
    paymentHistory: string;
    outstandingDebts: number;
    collections: number;
    evictions: number;
    bankruptcies: number;
    // Fail-closed signal — see computation below. evaluateResults() HOLDs when set.
    indeterminate: boolean;
  } {
    // TODO(credentialing): confirm field paths against a live ShareAble sandbox
    // report. The paths below follow TU ShareAble's documented response sections
    // (creditScore / public records / tradeline summary) but are unverified until
    // a sandbox account exists.
    const creditScore = this.asInt(
      report?.creditScore ?? report?.score ?? report?.scoreModel?.score
    );

    // Eviction + bankruptcy COUNTS only — never the underlying records.
    const evictions = this.countOf(
      report?.evictions ?? report?.evictionRecords ?? report?.publicRecords?.evictions
    );
    const bankruptcies = this.countOf(
      report?.bankruptcies ?? report?.bankruptcyRecords ?? report?.publicRecords?.bankruptcies
    );
    const collections = this.countOf(
      report?.collections ?? report?.collectionAccounts
    );

    const outstandingDebts = this.asInt(
      report?.outstandingDebts ?? report?.totalBalance ?? report?.summary?.totalBalance
    );
    const paymentHistory =
      typeof report?.paymentHistory === "string"
        ? report.paymentHistory
        : this.derivePaymentHistory(creditScore);

    // ── Fail-closed guard (credentialing audit 2026-06-24) ──────────────────
    // A passing credit verdict needs score >= 600 AND evictions==0 AND
    // bankruptcies==0. If ShareAble returns a good score but its public-record
    // section carries eviction/bankruptcy entries under a key we don't parse
    // (references, not the inline shape below), the counts fall to 0 and a real
    // eviction/bankruptcy slips through as a PASS. Likewise a not-actually-clear
    // report status must not be read as a verdict. Flag indeterminate when:
    //  (a) a non-clear status signal is present, or
    //  (b) a public-record container LOOKS non-empty but we parsed zero
    //      evictions AND zero bankruptcies (we likely missed records).
    // Shape-agnostic defense-in-depth: a sandbox-verified mapper that parses the
    // records sets the counts and never trips (b); an explicitly-empty container
    // ([] / {evictions:[],bankruptcies:[]}) is not "non-empty" and is safe.
    const NON_CLEAR = /consider|review|suspend|dispute|pending|escalat|incomplete|unknown|error|fail/;
    const statusSignals = [
      report?.status,
      report?.result,
      report?.reportStatus,
      report?.scoreModel?.status,
    ]
      .map((v) => String(v ?? "").toLowerCase())
      .filter(Boolean);
    const hasNonClearStatus = statusSignals.some((s) => NON_CLEAR.test(s));
    const publicContainers = [
      report?.evictions,
      report?.evictionRecords,
      report?.publicRecords?.evictions,
      report?.bankruptcies,
      report?.bankruptcyRecords,
      report?.publicRecords?.bankruptcies,
      report?.publicRecords,
    ];
    const unparsedPublicRecords =
      evictions + bankruptcies === 0 && publicContainers.some((c) => this.looksNonEmpty(c));
    const indeterminate = hasNonClearStatus || unparsedPublicRecords;

    return {
      creditScore,
      paymentHistory,
      outstandingDebts,
      collections,
      evictions,
      bankruptcies,
      indeterminate,
    };
  }

  /**
   * Does this value carry actual content (vs. absent / explicitly-empty)?
   * Recurses objects so a public-records container with records under an
   * unrecognized sub-key reads as non-empty, while {evictions:[],...} does not.
   */
  private looksNonEmpty(v: unknown): boolean {
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "number") return v > 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      return s.length > 0 && s !== "none" && s !== "0";
    }
    if (typeof v === "object") return Object.values(v as object).some((x) => this.looksNonEmpty(x));
    return Boolean(v);
  }

  /** Coerce a numeric field to a non-negative integer (0 when absent/invalid). */
  private asInt(v: unknown): number {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /** Count of records — accepts an array, a numeric count, or absence. */
  private countOf(v: unknown): number {
    if (Array.isArray(v)) return v.length;
    return this.asInt(v);
  }

  /** Coarse payment-history label when ShareAble doesn't supply one. */
  private derivePaymentHistory(score: number): string {
    if (score >= 720) return "excellent";
    if (score >= 660) return "good";
    if (score >= 600) return "fair";
    if (score > 0) return "poor";
    return "unknown";
  }

  /** Standard `could_not_screen` HOLD result (reason is categorical, no PII). */
  private couldNotScreen(reason: string): CreditCheckResult {
    return {
      result: "could_not_screen",
      creditScore: 0,
      details: {
        paymentHistory: "unknown",
        outstandingDebts: 0,
        collections: 0,
        evictions: 0,
        bankruptcies: 0,
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
    screeningTag?: string;
  }): Promise<CreditCheckResult> {
    logger.info("Initiating credit check", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    try {
      const response = await this.callCreditAPI(input);
      return this.evaluateResults(response);
    } catch (err) {
      logger.error("Credit check API error", { error: (err as Error).message });
      // A thrown error means the vendor never produced a verdict — we could NOT
      // screen. This must HOLD the application (not pass it, not treat it as a
      // borderline review), so it lands in screening_review for staff resolution.
      return {
        result: "could_not_screen",
        creditScore: 0,
        details: {
          paymentHistory: "unknown",
          outstandingDebts: 0,
          collections: 0,
          evictions: 0,
          bankruptcies: 0,
          rawResponse: { error: "Screening vendor unavailable — could not screen" },
        },
      };
    }
  }

  private async callCreditAPI(input: {
    firstName: string;
    lastName: string;
    ssnLast4: string;
    dateOfBirth: string;
    screeningTag?: string;
  }): Promise<any> {
    // Delegate the raw pull to the configured vendor. The vendor self-gates on
    // the stub policy: keyless production THROWS here → caught above → HOLD.
    return resolveVendor("credit").credit(input);
  }

  private evaluateResults(response: any): CreditCheckResult {
    // Fail-closed: a report the mapper flagged indeterminate (non-clear status,
    // or public-record content we couldn't parse) must NEVER pass. HOLD it for
    // staff review. Only the real-vendor mapper sets this; the legacy/mock path
    // never does, so flag-off behaviour is byte-identical.
    if (response?.indeterminate === true) {
      return this.couldNotScreen("report_indeterminate_nonclear_or_unparsed_records");
    }
    const score = response.creditScore || 0;
    const evictions = response.evictions || 0;
    const bankruptcies = response.bankruptcies || 0;
    const collections = response.collections || 0;

    // Auto-fail: recent evictions or active bankruptcy
    if (evictions > 0 || bankruptcies > 0) {
      return {
        result: "fail",
        creditScore: score,
        details: {
          paymentHistory: response.paymentHistory || "unknown",
          outstandingDebts: response.outstandingDebts || 0,
          collections,
          evictions,
          bankruptcies,
          rawResponse: response,
        },
      };
    }

    // Credit score evaluation
    if (score >= 600) {
      return {
        result: "pass",
        creditScore: score,
        details: {
          paymentHistory: response.paymentHistory || "unknown",
          outstandingDebts: response.outstandingDebts || 0,
          collections,
          evictions,
          bankruptcies,
          rawResponse: response,
        },
      };
    }

    // Below 600 — requires manual review (exceptions allowed per decision matrix)
    return {
      result: "review_required",
      creditScore: score,
      details: {
        paymentHistory: response.paymentHistory || "unknown",
        outstandingDebts: response.outstandingDebts || 0,
        collections,
        evictions,
        bankruptcies,
        rawResponse: response,
      },
    };
  }
}
