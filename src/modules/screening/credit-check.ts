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
   * CREDENTIALING-GATED: the real ShareAble applicant + exam + report request is
   * a signed-contract + sandbox-key task (see
   * docs/screening/background-credit-cra-adapter.md §4 "Credentialing-gated").
   * Until those credentials exist the create throws — fail-loud, never a
   * fabricated handle. submit() catches the throw and leaves the app in
   * `submitted` (no silent screening skip).
   */
  async createReport(_input: {
    applicationId: string;
    firstName: string;
    lastName: string;
    ssnLast4: string;
    dateOfBirth: string;
    returnUrl?: string;
  }): Promise<CreditReportHandle> {
    // TODO(credentialing): replace with the real TransUnion ShareAble applicant +
    // exam + report request once a contract is signed and the ShareAble
    // credentials exist. The hosted exam url + report id come back from that call.
    throw new Error("TransUnion ShareAble credit report integration not yet configured");
  }

  /**
   * Is the TransUnion ShareAble CRA armed? Always false on this branch — the real
   * ShareAble applicant + exam + report request is credentialing-gated and not yet
   * implemented (createReport() above throws unconditionally). submit() preflights
   * this so it never creates a Checkr order it cannot pair with a credit order.
   * TODO(credentialing): return a real key check when the ShareAble adapter lands
   * (PR #273 / Chunk 4) so a fully-armed deployment passes the preflight.
   */
  isConfigured(): boolean {
    return false;
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

    return {
      creditScore,
      paymentHistory,
      outstandingDebts,
      collections,
      evictions,
      bankruptcies,
    };
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
