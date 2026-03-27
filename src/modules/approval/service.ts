import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { enforceSeparationOfDuties } from "../../middleware/rbac";
import { FraudDetectionService } from "../screening/fraud-detection";
import { AdverseActionService } from "../adverse-action/service";
import { logger } from "../../utils/logger";

/**
 * Monthly rent threshold above which Tier 2 (Regional Manager) review is required.
 * This is a policy decision — tracked in git history for audit purposes.
 * Change requires approval from Asset Management and updating the LIHTC compliance
 * documentation, since LIHTC rents are capped by HUD payment standards.
 */
export const TIER2_RENT_THRESHOLD = 1500;

export type ApprovalDecision = "pass" | "fail";

export interface ApprovalInput {
  applicationId: string;
  decision: ApprovalDecision;
  notes: string;
  reviewerId: string;
  reviewerRole: string;
}

/**
 * 3-Tier Approval Workflow:
 *
 * Tier 1: Senior Manager — all applications that pass screening
 * Tier 2: Regional Manager — leases >TIER2_RENT_THRESHOLD/mo or exceptions
 * Tier 3: Asset Manager — final sign-off on exceptions only
 *
 * Separation of duties enforced: no single person can submit AND approve.
 */
export class ApprovalService {
  private fraudDetection = new FraudDetectionService();
  private adverseAction = new AdverseActionService();

  /**
   * Tier 1: Senior Manager review.
   * Required for ALL applications that pass automated screening.
   */
  async tier1Review(input: ApprovalInput): Promise<any> {
    const app = await this.getApplication(input.applicationId);

    if (!["screening_passed", "tier1_review"].includes(app.status)) {
      throw new Error(`Application not ready for Tier 1 review (status: ${app.status})`);
    }

    // Separation of duties: reviewer cannot be the submitter
    if (!enforceSeparationOfDuties(input.reviewerId, [app.submitted_by].filter(Boolean))) {
      throw new Error("Separation of duties violation: reviewer cannot be the application submitter");
    }

    // Check for unresolved fraud flags
    const fraudFlags = await this.fraudDetection.getUnresolvedFlags(input.applicationId);
    if (fraudFlags.length > 0 && input.decision === "pass") {
      throw new Error(
        `Cannot approve: ${fraudFlags.length} unresolved fraud flag(s). Resolve all flags before approving.`
      );
    }

    const newStatus = input.decision === "pass" ? "tier1_approved" : "tier1_denied";

    await query(
      `UPDATE applications SET
        status = $2,
        tier1_reviewer_id = $3,
        tier1_decision = $4,
        tier1_notes = $5,
        tier1_decided_at = NOW()
       WHERE id = $1`,
      [input.applicationId, newStatus, input.reviewerId, input.decision, input.notes]
    );

    // Check approval speed anomaly
    await this.fraudDetection.checkApprovalSpeed(input.applicationId);

    // Determine if Tier 2 is required
    const requiresTier2 = this.requiresTier2(app);
    if (input.decision === "pass" && requiresTier2) {
      await query(
        "UPDATE applications SET status = 'tier2_review', tier2_required = true WHERE id = $1",
        [input.applicationId]
      );
    }

    await writeAuditLog({
      action: input.decision === "pass" ? "tier1_approved" : "tier1_denied",
      actorId: input.reviewerId,
      actorRole: input.reviewerRole,
      applicationId: input.applicationId,
      details: {
        decision: input.decision,
        notes: input.notes,
        requiresTier2,
      },
    });

    // FCRA § 1681m: send adverse action notice on human denial (non-blocking)
    if (input.decision === "fail") {
      this.adverseAction
        .sendNotice(
          input.applicationId,
          input.reviewerId,
          input.reviewerRole,
          "tier1_denied",
          `Tier 1 review denial: ${input.notes}`
        )
        .catch((err: Error) =>
          logger.error("Failed to send FCRA adverse action notice after Tier 1 denial", {
            error: err.message,
            applicationId: input.applicationId,
          })
        );
    }

    logger.info("Tier 1 review completed", {
      applicationId: input.applicationId,
      decision: input.decision,
      requiresTier2,
    });

    return {
      applicationId: input.applicationId,
      decision: input.decision,
      status: input.decision === "pass" && requiresTier2 ? "tier2_review" : newStatus,
      requiresTier2,
    };
  }

  /**
   * Tier 2: Regional Manager review.
   * Required for leases >TIER2_RENT_THRESHOLD/mo or any exceptions.
   */
  async tier2Review(input: ApprovalInput): Promise<any> {
    const app = await this.getApplication(input.applicationId);

    if (!["tier1_approved", "tier2_review"].includes(app.status)) {
      throw new Error(`Application not ready for Tier 2 review (status: ${app.status})`);
    }

    // Separation of duties
    const previousActors = [app.submitted_by, app.tier1_reviewer_id].filter(Boolean);
    if (!enforceSeparationOfDuties(input.reviewerId, previousActors)) {
      throw new Error("Separation of duties violation: reviewer previously acted on this application");
    }

    const newStatus = input.decision === "pass" ? "tier2_approved" : "tier2_denied";

    await query(
      `UPDATE applications SET
        status = $2,
        tier2_reviewer_id = $3,
        tier2_decision = $4,
        tier2_notes = $5,
        tier2_decided_at = NOW()
       WHERE id = $1`,
      [input.applicationId, newStatus, input.reviewerId, input.decision, input.notes]
    );

    // Determine if Tier 3 is required (exceptions only)
    const requiresTier3 = this.requiresTier3(app);
    if (input.decision === "pass" && requiresTier3) {
      await query(
        "UPDATE applications SET status = 'tier3_review', tier3_required = true WHERE id = $1",
        [input.applicationId]
      );
    }

    await writeAuditLog({
      action: input.decision === "pass" ? "tier2_approved" : "tier2_denied",
      actorId: input.reviewerId,
      actorRole: input.reviewerRole,
      applicationId: input.applicationId,
      details: {
        decision: input.decision,
        notes: input.notes,
        requiresTier3,
      },
    });

    // FCRA § 1681m: send adverse action notice on human denial (non-blocking)
    if (input.decision === "fail") {
      this.adverseAction
        .sendNotice(
          input.applicationId,
          input.reviewerId,
          input.reviewerRole,
          "tier2_denied",
          `Tier 2 review denial: ${input.notes}`
        )
        .catch((err: Error) =>
          logger.error("Failed to send FCRA adverse action notice after Tier 2 denial", {
            error: err.message,
            applicationId: input.applicationId,
          })
        );
    }

    return {
      applicationId: input.applicationId,
      decision: input.decision,
      status: input.decision === "pass" && requiresTier3 ? "tier3_review" : newStatus,
      requiresTier3,
    };
  }

  /**
   * Tier 3: Asset Manager final sign-off (exceptions only).
   */
  async tier3Review(input: ApprovalInput): Promise<any> {
    const app = await this.getApplication(input.applicationId);

    if (!["tier2_approved", "tier3_review"].includes(app.status)) {
      throw new Error(`Application not ready for Tier 3 review (status: ${app.status})`);
    }

    // Separation of duties
    const previousActors = [app.submitted_by, app.tier1_reviewer_id, app.tier2_reviewer_id].filter(Boolean);
    if (!enforceSeparationOfDuties(input.reviewerId, previousActors)) {
      throw new Error("Separation of duties violation: reviewer previously acted on this application");
    }

    const newStatus = input.decision === "pass" ? "tier3_approved" : "tier3_denied";

    await query(
      `UPDATE applications SET
        status = $2,
        tier3_reviewer_id = $3,
        tier3_decision = $4,
        tier3_notes = $5,
        tier3_decided_at = NOW()
       WHERE id = $1`,
      [input.applicationId, newStatus, input.reviewerId, input.decision, input.notes]
    );

    await writeAuditLog({
      action: input.decision === "pass" ? "tier3_approved" : "tier3_denied",
      actorId: input.reviewerId,
      actorRole: input.reviewerRole,
      applicationId: input.applicationId,
      details: { decision: input.decision, notes: input.notes },
    });

    // FCRA § 1681m: send adverse action notice on human denial (non-blocking)
    if (input.decision === "fail") {
      this.adverseAction
        .sendNotice(
          input.applicationId,
          input.reviewerId,
          input.reviewerRole,
          "tier3_denied",
          `Tier 3 review denial: ${input.notes}`
        )
        .catch((err: Error) =>
          logger.error("Failed to send FCRA adverse action notice after Tier 3 denial", {
            error: err.message,
            applicationId: input.applicationId,
          })
        );
    }

    return {
      applicationId: input.applicationId,
      decision: input.decision,
      status: newStatus,
    };
  }

  /**
   * Get the current approval status and next required action.
   */
  async getApprovalStatus(applicationId: string): Promise<any> {
    const app = await this.getApplication(applicationId);
    const fraudFlags = await this.fraudDetection.getUnresolvedFlags(applicationId);

    return {
      applicationId,
      currentStatus: app.status,
      tier1: {
        reviewerId: app.tier1_reviewer_id,
        decision: app.tier1_decision,
        notes: app.tier1_notes,
        decidedAt: app.tier1_decided_at,
      },
      tier2: {
        required: app.tier2_required,
        reviewerId: app.tier2_reviewer_id,
        decision: app.tier2_decision,
        notes: app.tier2_notes,
        decidedAt: app.tier2_decided_at,
      },
      tier3: {
        required: app.tier3_required,
        reviewerId: app.tier3_reviewer_id,
        decision: app.tier3_decision,
        notes: app.tier3_notes,
        decidedAt: app.tier3_decided_at,
      },
      unresolvedFraudFlags: fraudFlags.length,
      nextAction: this.getNextAction(app),
    };
  }

  private requiresTier2(app: any): boolean {
    // Tier 2 required if: lease exceeds rent threshold OR screening had review_required items
    const rentAmount = parseFloat(app.requested_rent_amount || "0");
    const hasExceptions =
      app.background_check_result === "review_required" ||
      app.credit_check_result === "review_required" ||
      app.compliance_check_result === "review_required";
    return rentAmount > TIER2_RENT_THRESHOLD || hasExceptions;
  }

  private requiresTier3(app: any): boolean {
    // Tier 3 only for exceptions
    return (
      app.background_check_result === "review_required" ||
      app.credit_check_result === "review_required" ||
      app.compliance_check_result === "review_required"
    );
  }

  private getNextAction(app: any): string {
    switch (app.status) {
      case "draft": return "Submit application";
      case "submitted": return "Initiate screening";
      case "screening": return "Awaiting screening results";
      case "screening_passed": return "Tier 1: Senior Manager review";
      case "screening_failed": return "Application denied — notify applicant";
      case "tier1_review": return "Tier 1: Senior Manager review";
      case "tier1_approved": return app.tier2_required ? "Tier 2: Regional Manager review" : "Generate lease";
      case "tier1_denied": return "Application denied — notify applicant";
      case "tier2_review": return "Tier 2: Regional Manager review";
      case "tier2_approved": return app.tier3_required ? "Tier 3: Asset Manager review" : "Generate lease";
      case "tier2_denied": return "Application denied — escalation available";
      case "tier3_review": return "Tier 3: Asset Manager final review";
      case "tier3_approved": return "Generate lease";
      case "tier3_denied": return "Application denied — final";
      case "lease_generated": return "Set up payment and onboard tenant";
      case "onboarded": return "Complete";
      default: return "Unknown";
    }
  }

  private async getApplication(applicationId: string): Promise<any> {
    const result = await query("SELECT * FROM applications WHERE id = $1", [applicationId]);
    if (result.rows.length === 0) {
      throw new Error("Application not found");
    }
    return result.rows[0];
  }
}
