import { logger } from "../../utils/logger";
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

/**
 * Credit check integration.
 * Threshold: 600+ preferred, decision matrix allows exceptions.
 *
 * The raw vendor response comes from the screening vendor seam
 * (resolveVendor("credit")); this service owns only Frank's evaluation policy
 * (evaluateResults) and the fail-loud catch → could_not_screen HOLD.
 */
export class CreditCheckService {
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
