import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { decrypt } from "../../utils/encryption";
import { BackgroundCheckService } from "./background-check";
import { CreditCheckService } from "./credit-check";
import { ComplianceService } from "./compliance";

export class ScreeningService {
  private backgroundCheck = new BackgroundCheckService();
  private creditCheck = new CreditCheckService();
  private compliance = new ComplianceService();

  /**
   * Run full automated screening pipeline:
   * 1. Background check
   * 2. Credit check
   * 3. Tax credit compliance
   *
   * Any single fail → overall fail.
   * Any review_required + no fails → overall review_required.
   * All pass → overall pass.
   */
  async runFullScreening(
    applicationId: string,
    initiatedBy: string,
    initiatorRole: string
  ): Promise<{
    overallResult: "pass" | "fail" | "review_required";
    background: any;
    credit: any;
    compliance: any;
  }> {
    // Fetch application data
    const appResult = await query(
      `SELECT * FROM applications WHERE id = $1 AND status = 'submitted'`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error("Application not found or not in submitted status");
    }

    const app = appResult.rows[0];

    // Update status to screening
    await query(
      "UPDATE applications SET status = 'screening' WHERE id = $1",
      [applicationId]
    );

    await writeAuditLog({
      action: "screening_initiated",
      actorId: initiatedBy,
      actorRole: initiatorRole,
      applicationId,
      resourceType: "application",
      details: { status: "screening" },
    });

    // Decrypt sensitive data for screening API calls
    const ssnDecrypted = decrypt(app.ssn_encrypted);
    const ssnLast4 = ssnDecrypted.slice(-4);
    const dob = decrypt(app.date_of_birth_encrypted);

    // Run all checks in parallel
    const [backgroundResult, creditResult, complianceResult] = await Promise.all([
      this.backgroundCheck.runCheck({
        firstName: app.first_name,
        lastName: app.last_name,
        ssnLast4,
        dateOfBirth: dob,
        state: app.current_state || "NV",
      }),
      this.creditCheck.runCheck({
        firstName: app.first_name,
        lastName: app.last_name,
        ssnLast4,
        dateOfBirth: dob,
      }),
      this.compliance.runCheck({
        propertyId: app.property_id,
        annualIncome: parseFloat(app.annual_income || "0"),
      }),
    ]);

    // Store results
    await query(
      `UPDATE applications SET
        background_check_result = $2,
        background_check_details = $3,
        background_check_completed_at = NOW(),
        credit_check_result = $4,
        credit_score = $5,
        credit_check_details = $6,
        credit_check_completed_at = NOW(),
        compliance_check_result = $7,
        compliance_check_details = $8,
        compliance_check_completed_at = NOW()
       WHERE id = $1`,
      [
        applicationId,
        backgroundResult.result,
        JSON.stringify(backgroundResult.details),
        creditResult.result,
        creditResult.creditScore,
        JSON.stringify(creditResult.details),
        complianceResult.result,
        JSON.stringify(complianceResult.details),
      ]
    );

    // Determine overall result
    const results = [backgroundResult.result, creditResult.result, complianceResult.result];
    let overallResult: "pass" | "fail" | "review_required";

    if (results.includes("fail")) {
      overallResult = "fail";
    } else if (results.includes("review_required")) {
      overallResult = "review_required";
    } else {
      overallResult = "pass";
    }

    // Update application status based on screening result
    const newStatus = overallResult === "fail" ? "screening_failed" : "screening_passed";
    await query(
      "UPDATE applications SET overall_screening_result = $2, status = $3 WHERE id = $1",
      [applicationId, overallResult, newStatus]
    );

    // Audit each check completion
    await Promise.all([
      writeAuditLog({
        action: "background_check_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { result: backgroundResult.result, riskScore: backgroundResult.details.riskScore },
      }),
      writeAuditLog({
        action: "credit_check_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { result: creditResult.result, creditScore: creditResult.creditScore },
      }),
      writeAuditLog({
        action: "compliance_check_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { result: complianceResult.result, incomeWithinLimits: complianceResult.details.incomeWithinLimits },
      }),
      writeAuditLog({
        action: "screening_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { overallResult, newStatus },
      }),
    ]);

    logger.info("Screening completed", {
      applicationId,
      overallResult,
      background: backgroundResult.result,
      credit: creditResult.result,
      compliance: complianceResult.result,
    });

    return {
      overallResult,
      background: backgroundResult,
      credit: creditResult,
      compliance: complianceResult,
    };
  }

  /**
   * Get screening results for an application.
   */
  async getResults(applicationId: string): Promise<any> {
    const result = await query(
      `SELECT
        background_check_result, background_check_details, background_check_completed_at,
        credit_check_result, credit_score, credit_check_details, credit_check_completed_at,
        compliance_check_result, compliance_check_details, compliance_check_completed_at,
        overall_screening_result
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
  }
}
