import { logger } from "../../../utils/logger";
import { shouldUseScreeningStub, STUB_GATE_ERROR } from "../stub-policy";
import type {
  ScreeningVendor,
  ScreeningCheckDomain,
  BackgroundVendorInput,
  BackgroundVendorResponse,
  CreditVendorInput,
  CreditVendorResponse,
  IncomeVendorInput,
  IncomeVendorResponse,
  NsopwVendorInput,
  NsopwVendorResponse,
  EmploymentVendorInput,
  EmploymentVendorResponse,
} from "./types";

/**
 * The Work Number (Equifax) — real employment + income verification adapter.
 * DORMANT until WORK_NUMBER_API_KEY is set.
 *
 * It supports ONLY the employment domain (Work Number is an employment/income
 * product). The registry refuses to resolve worknumber for any other domain, so
 * a misconfig like SCREENING_VENDOR=worknumber HOLDS the non-employment checks
 * fail-loud rather than silently passing them.
 *
 * Activation:
 *   SCREENING_VENDOR_EMPLOYMENT=worknumber   (route only employment here)
 *   WORK_NUMBER_API_KEY=...                  (from the Equifax/TWN dashboard)
 *   WORK_NUMBER_API_URL=...                  (optional; defaults to the TWN host)
 *
 * When the key is absent the adapter is inert: it defers to the same fail-loud
 * stub gate as everything else (throw STUB_GATE_ERROR unless the gate is open),
 * so adding this vendor to the registry cannot change behaviour until creds land.
 *
 * P1 fail-loud contract (employment is special): the service that calls this —
 * work-number.ts — has NO internal try/catch, because employment is the one
 * domain where the vendor returns a near-final verdict rather than raw facts (no
 * evaluateResults step in the service; THIS adapter owns the mapping). A keyless
 * or erroring call therefore PROPAGATES out of verifyEmployment, and the
 * orchestrator's call-site wrapper in service.ts contains it as a
 * could_not_screen HOLD. This adapter never fabricates a passing verdict: every
 * HTTP / shape failure THROWS.
 *
 * ⚠️ HTTP SHAPE IS AN ASSUMPTION. The request/response below model the published
 * "Employment & Income Verification" instant product with a Bearer token. The
 * real TWN integration is most likely OAuth2 (client-credentials → short-lived
 * access token) rather than a static API key, and the response envelope differs
 * by contract tier. Before go-live the integrator MUST re-validate auth +
 * request + response against the sandbox the Equifax contract grants. Until then
 * this stays dormant (no key → gate throw) and ships dark.
 */
export class WorkNumberVendor implements ScreeningVendor {
  readonly name = "worknumber";

  supports(domain: ScreeningCheckDomain): boolean {
    return domain === "employment";
  }

  async employment(input: EmploymentVendorInput): Promise<EmploymentVendorResponse> {
    const apiKey = process.env.WORK_NUMBER_API_KEY || "";
    const apiUrl = process.env.WORK_NUMBER_API_URL || "https://api.theworknumber.example.com";

    if (!apiKey || apiKey === "changeme") {
      // No credentials → dormant. Defer to the global fail-loud gate: throw in
      // real production (so the call-site HOLDs as could_not_screen), return the
      // deterministic stub only behind the gate (MOCK_MODE / ALLOW_STUB_SCREENING
      // / test). Mirrors PlaidVendor + SandboxVendor.employment exactly.
      if (!shouldUseScreeningStub()) {
        throw new Error(STUB_GATE_ERROR);
      }
      logger.warn(
        "Work Number vendor selected but no API key configured — returning stub (stub policy allows fallback)"
      );
      return {
        result: "verified",
        details: {
          currentEmployer: "STUB Employer Inc.",
          employmentStatus: "active",
          hireDate: "2023-01-01",
          terminationDate: null,
          annualizedIncome: 45000,
          incomeSource: "employer_reported",
          rawResponse: { stub: true },
        },
      };
    }

    logger.info("Work Number live employment verification", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    const raw = await this.callApi(apiUrl, apiKey, input);
    return this.evaluateResults(raw);
  }

  /**
   * Issue the instant-verification request. Any non-2xx THROWS — the absence of
   * an internal catch (here and in work-number.ts) is the P1 fail-loud contract:
   * a vendor outage must surface as could_not_screen, never as a silent pass.
   */
  private async callApi(
    apiUrl: string,
    apiKey: string,
    input: EmploymentVendorInput
  ): Promise<unknown> {
    const res = await fetch(`${apiUrl}/v1/verifications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        firstName: input.firstName,
        lastName: input.lastName,
        ssn: input.ssn,
        dateOfBirth: input.dateOfBirth,
      }),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = (await res.json()) as any;
        detail = err?.code ? `${err.code}: ${err.message ?? ""}` : JSON.stringify(err);
      } catch {
        /* keep HTTP status */
      }
      throw new Error(`Work Number /v1/verifications failed — ${detail}`);
    }
    return res.json();
  }

  /**
   * Map a raw TWN response to an EmploymentVendorResponse verdict.
   *
   *   active record + employer + income  → verified
   *   no employment record found         → no_record
   *   record found but income missing    → partial
   *   conflicting / ambiguous            → review_required
   *
   * A structurally unparseable response THROWS (fail-loud) rather than guessing a
   * verdict. ⚠️ Field names follow the assumed published shape — re-validate at
   * go-live (see class docblock).
   */
  private evaluateResults(raw: unknown): EmploymentVendorResponse {
    const body = raw as any;
    if (!body || typeof body !== "object") {
      throw new Error("Work Number returned an unparseable verification response");
    }

    const records = Array.isArray(body.employments)
      ? body.employments
      : Array.isArray(body.records)
        ? body.records
        : [];

    if (records.length === 0) {
      // The vendor positively reported "no record on file" — a real, usable
      // verdict (not a failure). The service maps no_record → review_required.
      return {
        result: "no_record",
        details: { employmentStatus: "unknown", rawResponse: body },
      };
    }

    // Conflicting active employers → let a human reconcile.
    const active = records.filter(
      (r: any) => (r?.status ?? "active") === "active"
    );
    if (active.length > 1) {
      return {
        result: "review_required",
        details: {
          employmentStatus: "active",
          rawResponse: body,
        },
      };
    }

    const rec = active[0] || records[0];
    const employer = rec?.employerName ?? rec?.employer ?? undefined;
    const annualizedIncome =
      typeof rec?.annualizedIncome === "number"
        ? rec.annualizedIncome
        : typeof rec?.annualIncome === "number"
          ? rec.annualIncome
          : undefined;
    const status: "active" | "inactive" | "unknown" =
      rec?.status === "inactive" ? "inactive" : rec?.status === "active" ? "active" : "unknown";

    // Record present but no income figure → partial (service → review_required).
    if (annualizedIncome === undefined) {
      return {
        result: "partial",
        details: {
          currentEmployer: employer,
          employmentStatus: status,
          hireDate: rec?.hireDate ?? undefined,
          terminationDate: rec?.terminationDate ?? null,
          incomeSource: "employer_reported",
          rawResponse: body,
        },
      };
    }

    return {
      result: "verified",
      details: {
        currentEmployer: employer,
        employmentStatus: status,
        hireDate: rec?.hireDate ?? undefined,
        terminationDate: rec?.terminationDate ?? null,
        annualizedIncome,
        incomeSource: "employer_reported",
        rawResponse: body,
      },
    };
  }

  // ── Unsupported domains — defensive throws (registry already refuses these) ──

  private unsupported(domain: ScreeningCheckDomain): never {
    throw new Error(`Work Number vendor supports only the employment check, not ${domain}`);
  }
  async background(_input: BackgroundVendorInput): Promise<BackgroundVendorResponse> {
    return this.unsupported("background");
  }
  async credit(_input: CreditVendorInput): Promise<CreditVendorResponse> {
    return this.unsupported("credit");
  }
  async income(_input: IncomeVendorInput): Promise<IncomeVendorResponse> {
    return this.unsupported("income");
  }
  async nsopw(_input: NsopwVendorInput): Promise<NsopwVendorResponse> {
    return this.unsupported("nsopw");
  }
}
