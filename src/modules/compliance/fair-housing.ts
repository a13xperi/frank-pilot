import { query } from "../../config/database";
import { logger } from "../../utils/logger";

/**
 * Objective screening criteria applied uniformly to every applicant.
 * Listing them here makes the criteria auditable and change-tracked.
 * Under the Fair Housing Act (42 U.S.C. §§ 3601–3619), these must be:
 *   - Applied equally to all applicants regardless of protected class
 *   - Based on legitimate, non-discriminatory business necessity
 *   - Documented and available for HUD audit
 */
export const OBJECTIVE_SCREENING_CRITERIA = [
  "Criminal background: auto-fail for felonies, sex offenses, violent crimes",
  "Criminal background: review_required for ≥3 misdemeanors",
  "Credit: auto-fail for evictions or bankruptcies",
  "Credit: review_required for credit score < 600",
  "Income: must not exceed 60% Area Median Income (HUD LIHTC §42)",
  "Income limit lookup is household-size specific (1–8 persons)",
  "Assets > $5,000: additional documentation required (review_required)",
  "Duplicate SSN: fraud flag raised for manual review",
] as const;

/**
 * Protected class information is deliberately NOT collected on applications.
 * Collecting it would violate FHA and create discrimination risk.
 * Instead, compliance is demonstrated through:
 *   1. Objective, consistently-applied criteria (listed above)
 *   2. Complete adverse action notices for all denials (FCRA §1681m)
 *   3. Immutable audit trail of every decision with actor, role, and timestamp
 */
const PROTECTED_CLASS_NOTICE =
  "No protected class information (race, color, national origin, religion, " +
  "sex, familial status, disability) is collected. Compliance is ensured through " +
  "objective criteria applied uniformly and complete adverse action documentation.";

export interface FairHousingReport {
  generatedAt: string;
  propertyId: string | null;
  decisions: {
    totalApplications: number;
    screening: {
      passed: number;
      failed: number;
      reviewRequired: number;
      pending: number;
    };
    approvals: {
      approved: number;    // any tier_approved or onboarded
      denied: number;      // any tier_denied
      inProgress: number;  // screening / tier1_review / tier2_review / tier3_review
    };
  };
  adverseActionCompleteness: {
    totalDenials: number;
    noticesOnFile: number;
    completenessPercent: number;
    missingNotices: number;
  };
  objectiveCriteria: readonly string[];
  protectedClassNotice: string;
}

export class FairHousingService {
  /**
   * Generate a Fair Housing Act compliance report.
   *
   * Provides regulators and internal auditors with:
   * - Decision outcome statistics (neutral — no protected class data)
   * - Adverse action notice completeness (FCRA requirement)
   * - Documentation that only objective criteria are applied
   *
   * @param propertyId Optional — scope report to one property; null = all properties
   */
  async generateReport(propertyId: string | null = null): Promise<FairHousingReport> {
    logger.info("Generating Fair Housing compliance report", { propertyId });

    const [decisionStats, adverseActionStats] = await Promise.all([
      this.fetchDecisionStats(propertyId),
      this.fetchAdverseActionCompleteness(propertyId),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      propertyId,
      decisions: decisionStats,
      adverseActionCompleteness: adverseActionStats,
      objectiveCriteria: OBJECTIVE_SCREENING_CRITERIA,
      protectedClassNotice: PROTECTED_CLASS_NOTICE,
    };
  }

  private async fetchDecisionStats(propertyId: string | null): Promise<FairHousingReport["decisions"]> {
    const baseWhere = propertyId ? "WHERE property_id = $1" : "";
    const params = propertyId ? [propertyId] : [];

    const result = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE overall_screening_result = 'pass')::int AS screening_passed,
         COUNT(*) FILTER (WHERE overall_screening_result = 'fail')::int AS screening_failed,
         COUNT(*) FILTER (WHERE overall_screening_result = 'review_required')::int AS screening_review,
         COUNT(*) FILTER (WHERE overall_screening_result IS NULL AND status NOT IN ('draft', 'submitted'))::int AS screening_pending,
         COUNT(*) FILTER (WHERE status IN ('tier1_approved','tier2_approved','tier3_approved','lease_generated','onboarded'))::int AS approved,
         COUNT(*) FILTER (WHERE status IN ('tier1_denied','tier2_denied','tier3_denied','screening_failed'))::int AS denied,
         COUNT(*) FILTER (WHERE status IN ('screening','tier1_review','tier2_review','tier3_review'))::int AS in_progress
       FROM applications
       ${baseWhere}`,
      params
    );

    const row = result.rows[0];
    return {
      totalApplications: row.total,
      screening: {
        passed: row.screening_passed,
        failed: row.screening_failed,
        reviewRequired: row.screening_review,
        pending: row.screening_pending,
      },
      approvals: {
        approved: row.approved,
        denied: row.denied,
        inProgress: row.in_progress,
      },
    };
  }

  private async fetchAdverseActionCompleteness(
    propertyId: string | null
  ): Promise<FairHousingReport["adverseActionCompleteness"]> {
    // Count applications that reached a denial status
    const denialWhere = propertyId
      ? "WHERE status IN ('tier1_denied','tier2_denied','tier3_denied','screening_failed') AND property_id = $1"
      : "WHERE status IN ('tier1_denied','tier2_denied','tier3_denied','screening_failed')";
    const denialParams = propertyId ? [propertyId] : [];

    const denialResult = await query(
      `SELECT COUNT(*)::int AS total FROM applications ${denialWhere}`,
      denialParams
    );
    const totalDenials = denialResult.rows[0].total;

    // Count distinct applications that have at least one adverse action notice
    const noticeWhere = propertyId
      ? `WHERE a.status IN ('tier1_denied','tier2_denied','tier3_denied','screening_failed')
           AND a.property_id = $1
           AND EXISTS (SELECT 1 FROM adverse_action_notices n WHERE n.application_id = a.id)`
      : `WHERE a.status IN ('tier1_denied','tier2_denied','tier3_denied','screening_failed')
           AND EXISTS (SELECT 1 FROM adverse_action_notices n WHERE n.application_id = a.id)`;
    const noticeParams = propertyId ? [propertyId] : [];

    const noticeResult = await query(
      `SELECT COUNT(*)::int AS with_notice FROM applications a ${noticeWhere}`,
      noticeParams
    );
    const noticesOnFile = noticeResult.rows[0].with_notice;

    const completenessPercent =
      totalDenials === 0 ? 100 : Math.round((noticesOnFile / totalDenials) * 100);

    return {
      totalDenials,
      noticesOnFile,
      completenessPercent,
      missingNotices: totalDenials - noticesOnFile,
    };
  }
}
