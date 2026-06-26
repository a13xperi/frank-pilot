import { createHash } from "crypto";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { OneSiteService } from "../integrations/onesite";
import { LoftService } from "../integrations/loft";
import { TwilioService } from "../integrations/twilio";
import { RecertificationService } from "../recertification/service";
import { stampV2LeaseExecuted } from "../tape/v2-stamp";

/** Build the canonical OneSite lease document URL from its lease id. Stub mode
 *  returns this same shape (see OneSiteService.generateLease). */
function onesiteDocumentUrl(onesiteLeaseId: string | null): string | null {
  if (!onesiteLeaseId) return null;
  // Demo override: OneSite is a stub (onesite.example.com does not serve a real
  // PDF), so for local walkthroughs point the viewer at a same-origin sample
  // doc that actually embeds. Unset in real envs → canonical OneSite URL.
  if (process.env.DEMO_LEASE_PDF_URL) return process.env.DEMO_LEASE_PDF_URL;
  return `https://onesite.example.com/leases/${onesiteLeaseId}`;
}

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
  private recertification = new RecertificationService();

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
              requested_lease_term_months, requested_rent_amount, requested_move_in_date,
              income_verified
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

    // LIHTC §42: income must be verified through third-party sources before lease execution
    if (!app.income_verified) {
      throw new Error(
        "Income verification required before generating lease (LIHTC §42). Use PATCH /applications/:id/verify-income to complete verification."
      );
    }

    if (!app.requested_rent_amount) {
      throw new Error("Application is missing requested rent amount");
    }

    // CAS-claim the lease generation (audit #5): flip tier*_approved →
    // lease_generated BEFORE the OneSite call, so a double-click / retry / bulk
    // overlap can't mint TWO OneSite leases for one applicant. Only the caller
    // that wins the CAS proceeds; the rest bail. (Also fixes the bug that this
    // method never advanced the status, so listReadyForLease kept re-firing it.)
    const claim = await query(
      `UPDATE applications SET status = 'lease_generated'
        WHERE id = $1 AND status::text = ANY($2::text[])
        RETURNING id`,
      [applicationId, ["tier1_approved", "tier2_approved", "tier3_approved"]]
    );
    if (claim.rowCount === 0) {
      throw new Error(
        `Lease generation already claimed for application ${applicationId} (status moved); not minting a duplicate.`
      );
    }

    let leaseResult: { leaseId: string; documentUrl: string };
    try {
      leaseResult = await this.oneSite.generateLease({
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
    } catch (err) {
      // OneSite failed AFTER we claimed — release the claim so it's retriable,
      // instead of stranding the app in lease_generated with no onesite_lease_id.
      await query(
        `UPDATE applications SET status = $2 WHERE id = $1 AND status = 'lease_generated'`,
        [applicationId, app.status]
      );
      throw err;
    }

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
   * List applications READY for lease generation: fully approved at their required
   * tier AND income-verified (LIHTC §42). This is exactly the candidate set a bulk
   * lease-gen would act on — read-only, so an operator can review before firing.
   */
  async listReadyForLease(): Promise<
    Array<{
      applicationId: string;
      status: string;
      tenantName: string;
      propertyId: string | null;
      unitNumber: string | null;
      requestedRent: string | null;
    }>
  > {
    const result = await query(
      `SELECT id, status, first_name, last_name, property_id, unit_number, requested_rent_amount
         FROM applications
        WHERE status IN ('tier1_approved', 'tier2_approved', 'tier3_approved')
          AND income_verified = true
        ORDER BY tier1_decided_at ASC NULLS LAST`,
      []
    );
    return result.rows.map((r: any) => ({
      applicationId: r.id,
      status: r.status,
      tenantName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
      propertyId: r.property_id,
      unitNumber: r.unit_number,
      requestedRent: r.requested_rent_amount,
    }));
  }

  /**
   * Bulk lease generation: generate leases for many approved + income-verified
   * applications in one operator-triggered call, to relieve the manual one-by-one
   * bottleneck during a lease-up sprint.
   *
   * A LOOP over the verified single-app generateLease — every application still
   * passes the approved-status gate AND the LIHTC §42 income-verification gate;
   * nothing is bypassed. Idempotent: an already-generated application has moved
   * past the approvable status, so it surfaces as a per-app error and is skipped,
   * never double-generated. A failure on one application does not abort the batch.
   * Sequential by design; flag-gated at the route.
   */
  async bulkGenerate(
    applicationIds: string[],
    actorId: string,
    actorRole: string
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
      applicationId: string;
      ok: boolean;
      leaseId?: string;
      documentUrl?: string;
      error?: string;
    }>;
  }> {
    const results: Array<{
      applicationId: string;
      ok: boolean;
      leaseId?: string;
      documentUrl?: string;
      error?: string;
    }> = [];

    for (const applicationId of applicationIds) {
      try {
        const r = await this.generateLease(applicationId, actorId, actorRole);
        results.push({ applicationId, ok: true, leaseId: r.leaseId, documentUrl: r.documentUrl });
      } catch (err) {
        results.push({ applicationId, ok: false, error: (err as Error).message });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;

    await writeAuditLog({
      action: "bulk_lease_generated",
      actorId,
      actorRole,
      details: { total: applicationIds.length, succeeded, failed, applicationIds },
    });

    logger.info("Bulk lease generation completed", {
      total: applicationIds.length,
      succeeded,
      failed,
    });

    return { total: applicationIds.length, succeeded, failed, results };
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

    if (app.status !== "lease_signed") {
      throw new Error(
        `Application must be in lease_signed status to complete onboarding. Current status: ${app.status}`
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

    // Update status to onboarded, set lease dates + security deposit
    const termMonths = app.requested_lease_term_months || 12;
    const rentAmount = parseFloat(app.requested_rent_amount || "0");
    await query(
      `UPDATE applications SET status = 'onboarded', loft_tenant_id = $2,
         lease_start_date = CURRENT_DATE,
         lease_end_date = CURRENT_DATE + ($3 || ' months')::INTERVAL,
         security_deposit_amount = $4
       WHERE id = $1`,
      [applicationId, loftResult.loftTenantId, termMonths, rentAmount]
    );

    // Auto-create first annual recertification
    try {
      await this.recertification.createForApplication(applicationId, actorId, actorRole);
    } catch (recertErr) {
      logger.warn("Failed to auto-create recertification (non-blocking)", {
        error: (recertErr as Error).message,
        applicationId,
      });
    }

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
   * Tenant electronically signs their generated lease.
   * Transitions application status: lease_generated → lease_signed.
   *
   * Requires: application in lease_generated status (route layer enforces that
   * the caller owns the application). ESIGN/UETA: `consent` must be true and a
   * typed signature name + signature image are captured. A SHA-256 hash of the
   * canonical signature evidence is stored for tamper-evidence, and the
   * LEASE_EXECUTED compliance-tape stamp is the legally-meaningful audit record.
   *
   * NOTE: stamping the signature into the actual lease PDF is a flagged
   * follow-up — OneSite returns a stub document URL locally, so there is no real
   * PDF to overlay yet. `signed_document_url` records the canonical lease doc.
   */
  async signLease(
    applicationId: string,
    signer: { userId: string; role: string },
    input: {
      signatureName: string;
      signatureImage: string;
      consent: boolean;
      ip?: string | null;
      sessionId?: string;
    }
  ): Promise<{ status: "lease_signed"; signedAt: string; documentUrl: string | null }> {
    if (input.consent !== true) {
      throw new Error("Electronic signature consent is required (ESIGN/UETA).");
    }
    if (!input.signatureName || !input.signatureName.trim()) {
      throw new Error("A signature name is required.");
    }
    if (!input.signatureImage) {
      throw new Error("A signature is required.");
    }

    const appResult = await query(
      `SELECT id, status, onesite_lease_id, first_name, last_name, phone
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appResult.rows[0];

    if (app.status !== "lease_generated") {
      throw new Error(
        `Application must be in lease_generated status to sign. Current status: ${app.status}`
      );
    }

    const signedAt = new Date().toISOString();
    const consentAt = signedAt;
    const signerName = input.signatureName.trim();
    const documentUrl = onesiteDocumentUrl(app.onesite_lease_id || null);

    const documentHash = createHash("sha256")
      .update(
        JSON.stringify({
          applicationId,
          signerId: signer.userId,
          signerName,
          signedAt,
          consentAt,
          onesiteLeaseId: app.onesite_lease_id || null,
        })
      )
      .digest("hex");

    await query(
      `INSERT INTO lease_signatures
         (application_id, signer_user_id, signer_name, signature_image,
          signed_document_url, document_hash, signer_ip, consent_at, signed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (application_id) DO NOTHING`,
      [
        applicationId,
        signer.userId,
        signerName,
        input.signatureImage,
        documentUrl,
        documentHash,
        input.ip || null,
        consentAt,
        signedAt,
      ]
    );

    await query(`UPDATE applications SET status = 'lease_signed' WHERE id = $1`, [applicationId]);

    await writeAuditLog({
      action: "lease_signed",
      actorId: signer.userId,
      actorRole: signer.role,
      applicationId,
      resourceType: "lease",
      resourceId: applicationId,
      details: { signerName, documentHash, consentAt },
    });

    // Legally-meaningful audit record (no-op unless COMPLIANCE_TAPE_V2_ENABLED).
    await stampV2LeaseExecuted({
      applicationId,
      signerId: signer.userId,
      signerName,
      signedAt,
      consentAt,
      signerIp: input.ip || null,
      documentHash,
      sessionId: input.sessionId,
    });

    logger.info("Lease signed by tenant", { applicationId, signerId: signer.userId });

    return { status: "lease_signed", signedAt, documentUrl };
  }

  /**
   * Get current lease and onboarding status for an application, including the
   * signable document URL and the tenant's signature state.
   */
  async getLeaseStatus(applicationId: string): Promise<{
    applicationId: string;
    status: string;
    onesiteLeaseId: string | null;
    loftTenantId: string | null;
    autoPayEnrolled: boolean;
    documentUrl: string | null;
    signed: boolean;
    signedAt: string | null;
    signerName: string | null;
  } | null> {
    const result = await query(
      `SELECT a.id, a.status, a.onesite_lease_id, a.loft_tenant_id, a.auto_pay_enrolled,
              ls.signed_at, ls.signer_name, ls.signed_document_url
       FROM applications a
       LEFT JOIN lease_signatures ls ON ls.application_id = a.id
       WHERE a.id = $1`,
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
      documentUrl: row.signed_document_url || onesiteDocumentUrl(row.onesite_lease_id || null),
      signed: !!row.signed_at,
      signedAt: row.signed_at ? new Date(row.signed_at).toISOString() : null,
      signerName: row.signer_name || null,
    };
  }
}
