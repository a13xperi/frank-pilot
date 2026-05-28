import { logger } from "../../utils/logger";

export interface WorkNumberResult {
  result: "verified" | "no_record" | "partial" | "review_required";
  details: {
    currentEmployer?: string;
    employmentStatus?: "active" | "inactive" | "unknown";
    hireDate?: string;
    terminationDate?: string | null;
    annualizedIncome?: number;
    incomeSource?: "employer_reported" | "calculated" | "self_reported";
    rawResponse?: Record<string, unknown>;
  };
}

/**
 * The Work Number (Equifax) — instant employment + income verification.
 *
 * Only used if we land on Equifax as the screening vendor (see Section 2 of
 * docs/onboarding/frank-credentials-request.md). Pulled out into its own
 * module because Work Number is a separately credentialed Equifax product
 * with its own auth + endpoint, distinct from credit / criminal pulls.
 *
 * Stub pattern matches loft.ts / onesite.ts / background-check.ts: env-gated,
 * stub fallback when key absent, throws on production path until credentialed.
 */
export class WorkNumberService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.WORK_NUMBER_API_URL || "https://api.theworknumber.example.com";
    this.apiKey = process.env.WORK_NUMBER_API_KEY || "";
  }

  async verifyEmployment(input: {
    firstName: string;
    lastName: string;
    ssn: string;
    dateOfBirth: string;
  }): Promise<WorkNumberResult> {
    logger.info("Initiating Work Number employment verification", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    if (!this.apiKey || this.apiKey === "changeme") {
      logger.warn("Using stub Work Number verification — no API key configured");
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

    throw new Error("Work Number production API not yet configured");
  }
}
