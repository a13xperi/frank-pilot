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
      "SELECT ami_area, rent_schedule FROM properties WHERE id = $1",
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

    // Determine the property's applicable AMI ceiling from its rent_schedule tiers.
    // Keys look like "1BR_45AMI", "2BR_40AMI", "2BR_market". The screening income
    // ceiling is the HIGHEST affordable tier present — anyone eligible for some
    // affordable unit passes; the finer per-unit tier and the market units are
    // resolved at unit assignment. Legacy properties with no parseable tiers fall
    // back to 60% (the historical default), so their behavior is unchanged.
    const rentSchedule = (propertyResult.rows[0].rent_schedule || {}) as Record<string, unknown>;
    const tierKeys = Object.keys(rentSchedule);
    const affordableTiers = tierKeys
      .map((k) => {
        const m = k.match(/_(\d+)\s*AMI/i);
        return m ? parseInt(m[1], 10) : null;
      })
      .filter((t): t is number => t !== null && t > 0);
    const hasMarketUnits = tierKeys.some((k) => /market/i.test(k));
    const applicableTier = affordableTiers.length > 0 ? Math.max(...affordableTiers) : 60;

    // Look up AMI limits (all tiers; the applicable one is selected below)
    const amiResult = await query(
      `SELECT ami_30_percent, ami_50_percent, ami_60_percent, ami_80_percent FROM ami_limits
       WHERE area = $1 AND year = $2 AND household_size = $3`,
      [amiArea, currentYear, householdSize]
    );

    if (amiResult.rows.length === 0) {
      notes.push(`No AMI limits found for ${amiArea}, year ${currentYear}, household size ${householdSize}`);

      // Try previous year
      const prevYearResult = await query(
        `SELECT ami_30_percent, ami_50_percent, ami_60_percent, ami_80_percent FROM ami_limits
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

    const amiLimit = this.limitForTier(
      amiResult.rows.length > 0 ? amiResult.rows[0] : null,
      applicableTier
    );

    // Income check against the property's applicable AMI tier
    const incomeWithinLimits = amiLimit !== null ? input.annualIncome <= amiLimit : false;
    const amiPercentage = amiLimit !== null ? (input.annualIncome / amiLimit) * 100 : null;

    if (!incomeWithinLimits && amiLimit !== null) {
      notes.push(
        `Income ($${input.annualIncome.toLocaleString()}) exceeds ${applicableTier}% AMI limit ($${amiLimit.toLocaleString()}) for ${amiArea}`
      );
      if (hasMarketUnits) {
        notes.push(
          `${amiArea} property has market-rate units (no income cap) — routing to manual review to confirm whether this applicant is for a market unit`
        );
      }
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

    const result: ComplianceCheckResult["result"] = !incomeWithinLimits
      ? hasMarketUnits
        ? "review_required" // market units have no income cap — a human confirms the unit type
        : "fail"
      : assetVerification === "exceeds_limits"
        ? "review_required"
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

  /**
   * Resolve the income limit for a given AMI tier from an ami_limits row.
   * 30/50/60/80% use their published columns; non-standard tiers (e.g. 40, 45)
   * are derived from the 50% base, since HUD income limits scale with the AMI
   * percentage. Returns null when no usable column is present.
   */
  private limitForTier(row: Record<string, unknown> | null, tier: number): number | null {
    if (!row) return null;
    const num = (col: string): number | null => {
      const v = row[col];
      return v != null ? parseFloat(String(v)) : null;
    };
    const exact: Record<number, string> = {
      30: "ami_30_percent",
      50: "ami_50_percent",
      60: "ami_60_percent",
      80: "ami_80_percent",
    };
    if (exact[tier]) {
      const v = num(exact[tier]);
      if (v != null) return v;
    }
    const base50 = num("ami_50_percent");
    if (base50 != null) return Math.round(base50 * (tier / 50));
    const base60 = num("ami_60_percent");
    if (base60 != null) return Math.round(base60 * (tier / 60));
    return null;
  }
}
