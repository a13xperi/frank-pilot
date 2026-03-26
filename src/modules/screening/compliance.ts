import { query } from "../../config/database";
import { logger } from "../../utils/logger";

export interface ComplianceCheckResult {
  result: "pass" | "fail" | "review_required";
  details: {
    incomeWithinLimits: boolean;
    applicableAMILimit: number | null;
    householdIncome: number;
    amiPercentage: number | null;
    assetVerification: string;
    regulatoryNotes: string[];
  };
}

/**
 * Tax Credit Compliance Engine.
 * Verifies income limits per HUD Area Median Income (AMI).
 * Handles IRS Form 8609/8586 compliance requirements.
 */
export class ComplianceService {
  /**
   * Run full compliance check against HUD AMI limits.
   */
  async runCheck(input: {
    propertyId: string;
    annualIncome: number;
    householdSize?: number;
    assets?: number;
  }): Promise<ComplianceCheckResult> {
    logger.info("Running compliance check", {
      propertyId: input.propertyId,
      householdSize: input.householdSize || 1,
    });

    const householdSize = input.householdSize || 1;
    const notes: string[] = [];

    // Get property AMI area
    const propertyResult = await query(
      "SELECT ami_area FROM properties WHERE id = $1",
      [input.propertyId]
    );

    if (propertyResult.rows.length === 0) {
      return {
        result: "review_required",
        details: {
          incomeWithinLimits: false,
          applicableAMILimit: null,
          householdIncome: input.annualIncome,
          amiPercentage: null,
          assetVerification: "not_checked",
          regulatoryNotes: ["Property not found in system"],
        },
      };
    }

    const amiArea = propertyResult.rows[0].ami_area;
    const currentYear = new Date().getFullYear();

    // Look up AMI limits
    const amiResult = await query(
      `SELECT ami_60_percent FROM ami_limits
       WHERE area = $1 AND year = $2 AND household_size = $3`,
      [amiArea, currentYear, householdSize]
    );

    if (amiResult.rows.length === 0) {
      notes.push(`No AMI limits found for ${amiArea}, year ${currentYear}, household size ${householdSize}`);

      // Try previous year
      const prevYearResult = await query(
        `SELECT ami_60_percent FROM ami_limits
         WHERE area = $1 AND year = $2 AND household_size = $3`,
        [amiArea, currentYear - 1, householdSize]
      );

      if (prevYearResult.rows.length === 0) {
        return {
          result: "review_required",
          details: {
            incomeWithinLimits: false,
            applicableAMILimit: null,
            householdIncome: input.annualIncome,
            amiPercentage: null,
            assetVerification: "not_checked",
            regulatoryNotes: [...notes, "No AMI data available — manual verification required"],
          },
        };
      }

      notes.push("Using previous year AMI limits");
    }

    const amiLimit = amiResult.rows.length > 0
      ? parseFloat(amiResult.rows[0].ami_60_percent)
      : null;

    // Income check (60% AMI is standard LIHTC threshold)
    const incomeWithinLimits = amiLimit !== null ? input.annualIncome <= amiLimit : false;
    const amiPercentage = amiLimit !== null ? (input.annualIncome / amiLimit) * 100 : null;

    if (!incomeWithinLimits && amiLimit !== null) {
      notes.push(
        `Income ($${input.annualIncome.toLocaleString()}) exceeds 60% AMI limit ($${amiLimit.toLocaleString()}) for ${amiArea}`
      );
    }

    // Asset verification (if provided)
    let assetVerification = "not_provided";
    if (input.assets !== undefined) {
      assetVerification = input.assets <= 5000 ? "within_limits" : "exceeds_limits";
      if (assetVerification === "exceeds_limits") {
        notes.push(`Asset value ($${input.assets.toLocaleString()}) may require additional documentation`);
      }
    }

    // IRS Form 8609 compliance notes
    notes.push("IRS Form 8609 certification required at lease signing");
    notes.push("Tenant Income Certification (TIC) must be completed annually");

    const result: ComplianceCheckResult["result"] =
      !incomeWithinLimits ? "fail"
      : assetVerification === "exceeds_limits" ? "review_required"
      : "pass";

    return {
      result,
      details: {
        incomeWithinLimits,
        applicableAMILimit: amiLimit,
        householdIncome: input.annualIncome,
        amiPercentage,
        assetVerification,
        regulatoryNotes: notes,
      },
    };
  }
}
