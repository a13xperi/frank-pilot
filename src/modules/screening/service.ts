import { query, getClient } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { decrypt } from "../../utils/encryption";
import { BackgroundCheckService } from "./background-check";
import { CreditCheckService } from "./credit-check";
import { ComplianceService } from "./compliance";
import { FraudDetectionService } from "./fraud-detection";
import { IdentityVerificationService } from "./identity-verification";
import { AdverseActionService } from "../adverse-action/service";

export class ScreeningService {
  private identity = new IdentityVerificationService();
  private backgroundCheck = new BackgroundCheckService();
  private creditCheck = new CreditCheckService();
  private compliance = new ComplianceService();
  private fraud = new FraudDetectionService();
  private adverseAction = new AdverseActionService();

  /**
   * Run full automated screening pipeline:
   * 1. Identity verification (Persona / Stripe Identity)
   * 2. Fraud screening (duplicate SSN, address)
   * 3. Background check
   * 4. Credit check
   * 5. Tax credit compliance
   *
   * Identity "rejected" short-circuits to fail (with FCRA adverse-action notice).
   * Duplicate-SSN short-circuits to fail (same pattern).
   * Otherwise: any single fail → overall fail; any review_required + no fails →
   * overall review_required; all pass → overall pass.
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

    // Fraud screening step — runs BEFORE the parallel vendor checks.
    // Duplicate-SSN is the only fraud signal that auto-fails; everything
    // else raises a flag for staff review and continues the pipeline.
    if (app.ssn_hash) {
      const dupCheck = await this.fraud.checkDuplicateSSN(app.ssn_hash);
      const otherIds = dupCheck.existingApplicationIds.filter((id) => id !== applicationId);
      if (otherIds.length > 0) {
        await query(
          "UPDATE applications SET overall_screening_result = $2, status = $3 WHERE id = $1",
          [applicationId, "fail", "screening_failed"]
        );
        await writeAuditLog({
          action: "screening_completed",
          actorId: initiatedBy,
          actorRole: initiatorRole,
          applicationId,
          details: {
            overallResult: "fail",
            newStatus: "screening_failed",
            failedAt: "fraud_screening",
            reason: "duplicate_ssn",
            duplicateApplicationIds: otherIds,
          },
        });

        this.adverseAction
          .sendNotice(
            applicationId,
            initiatedBy,
            initiatorRole,
            "screening_failed",
            "Automated screening denial: duplicate SSN detected on another active application"
          )
          .catch((err: Error) =>
            logger.error("Failed to send FCRA adverse action notice after duplicate-SSN denial", {
              error: err.message,
              applicationId,
            })
          );

        logger.warn("Screening early-exit on duplicate SSN", {
          applicationId,
          duplicateApplicationIds: otherIds,
        });

        return {
          overallResult: "fail",
          background: { result: "fail", details: { reason: "duplicate_ssn" } },
          credit: { result: "fail", details: { reason: "duplicate_ssn" } },
          compliance: { result: "fail", details: { reason: "duplicate_ssn" } },
        };
      }
    }

    // Address-fraud check — non-blocking; raises a flag for staff review.
    if (app.current_address_line1) {
      const client = await getClient();
      try {
        await this.fraud.checkAddressFraud(client, applicationId, {
          addressLine1: app.current_address_line1,
          city: app.current_city || undefined,
          state: app.current_state || undefined,
          zip: app.current_zip || undefined,
        });
      } catch (err) {
        logger.warn("Address-fraud check failed (non-blocking)", {
          error: (err as Error).message,
          applicationId,
        });
      } finally {
        client.release();
      }
    }

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
        householdSize: app.household_size || 1,
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

    // FCRA § 1681m: send adverse action notice when screening result is fail.
    // Non-blocking — notice failure must not prevent the screening result from being returned.
    if (overallResult === "fail") {
      const failedChecks = [
        backgroundResult.result === "fail" ? "background check" : null,
        creditResult.result === "fail" ? "credit check" : null,
        complianceResult.result === "fail" ? "compliance check" : null,
      ]
        .filter(Boolean)
        .join(", ");

      this.adverseAction
        .sendNotice(
          applicationId,
          initiatedBy,
          initiatorRole,
          "screening_failed",
          `Automated screening denial: failed ${failedChecks}`
        )
        .catch((err: Error) =>
          logger.error("Failed to send FCRA adverse action notice after screening failure", {
            error: err.message,
            applicationId,
          })
        );
    }

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
