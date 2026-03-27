import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { OneSiteService } from "../integrations/onesite";
import { LoftService } from "../integrations/loft";
import { TwilioService } from "../integrations/twilio";

/**
 * Set of application statuses that are eligible for lease generation.
 * An application must have completed all required approval tiers.
 */
const APPROVABLE_STATUSES = new Set([
  "tier1_approved",
  "tier2_approved",
  "tier3_approved",
]);

export class LeaseService {
  private oneSite = new OneSiteService();
  private loft = new LoftService();
  private twilio = new TwilioService();

  /**
   * Generate a lease document in OneSite for an approved application.
   * Transitions application status: tier*_approved → lease_generated.
   *
   * Requires: application in tier1_approved, tier2_approved, or tier3_approved status.
   * lease:generate permission enforced at route layer.
   */
  async generateLease(
    applicationId: string,
    actorId: string,
    actorRole: string
  ): Promise<{ leaseId: string; documentUrl: string }> {
    const appResult = await query(
      `SELECT id, status, property_id, unit_number,
              first_name, last_name, email, phone,
              requested_lease_term_months, requested_rent_amount, requested_move_in_date
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appResult.rows[0];

    if (!APPROVABLE_STATUSES.has(app.status)) {
      throw new Error(
        `Application must be in an approved status to generate a lease. Current status: ${app.status}`
      );
    }

    if (!app.requested_rent_amount) {
      throw new Error("Application is missing requested rent amount");
    }

    const leaseResult = await this.oneSite.generateLease({
      applicationId,
      propertyId: app.property_id,
      unitNumber: app.unit_number || "TBD",
      tenantFirstName: app.first_name,
      tenantLastName: app.last_name,
      leaseTermMonths: app.requested_lease_term_months || 12,
      rentAmount: parseFloat(app.requested_rent_amount),
      moveInDate: app.requested_move_in_date
        ? app.requested_move_in_date.toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
      actorId,
      actorRole,
    });

    await writeAuditLog({
      action: "lease_generated",
      actorId,
      actorRole,
      applicationId,
      resourceType: "lease",
      resourceId: applicationId,
      details: {
        leaseId: leaseResult.leaseId,
        documentUrl: leaseResult.documentUrl,
        previousStatus: app.status,
      },
    });

    // Notify tenant that lease is ready for review (non-blocking — SMS failure is not fatal)
    if (app.phone) {
      this.twilio
        .notifyLeaseReady(app.phone, `${app.first_name} ${app.last_name}`)
        .catch((err: Error) =>
          logger.warn("Lease ready SMS notification failed", { error: err.message, applicationId })
        );
    }

    logger.info("Lease generated", {
      applicationId,
      leaseId: leaseResult.leaseId,
    });

    return leaseResult;
  }

  /**
   * Complete tenant onboarding after lease is signed.
   * Creates tenant in Loft (payment platform), syncs to OneSite,
   * and transitions status: lease_generated → onboarded.
   *
   * Requires: application in lease_generated status with a valid onesite_lease_id.
   */
  async completeOnboarding(
    applicationId: string,
    actorId: string,
    actorRole: string
  ): Promise<{ onboarded: boolean; loftTenantId: string }> {
    const appResult = await query(
      `SELECT id, status, first_name, last_name, email, phone,
              unit_number, requested_rent_amount,
              onesite_lease_id, stripe_payment_method_id, auto_pay_enrolled
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appResult.rows[0];

    if (app.status !== "lease_generated") {
      throw new Error(
        `Application must be in lease_generated status to complete onboarding. Current status: ${app.status}`
      );
    }

    if (!app.onesite_lease_id) {
      throw new Error("Application has no OneSite lease ID — run generateLease first");
    }

    // Create tenant in Loft payment platform
    const loftResult = await this.loft.createTenant({
      applicationId,
      firstName: app.first_name,
      lastName: app.last_name,
      email: app.email || "",
      phone: app.phone,
      unitNumber: app.unit_number || "TBD",
      rentAmount: parseFloat(app.requested_rent_amount || "0"),
      autoPayEnrolled: app.auto_pay_enrolled || false,
      actorId,
      actorRole,
    });

    // Set up auto-pay in Loft if enrolled and payment method is configured
    if (app.auto_pay_enrolled && app.stripe_payment_method_id) {
      await this.loft.setupAutoPay({
        loftTenantId: loftResult.loftTenantId,
        paymentMethodToken: app.stripe_payment_method_id,
        rentAmount: parseFloat(app.requested_rent_amount || "0"),
        discountAmount: 25, // Standard auto-pay discount
      });
    }

    // Sync to OneSite
    await this.oneSite.syncTenant({
      applicationId,
      onesiteLeaseId: app.onesite_lease_id,
    });

    // Update status to onboarded
    await query(
      "UPDATE applications SET status = 'onboarded', loft_tenant_id = $2 WHERE id = $1",
      [applicationId, loftResult.loftTenantId]
    );

    await writeAuditLog({
      action: "tenant_onboarded",
      actorId,
      actorRole,
      applicationId,
      resourceType: "application",
      resourceId: applicationId,
      details: {
        loftTenantId: loftResult.loftTenantId,
        onesiteLeaseId: app.onesite_lease_id,
        autoPayEnrolled: app.auto_pay_enrolled || false,
      },
    });

    // Notify tenant of successful onboarding (non-blocking)
    if (app.phone) {
      this.twilio
        .notifyApproved(app.phone, `${app.first_name} ${app.last_name}`)
        .catch((err: Error) =>
          logger.warn("Onboarding SMS notification failed", { error: err.message, applicationId })
        );
    }

    logger.info("Tenant onboarded", {
      applicationId,
      loftTenantId: loftResult.loftTenantId,
    });

    return { onboarded: true, loftTenantId: loftResult.loftTenantId };
  }

  /**
   * Get current lease and onboarding status for an application.
   */
  async getLeaseStatus(applicationId: string): Promise<{
    applicationId: string;
    status: string;
    onesiteLeaseId: string | null;
    loftTenantId: string | null;
    autoPayEnrolled: boolean;
  } | null> {
    const result = await query(
      `SELECT id, status, onesite_lease_id, loft_tenant_id, auto_pay_enrolled
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      applicationId: row.id,
      status: row.status,
      onesiteLeaseId: row.onesite_lease_id || null,
      loftTenantId: row.loft_tenant_id || null,
      autoPayEnrolled: row.auto_pay_enrolled || false,
    };
  }
}
