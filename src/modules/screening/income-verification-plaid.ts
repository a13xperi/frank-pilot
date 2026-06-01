import { logger } from "../../utils/logger";
import { resolveVendor } from "./vendors";

export interface PlaidIncomeResult {
  result: "verified" | "unverified" | "review_required";
  verified: boolean;
  annualIncomeCents: number;
  monthlyAverageCents: number;
  sources: Array<{
    type: "payroll" | "self_employment" | "benefits" | "other";
    employer?: string;
    monthlyAverageCents: number;
  }>;
  details: {
    accountsLinked: number;
    monthsHistory: number;
    rawResponse?: Record<string, unknown>;
  };
}

/**
 * Plaid Income integration — real-time bank-linked income verification.
 * Returns annual income (cents) derived from direct-deposit history,
 * self-employment cash-flow analysis, and benefits-payment patterns.
 *
 * Cross-checked against Equifax Work Number when the applicant declares a
 * W-2 employer (FraudDetectionService.checkIncomeMismatch fires on >15%
 * delta between the two sources).
 *
 * The raw vendor response comes from the screening vendor seam
 * (resolveVendor("income")); this service owns only the evaluation policy and
 * the catch → review_required HOLD (Plaid failures are a softer hold than the
 * could_not_screen used by background/credit).
 */
export class PlaidIncomeService {
  async verifyIncome(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    plaidAccessToken?: string;
    screeningTag?: string;
  }): Promise<PlaidIncomeResult> {
    logger.info("Initiating Plaid Income verification", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    try {
      const response = await this.callPlaidAPI(input);
      return this.evaluateResults(response);
    } catch (err) {
      logger.error("Plaid Income API error", { error: (err as Error).message });
      return {
        result: "review_required",
        verified: false,
        annualIncomeCents: 0,
        monthlyAverageCents: 0,
        sources: [],
        details: {
          accountsLinked: 0,
          monthsHistory: 0,
          rawResponse: { error: "API unavailable, manual review required" },
        },
      };
    }
  }

  private async callPlaidAPI(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    plaidAccessToken?: string;
    screeningTag?: string;
  }): Promise<any> {
    // Delegate the raw pull to the configured vendor (sandbox by default; plaid
    // when SCREENING_VENDOR_INCOME=plaid + creds). The vendor self-gates on the
    // stub policy: keyless production THROWS here → caught above → review_required.
    return resolveVendor("income").income(input);
  }

  private evaluateResults(response: any): PlaidIncomeResult {
    const verified = !!response.verified;
    const annualIncomeCents = response.annualIncomeCents || 0;
    const monthlyAverageCents = response.monthlyAverageCents || 0;
    const sources = Array.isArray(response.sources) ? response.sources : [];
    const accountsLinked = response.accountsLinked || 0;
    const monthsHistory = response.monthsHistory || 0;

    if (!verified || accountsLinked === 0 || monthsHistory < 3) {
      return {
        result: "review_required",
        verified,
        annualIncomeCents,
        monthlyAverageCents,
        sources,
        details: { accountsLinked, monthsHistory, rawResponse: response },
      };
    }

    return {
      result: "verified",
      verified: true,
      annualIncomeCents,
      monthlyAverageCents,
      sources,
      details: { accountsLinked, monthsHistory, rawResponse: response },
    };
  }
}
