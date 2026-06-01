import { logger } from "../../utils/logger";
import { resolveVendor } from "./vendors";

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
 * P1 fail-loud contract: this service has NO internal try/catch. Employment is
 * the one domain where the vendor returns a near-final verdict (no
 * evaluateResults step), and a keyless-production gate error must PROPAGATE so
 * the orchestrator's call-site wrapper contains it as could_not_screen rather
 * than letting it look like a "verified" pass. The seam preserves that: the
 * sandbox vendor's employment() throws STUB_GATE_ERROR when the stub gate is
 * closed, and that throw flows straight out of verifyEmployment.
 */
export class WorkNumberService {
  async verifyEmployment(input: {
    firstName: string;
    lastName: string;
    ssn: string;
    dateOfBirth: string;
  }): Promise<WorkNumberResult> {
    logger.info("Initiating Work Number employment verification", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    // Delegate to the configured vendor. No catch — a keyless-production gate
    // error propagates by design (see class docblock). The employment vendor
    // response is structurally a WorkNumberResult.
    return resolveVendor("employment").employment(input);
  }
}
