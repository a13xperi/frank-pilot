import { logger } from "../../utils/logger";
import { shouldUseScreeningStub, STUB_GATE_ERROR } from "./stub-policy";

export interface BackgroundCheckResult {
  result: "pass" | "fail" | "review_required" | "could_not_screen";
  details: {
    felonies: number;
    sexOffenses: boolean;
    violentCrimes: boolean;
    misdemeanors: number;
    riskScore: number;
    rawResponse?: Record<string, unknown>;
  };
}

/**
 * Third-party background check integration.
 * Auto-fail: felonies, sex offenses, violence.
 * Risk-scored: minor misdemeanors.
 */
export class BackgroundCheckService {
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
    state: string;
    screeningTag?: string;
  }): Promise<BackgroundCheckResult> {
    logger.info("Initiating background check", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    try {
      // In production, this calls the third-party clearance company API.
      // Stub implementation for development/testing.
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
    // STUB: Replace with actual API call in production
    // Example: const response = await fetch(`${this.apiUrl}/v1/background-check`, { ... });

    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.mockResponse(input.screeningTag);
    }

    if (!this.apiKey || this.apiKey === "changeme") {
      if (!shouldUseScreeningStub()) {
        throw new Error(STUB_GATE_ERROR);
      }
      logger.warn("Using stub background check — no API key configured (stub policy allows fallback)");
      return {
        felonies: 0,
        sexOffenses: false,
        violentCrimes: false,
        misdemeanors: [],
        records: [],
      };
    }

    // Production implementation would go here
    throw new Error("Production API integration not yet configured");
  }

  private mockResponse(tag: string): any {
    if (tag === "deny_felony") {
      return {
        felonies: 1,
        sexOffenses: false,
        violentCrimes: false,
        misdemeanors: [],
        records: [{ type: "felony", description: "synthetic" }],
      };
    }
    if (tag === "deny_sex_offender") {
      return {
        felonies: 0,
        sexOffenses: true,
        violentCrimes: false,
        misdemeanors: [],
        records: [{ type: "lifetime_registry", description: "synthetic" }],
      };
    }
    if (tag === "review_misdemeanors") {
      return {
        felonies: 0,
        sexOffenses: false,
        violentCrimes: false,
        misdemeanors: [{ code: "M-1" }, { code: "M-2" }, { code: "M-3" }],
        records: [],
      };
    }
    return {
      felonies: 0,
      sexOffenses: false,
      violentCrimes: false,
      misdemeanors: [],
      records: [],
    };
  }

  private evaluateResults(response: any): BackgroundCheckResult {
    const felonies = response.felonies || 0;
    const sexOffenses = response.sexOffenses || false;
    const violentCrimes = response.violentCrimes || false;
    const misdemeanors = (response.misdemeanors || []).length;

    // Auto-fail criteria
    if (felonies > 0 || sexOffenses || violentCrimes) {
      return {
        result: "fail",
        details: {
          felonies,
          sexOffenses,
          violentCrimes,
          misdemeanors,
          riskScore: 100,
          rawResponse: response,
        },
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
}
