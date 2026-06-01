import { logger } from "../../utils/logger";
import { resolveVendor } from "./vendors";

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
