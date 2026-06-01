import type Stripe from "stripe";
import { logger } from "../../utils/logger";
import { query } from "../../config/database";
import { getStripe } from "../../lib/stripe";
import { shouldUseScreeningStub, STUB_GATE_ERROR } from "./stub-policy";

export interface IdentityVerificationResult {
  result: "verified" | "rejected" | "review_required" | "could_not_screen";
  confidence: number;
  idType: "driver_license" | "passport" | "state_id" | "unknown";
  livenessScore: number;
  details: {
    documentValid: boolean;
    selfieMatch: boolean;
    riskSignals: string[];
    rawResponse?: Record<string, unknown>;
  };
}

/** Categorical session reference + status returned by createSession(). */
export interface IdentitySessionHandle {
  id: string;
  status: string;
  clientSecret: string | null;
  url: string | null;
}

/**
 * Biometric ID + liveness verification.
 *
 * Two lifecycles coexist behind `IDENTITY_VERIFICATION_ENABLED`:
 *
 *   - **Stripe Identity (production, flag ON)** — asynchronous + applicant-mediated.
 *     `submit()` calls `createSession()` → the applicant uploads ID + selfie on
 *     Stripe's hosted/embedded flow → the verdict arrives by WEBHOOK
 *     (`identity.verification_session.*`), which persists it to the application
 *     row. At screening time `resolve()` READS that persisted verdict (it never
 *     initiates the call); a session still pending → `could_not_screen` HOLD.
 *
 *   - **Legacy synchronous (flag OFF / MOCK / stub)** — `verify()` returns a
 *     verdict inline. This path is byte-identical to the pre-Phase-4b behaviour;
 *     the Stripe production branch below was never reachable in flag-off configs
 *     (it threw "Production API integration not yet configured").
 *
 * A rejection short-circuits the pipeline to `failed` (FCRA adverse-action
 * notice); a could_not_screen HOLDs in `screening_review` (never an auto-pass).
 */
export class IdentityVerificationService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.IDENTITY_API_URL || "https://api.persona-identity.example.com";
    this.apiKey = process.env.IDENTITY_API_KEY || "";
  }

  // ── Stripe Identity lifecycle (Phase 4b) ────────────────────────────────────

  /**
   * Create a Stripe Identity VerificationSession for an application. Called from
   * submit() on the armed path; returns the hosted `url` / embedded
   * `clientSecret` the applicant uses to complete their ID + selfie capture.
   *
   * Idempotent per application: a retried submit reuses the same session rather
   * than spawning duplicates (idempotency key namespaced `idv:` so it never
   * collides with the PaymentIntent keys).
   */
  async createSession(input: {
    applicationId: string;
    returnUrl?: string;
  }): Promise<IdentitySessionHandle> {
    const stripe = getStripe();
    const session = await stripe.identity.verificationSessions.create(
      {
        type: "document",
        options: {
          document: {
            require_matching_selfie: true,
            require_live_capture: true,
          },
        },
        // The webhook + markProcessed key off metadata.applicationId to route the
        // verdict back to this row.
        metadata: { applicationId: input.applicationId },
        ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      },
      { idempotencyKey: `idv:${input.applicationId}` }
    );

    logger.info("Created Stripe Identity verification session", {
      applicationId: input.applicationId,
      sessionId: session.id,
      status: session.status,
    });

    return {
      id: session.id,
      status: session.status,
      clientSecret: session.client_secret ?? null,
      url: session.url ?? null,
    };
  }

  /**
   * Screening-time identity entry point — replaces the direct `verify()` call.
   *
   *   - MOCK_MODE + a screeningTag → legacy fixture path (e2e/demo), unchanged.
   *   - IDENTITY_VERIFICATION_ENABLED → read the webhook-persisted Stripe verdict.
   *   - otherwise → legacy synchronous verify() (flag-off byte-identical).
   */
  async resolve(input: {
    applicationId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    screeningTag?: string;
  }): Promise<IdentityVerificationResult> {
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.verify(input);
    }
    if (process.env.IDENTITY_VERIFICATION_ENABLED === "true") {
      return this.resolveStripeSession(input.applicationId);
    }
    return this.verify(input);
  }

  /**
   * Read the Stripe Identity verdict the webhook persisted onto the application
   * row. Returns `could_not_screen` (a HOLD, never a pass) when:
   *   - no session was ever created (`identity_session_id` null), or
   *   - the session hasn't reached a terminal verdict yet
   *     (`identity_verification_completed_at` null — applicant still capturing /
   *     Stripe still processing), or
   *   - the persisted detail isn't in the expected shape, or
   *   - the lookup itself throws.
   *
   * The webhook stores the full IdentityVerificationResult in
   * identity_verification_details on a terminal event. runFullScreening's status
   * guard (`status IN ('submitted','screening')`) means resolve() runs exactly
   * once per application, before the screening service overwrites that column
   * with the nested `.details`.
   */
  private async resolveStripeSession(applicationId: string): Promise<IdentityVerificationResult> {
    try {
      const res = await query(
        `SELECT identity_session_id,
                identity_verification_completed_at,
                identity_verification_details
           FROM applications
          WHERE id = $1`,
        [applicationId]
      );
      const row = res.rows[0];

      if (!row || !row.identity_session_id) {
        return this.couldNotScreen("no Stripe Identity session on file");
      }
      if (!row.identity_verification_completed_at) {
        return this.couldNotScreen("Stripe Identity capture still pending");
      }

      const stored = row.identity_verification_details;
      if (stored && typeof stored === "object" && typeof (stored as any).result === "string") {
        return stored as IdentityVerificationResult;
      }
      return this.couldNotScreen("Stripe Identity verdict not in expected shape");
    } catch (err) {
      logger.error("Failed to resolve Stripe Identity session", {
        error: (err as Error).message,
        applicationId,
      });
      return this.couldNotScreen("Stripe Identity lookup failed");
    }
  }

  /**
   * Map a Stripe Identity VerificationSession (with `last_verification_report`
   * expanded) to our IdentityVerificationResult. Pure + side-effect-free — the
   * webhook calls this then persists the result; the unit tests exercise it
   * table-driven.
   *
   * `expected` (the application's name/DOB) is used ONLY transiently to flag a
   * `name_dob_mismatch` review signal — never persisted.
   *
   * PII discipline: `rawResponse` carries ONLY categorical fields (ids, statuses,
   * error codes, document type) — never name/DOB/document numbers/images, which
   * live exclusively on Stripe.
   */
  mapStripeSessionToResult(
    vs: Stripe.Identity.VerificationSession,
    expected?: { firstName?: string; lastName?: string; dateOfBirth?: string }
  ): IdentityVerificationResult {
    // No usable verdict yet (or session abandoned) → HOLD, never a pass.
    if (vs.status === "processing") {
      return this.couldNotScreen("Stripe Identity session still processing");
    }
    if (vs.status === "canceled") {
      return this.couldNotScreen("Stripe Identity session canceled");
    }

    const report =
      vs.last_verification_report && typeof vs.last_verification_report === "object"
        ? (vs.last_verification_report as Stripe.Identity.VerificationReport)
        : null;
    const doc = report?.document ?? null;
    const selfie = report?.selfie ?? null;

    // The session status is Stripe's authoritative roll-up; the report errors
    // give us per-check detail for a `requires_input` (non-verified) session.
    const verified = vs.status === "verified";
    const documentValid = verified || !!(doc && !doc.error);
    const selfieMatch = verified || !!(selfie && !selfie.error);

    const riskSignals: string[] = [];
    if (doc?.error?.code) riskSignals.push(`document_${doc.error.code}`);
    if (selfie?.error?.code) riskSignals.push(`selfie_${selfie.error.code}`);
    if (vs.last_error?.code) riskSignals.push(vs.last_error.code);
    if (expected && doc && this.documentMismatch(doc, expected)) {
      riskSignals.push("name_dob_mismatch");
    }
    // A requires_input session is, by definition, NOT a clean verification —
    // Stripe is asking for more. If no per-check error surfaced a signal, inject
    // one so evaluateResults() can never grade it `verified` (the plan mandates
    // requires_input → rejected | review_required, never pass).
    if (vs.status === "requires_input" && riskSignals.length === 0) {
      riskSignals.push("requires_input");
    }

    // Stripe gives no numeric confidence/liveness score; derive deterministically
    // so the shared evaluateResults() thresholds (<0.5 reject / <0.85 review)
    // still apply uniformly across the synchronous and Stripe paths.
    const response = {
      documentValid,
      selfieMatch,
      confidence: documentValid ? 0.95 : 0.3,
      livenessScore: selfieMatch ? 0.99 : 0.3,
      idType: this.mapStripeDocType(doc?.type ?? null),
      riskSignals,
      rawResponse: {
        sessionId: vs.id,
        reportId: report?.id ?? null,
        sessionStatus: vs.status,
        documentStatus: doc ? (doc.error ? "errored" : "verified") : null,
        selfieStatus: selfie ? (selfie.error ? "errored" : "verified") : null,
        documentType: doc?.type ?? null,
        documentError: doc?.error?.code ?? null,
        selfieError: selfie?.error?.code ?? null,
        lastErrorCode: vs.last_error?.code ?? null,
      },
    };

    return this.evaluateResults(response);
  }

  /** Standard `could_not_screen` HOLD result (reason is categorical, no PII). */
  private couldNotScreen(reason: string): IdentityVerificationResult {
    return {
      result: "could_not_screen",
      confidence: 0,
      idType: "unknown",
      livenessScore: 0,
      details: {
        documentValid: false,
        selfieMatch: false,
        riskSignals: ["could_not_screen"],
        rawResponse: { reason },
      },
    };
  }

  /**
   * Transient name/DOB cross-check between the verified document and the
   * application. Returns true on a clear mismatch. Compared values are never
   * persisted — only the categorical `name_dob_mismatch` signal is.
   */
  private documentMismatch(
    doc: Stripe.Identity.VerificationReport.Document,
    expected: { firstName?: string; lastName?: string; dateOfBirth?: string }
  ): boolean {
    const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
    if (expected.firstName && doc.first_name && norm(doc.first_name) !== norm(expected.firstName)) {
      return true;
    }
    if (expected.lastName && doc.last_name && norm(doc.last_name) !== norm(expected.lastName)) {
      return true;
    }
    if (expected.dateOfBirth && doc.dob && doc.dob.year && doc.dob.month && doc.dob.day) {
      const iso = `${doc.dob.year}-${String(doc.dob.month).padStart(2, "0")}-${String(doc.dob.day).padStart(2, "0")}`;
      if (expected.dateOfBirth.slice(0, 10) !== iso) return true;
    }
    return false;
  }

  private mapStripeDocType(type: string | null): IdentityVerificationResult["idType"] {
    switch (type) {
      case "driving_license":
        return "driver_license";
      case "passport":
        return "passport";
      case "id_card":
        return "state_id";
      default:
        return "unknown";
    }
  }

  // ── Legacy synchronous path (flag OFF / MOCK / stub) — unchanged ─────────────

  async verify(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    screeningTag?: string;
  }): Promise<IdentityVerificationResult> {
    logger.info("Initiating identity verification", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    try {
      const response = await this.callIdentityAPI(input);
      return this.evaluateResults(response);
    } catch (err) {
      logger.error("Identity verification API error", { error: (err as Error).message });
      // A thrown error means the vendor never produced a verdict — we could NOT
      // screen. This must HOLD the application (not pass it, not treat it as a
      // borderline review), so it lands in screening_review for staff resolution.
      return {
        result: "could_not_screen",
        confidence: 0,
        idType: "unknown",
        livenessScore: 0,
        details: {
          documentValid: false,
          selfieMatch: false,
          riskSignals: ["could_not_screen"],
          rawResponse: { error: "Screening vendor unavailable — could not screen" },
        },
      };
    }
  }

  private async callIdentityAPI(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    screeningTag?: string;
  }): Promise<any> {
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.mockResponse(input.screeningTag);
    }

    if (!this.apiKey || this.apiKey === "changeme") {
      if (!shouldUseScreeningStub()) {
        throw new Error(STUB_GATE_ERROR);
      }
      logger.warn("Using stub identity verification — no API key configured (stub policy allows fallback)");
      return {
        documentValid: true,
        selfieMatch: true,
        confidence: 0.95,
        idType: "driver_license",
        livenessScore: 0.97,
        riskSignals: [],
      };
    }

    throw new Error("Production API integration not yet configured");
  }

  private mockResponse(tag: string): any {
    if (tag === "id_verification_fail") {
      return {
        documentValid: false,
        selfieMatch: false,
        confidence: 0.21,
        idType: "driver_license",
        livenessScore: 0.34,
        riskSignals: ["selfie_no_match", "document_tampered"],
      };
    }

    return {
      documentValid: true,
      selfieMatch: true,
      confidence: 0.95,
      idType: "driver_license",
      livenessScore: 0.97,
      riskSignals: [],
    };
  }

  private evaluateResults(response: any): IdentityVerificationResult {
    const confidence = response.confidence || 0;
    const livenessScore = response.livenessScore || 0;
    const documentValid = !!response.documentValid;
    const selfieMatch = !!response.selfieMatch;
    const riskSignals: string[] = Array.isArray(response.riskSignals) ? response.riskSignals : [];

    if (!documentValid || !selfieMatch || confidence < 0.5 || livenessScore < 0.5) {
      return {
        result: "rejected",
        confidence,
        idType: response.idType || "unknown",
        livenessScore,
        details: { documentValid, selfieMatch, riskSignals, rawResponse: response },
      };
    }

    if (confidence < 0.85 || livenessScore < 0.85 || riskSignals.length > 0) {
      return {
        result: "review_required",
        confidence,
        idType: response.idType || "unknown",
        livenessScore,
        details: { documentValid, selfieMatch, riskSignals, rawResponse: response },
      };
    }

    return {
      result: "verified",
      confidence,
      idType: response.idType || "unknown",
      livenessScore,
      details: { documentValid, selfieMatch, riskSignals, rawResponse: response },
    };
  }
}
