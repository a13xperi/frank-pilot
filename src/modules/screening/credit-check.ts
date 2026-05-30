import { logger } from "../../utils/logger";
import { shouldUseScreeningStub, STUB_GATE_ERROR } from "./stub-policy";

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
 */
export class CreditCheckService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.SCREENING_API_URL || "https://api.screening-provider.example.com";
    this.apiKey = process.env.SCREENING_API_KEY || "";
  }

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
    // STUB: Replace with actual credit bureau API call
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.mockResponse(input.screeningTag);
    }

    if (!this.apiKey || this.apiKey === "changeme") {
      if (!shouldUseScreeningStub()) {
        throw new Error(STUB_GATE_ERROR);
      }
      logger.warn("Using stub credit check — no API key configured (stub policy allows fallback)");
      return {
        creditScore: 680,
        paymentHistory: "good",
        outstandingDebts: 2500,
        collections: 0,
        evictions: 0,
        bankruptcies: 0,
      };
    }

    throw new Error("Production API integration not yet configured");
  }

  private mockResponse(tag: string): any {
    if (tag === "review_low_credit") {
      return {
        creditScore: 520,
        paymentHistory: "fair",
        outstandingDebts: 8200,
        collections: 1,
        evictions: 0,
        bankruptcies: 0,
      };
    }
    if (tag === "approve_clean") {
      return {
        creditScore: 720,
        paymentHistory: "excellent",
        outstandingDebts: 1200,
        collections: 0,
        evictions: 0,
        bankruptcies: 0,
      };
    }
    return {
      creditScore: 680,
      paymentHistory: "good",
      outstandingDebts: 2500,
      collections: 0,
      evictions: 0,
      bankruptcies: 0,
    };
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
