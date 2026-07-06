import { query, transaction } from "../../config/database";
import { encrypt, decrypt, hashSSN, maskSSN } from "../../utils/encryption";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { CreateApplicationInput, UpdateApplicationInput } from "./validation";
import { FraudDetectionService } from "../screening/fraud-detection";
import { transitionApplicationStatus } from "../screening/state-machine";

export class ApplicationService {
  private fraudDetection = new FraudDetectionService();

  async create(input: CreateApplicationInput, submittedBy: string, submitterRole: string): Promise<any> {
    const ssnHash = hashSSN(input.ssn.replace(/\D/g, ""));
    const ssnEncrypted = encrypt(input.ssn.replace(/\D/g, ""));
    const dobEncrypted = encrypt(input.dateOfBirth);

    // Check for duplicate SSN (fraud flag)
    const duplicateCheck = await this.fraudDetection.checkDuplicateSSN(ssnHash);

    const result = await transaction(async (client) => {
      const res = await client.query(
        `INSERT INTO applications (
          property_id, unit_number,
          first_name, last_name, ssn_encrypted, ssn_hash, date_of_birth_encrypted,
          email, phone,
          current_address_line1, current_address_line2, current_city, current_state, current_zip,
          employer_name, employer_phone, employment_start_date, annual_income, household_size,
          previous_landlord_name, previous_landlord_phone, previous_rental_address, previous_rental_duration_months,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
          requested_lease_term_months, requested_rent_amount, requested_move_in_date,
          conversation_id,
          status, submitted_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
          $31,
          'draft', $30
        )
        ON CONFLICT (conversation_id) WHERE conversation_id IS NOT NULL DO NOTHING
        RETURNING id, status, created_at`,
        [
          input.propertyId, input.unitNumber || null,
          input.firstName, input.lastName, ssnEncrypted, ssnHash, dobEncrypted,
          input.email || null, input.phone || null,
          input.currentAddressLine1 || null, input.currentAddressLine2 || null,
          input.currentCity || null, input.currentState || null, input.currentZip || null,
          input.employerName || null, input.employerPhone || null,
          input.employmentStartDate || null, input.annualIncome || null, input.householdSize,
          input.previousLandlordName || null, input.previousLandlordPhone || null,
          input.previousRentalAddress || null, input.previousRentalDurationMonths || null,
          input.emergencyContactName || null, input.emergencyContactPhone || null,
          input.emergencyContactRelationship || null,
          input.requestedLeaseTermMonths, input.requestedRentAmount || null,
          input.requestedMoveInDate || null,
          submittedBy,
          input.conversationId || null,
        ]
      );

      // Idempotent replay (audit #3): a redelivered / second create_application
      // for the SAME ElevenLabs conversation hit the partial-UNIQUE on
      // conversation_id, so DO NOTHING returned no row. Return the EXISTING
      // application rather than minting a duplicate (and a second $35.95 charge
      // downstream) — and skip the fraud-flag / address side effects, which
      // already ran on the original create. Only reachable with a non-null
      // conversation_id (the partial index excludes NULLs).
      if (res.rows.length === 0) {
        const existing = await client.query(
          `SELECT id, status, created_at FROM applications WHERE conversation_id = $1`,
          [input.conversationId]
        );
        return { row: existing.rows[0], idempotent: true };
      }

      const applicationId = res.rows[0].id;

      // Raise fraud flag if duplicate SSN found
      if (duplicateCheck.isDuplicate) {
        await this.fraudDetection.raiseFraudFlag(client, {
          applicationId,
          flagType: "duplicate_ssn",
          description: `SSN matches existing application(s): ${duplicateCheck.existingApplicationIds.join(", ")}`,
          severity: "high",
        });
      }

      // Check address against known problem addresses
      if (input.currentAddressLine1) {
        await this.fraudDetection.checkAddressFraud(client, applicationId, {
          addressLine1: input.currentAddressLine1,
          city: input.currentCity,
          state: input.currentState,
          zip: input.currentZip,
        });
      }

      return { row: res.rows[0], idempotent: false };
    });

    // Idempotent replay short-circuit: return the existing application, no
    // second create-audit / duplicate side effect (audit #3).
    if (result.idempotent) {
      logger.info("Application create idempotent hit — existing returned for conversation", {
        applicationId: result.row?.id,
        conversationId: input.conversationId,
      });
      return result.row;
    }

    const created = result.row;

    await writeAuditLog({
      action: "application_created",
      actorId: submittedBy,
      actorRole: submitterRole,
      applicationId: created.id,
      resourceType: "application",
      resourceId: created.id,
      details: {
        propertyId: input.propertyId,
        applicantName: `${input.firstName} ${input.lastName}`,
        ssn: maskSSN(input.ssn),
        hasDuplicateSSN: duplicateCheck.isDuplicate,
      },
    });

    logger.info("Application created", {
      applicationId: created.id,
      propertyId: input.propertyId,
    });

    return created;
  }

  // Fill an existing applicant-self-serve draft (created by /intent or
  // /claim-unit/:id before SSN/DOB are collected) with the form payload from
  // step 2 of /apply. Without this path, /apply would INSERT a second draft
  // and orphan the unit claim sitting on the first one.
  async fillDraft(
    applicationId: string,
    input: CreateApplicationInput,
    submittedBy: string,
    submitterRole: string
  ): Promise<any> {
    const ssnHash = hashSSN(input.ssn.replace(/\D/g, ""));
    const ssnEncrypted = encrypt(input.ssn.replace(/\D/g, ""));
    const dobEncrypted = encrypt(input.dateOfBirth);

    const duplicateCheck = await this.fraudDetection.checkDuplicateSSN(ssnHash);

    const result = await transaction(async (client) => {
      const res = await client.query(
        `UPDATE applications SET
            property_id = $2, unit_number = $3,
            first_name = $4, last_name = $5,
            ssn_encrypted = $6, ssn_hash = $7, date_of_birth_encrypted = $8,
            email = $9, phone = $10,
            current_address_line1 = $11, current_address_line2 = $12,
            current_city = $13, current_state = $14, current_zip = $15,
            employer_name = $16, employer_phone = $17,
            employment_start_date = $18, annual_income = $19, household_size = $20,
            previous_landlord_name = $21, previous_landlord_phone = $22,
            previous_rental_address = $23, previous_rental_duration_months = $24,
            emergency_contact_name = $25, emergency_contact_phone = $26,
            emergency_contact_relationship = $27,
            requested_lease_term_months = $28, requested_rent_amount = $29,
            requested_move_in_date = $30,
            submitted_by = $31,
            conversation_id = $32,
            updated_at = NOW()
          WHERE id = $1 AND status = 'draft'
          RETURNING id, status, created_at`,
        [
          applicationId,
          input.propertyId, input.unitNumber || null,
          input.firstName, input.lastName, ssnEncrypted, ssnHash, dobEncrypted,
          input.email || null, input.phone || null,
          input.currentAddressLine1 || null, input.currentAddressLine2 || null,
          input.currentCity || null, input.currentState || null, input.currentZip || null,
          input.employerName || null, input.employerPhone || null,
          input.employmentStartDate || null, input.annualIncome || null, input.householdSize,
          input.previousLandlordName || null, input.previousLandlordPhone || null,
          input.previousRentalAddress || null, input.previousRentalDurationMonths || null,
          input.emergencyContactName || null, input.emergencyContactPhone || null,
          input.emergencyContactRelationship || null,
          input.requestedLeaseTermMonths, input.requestedRentAmount || null,
          input.requestedMoveInDate || null,
          submittedBy,
          input.conversationId || null,
        ]
      );

      if (res.rows.length === 0) {
        throw new Error("DRAFT_NOT_FOUND");
      }

      if (duplicateCheck.isDuplicate) {
        await this.fraudDetection.raiseFraudFlag(client, {
          applicationId,
          flagType: "duplicate_ssn",
          description: `SSN matches existing application(s): ${duplicateCheck.existingApplicationIds.join(", ")}`,
          severity: "high",
        });
      }

      if (input.currentAddressLine1) {
        await this.fraudDetection.checkAddressFraud(client, applicationId, {
          addressLine1: input.currentAddressLine1,
          city: input.currentCity,
          state: input.currentState,
          zip: input.currentZip,
        });
      }

      return res.rows[0];
    });

    await writeAuditLog({
      action: "application_created",
      actorId: submittedBy,
      actorRole: submitterRole,
      applicationId: result.id,
      resourceType: "application",
      resourceId: result.id,
      details: {
        propertyId: input.propertyId,
        applicantName: `${input.firstName} ${input.lastName}`,
        ssn: maskSSN(input.ssn),
        hasDuplicateSSN: duplicateCheck.isDuplicate,
        filledDraft: true,
      },
    });

    logger.info("Application draft filled", {
      applicationId: result.id,
      propertyId: input.propertyId,
    });

    return result;
  }

  async submit(
    applicationId: string,
    submittedBy: string,
    submitterRole: string,
    returnUrl?: string,
    consumerReportConsent?: {
      authorized: boolean;
      disclosureVersion?: string;
      ip?: string | null;
      userAgent?: string | null;
    }
  ): Promise<any> {
    const result = await query(
      `UPDATE applications
       SET status = 'submitted', submitted_at = NOW(), submitted_by = $2
       WHERE id = $1 AND status = 'draft'
       RETURNING id, status, submitted_at`,
      [applicationId, submittedBy]
    );

    if (result.rows.length === 0) {
      throw new Error("Application not found or not in draft status");
    }

    await writeAuditLog({
      action: "application_submitted",
      actorId: submittedBy,
      actorRole: submitterRole,
      applicationId,
      resourceType: "application",
      resourceId: applicationId,
      details: { status: "submitted" },
    });

    // Phase 4b — Stripe Identity capture on submit, dark behind
    // IDENTITY_VERIFICATION_ENABLED (independent of SCREENING_ON_SUBMIT_ENABLED).
    // When armed: create a Stripe Identity VerificationSession and park the app
    // in `awaiting_identity` until the applicant completes capture and the
    // webhook lands a verdict (which then advances it into screening). The
    // session url/clientSecret is returned so the caller can redirect/embed.
    // This branch takes precedence over the legacy auto-screen path below —
    // screening is kicked by the webhook once identity resolves.
    if (process.env.IDENTITY_VERIFICATION_ENABLED === "true") {
      try {
        const { IdentityVerificationService } = await import(
          "../screening/identity-verification"
        );
        const session = await new IdentityVerificationService().createSession({
          applicationId,
          returnUrl,
        });
        await transitionApplicationStatus({
          applicationId,
          from: "submitted",
          to: "awaiting_identity",
          trigger: "identity_verification_started",
          actorId: submittedBy,
          actorRole: submitterRole,
          evidence: { source: "submit_identity_capture", sessionId: session.id },
        });
        await query(
          `UPDATE applications SET
             identity_session_id = $2,
             identity_session_status = $3,
             identity_session_created_at = NOW()
           WHERE id = $1`,
          [applicationId, session.id, session.status]
        );
        return {
          ...result.rows[0],
          status: "awaiting_identity",
          identity: {
            url: session.url,
            clientSecret: session.clientSecret,
            status: session.status,
          },
        };
      } catch (err) {
        // Session creation failed. Do NOT silently fall through to a normal
        // submit (that would skip the identity gate entirely). Leave the app in
        // `submitted` — staff/poll see no session — and surface loudly. This is
        // fail-loud, not fail-open.
        logger.error("Failed to create Stripe Identity session on submit", {
          error: (err as Error).message,
          applicationId,
        });
        return result.rows[0];
      }
    }

    // Consumer-report CRA capture on submit — dark behind CONSUMER_REPORT_ENABLED
    // (independent of SCREENING_ON_SUBMIT_ENABLED). When armed: create the Checkr
    // background + TransUnion ShareAble credit report orders and park the app in
    // `awaiting_consumer_report` until the applicant authorizes the pulls + passes
    // KBA and the webhook(s) land verdicts (which then advance it into screening).
    // The hosted authorization url(s) are returned so the caller can redirect.
    // This branch sits AFTER the identity gate (identity, if armed, returns first)
    // and BEFORE the legacy auto-screen path — screening is kicked by the webhook
    // once the reports resolve, not synchronously here.
    if (process.env.CONSUMER_REPORT_ENABLED === "true") {
      try {
        // FCRA §1681b — never procure a consumer report without the applicant's
        // authorization. Honor an authorization already on file (idempotent
        // re-submit) or capture a freshly-affirmed consent; otherwise do NOT
        // create any report order. Leave the app in `submitted` and tell the
        // caller consent is required (the route turns this into a 400 + the
        // disclosure to render). Fail-loud: we never pull on an unauthorized app,
        // and we never stamp screening_authorization_at without a real record.
        const {
          getAuthorization,
          recordAuthorization,
          FCRA_DISCLOSURE_VERSION,
        } = await import("../screening/consumer-report-consent");

        let authorizedAt: string;
        if (consumerReportConsent?.authorized === true) {
          // Consent given against a superseded disclosure ⇒ re-prompt (do not
          // record a stale authorization).
          if (
            consumerReportConsent.disclosureVersion &&
            consumerReportConsent.disclosureVersion !== FCRA_DISCLOSURE_VERSION
          ) {
            return { ...result.rows[0], consumerReportConsentRequired: true };
          }
          const rec = await recordAuthorization({
            applicationId,
            applicantId: submittedBy,
            applicantRole: submitterRole,
            disclosureVersion: consumerReportConsent.disclosureVersion,
            ip: consumerReportConsent.ip ?? null,
            userAgent: consumerReportConsent.userAgent ?? null,
          });
          authorizedAt = rec.authorizedAt;
        } else {
          const existing = await getAuthorization(applicationId);
          if (existing && existing.disclosureVersion === FCRA_DISCLOSURE_VERSION) {
            authorizedAt = existing.authorizedAt;
          } else {
            return { ...result.rows[0], consumerReportConsentRequired: true };
          }
        }

        const { BackgroundCheckService } = await import(
          "../screening/background-check"
        );
        const { CreditCheckService } = await import("../screening/credit-check");

        // Atomic readiness preflight. BOTH CRA vendors must be armed before we
        // fire ANY outbound order. Checkr's createReport creates a candidate AND
        // emails the applicant a hosted invitation — a real, billable, applicant-
        // facing side effect — so creating it while the credit order throws (e.g.
        // TransUnion not yet credentialed) would orphan a Checkr order, and every
        // resubmit would orphan another. Refuse loudly here, leaving the app in
        // `submitted`; we never half-arm a partial consumer-report pull.
        const backgroundCheck = new BackgroundCheckService();
        const creditCheck = new CreditCheckService();
        if (!backgroundCheck.isConfigured() || !creditCheck.isConfigured()) {
          logger.error(
            "Consumer-report capture armed but a CRA vendor is not configured — refusing to create partial orders",
            {
              applicationId,
              backgroundConfigured: backgroundCheck.isConfigured(),
              creditConfigured: creditCheck.isConfigured(),
            }
          );
          return result.rows[0];
        }

        // Email comes from the applicant's user record (submitted_by → users) —
        // the same join the CRA webhook uses to resolve the actor. Checkr needs
        // it to create + invite the candidate; the hosted invitation then
        // collects the full SSN/DOB from the applicant directly.
        const appRow = await query(
          `SELECT a.first_name, a.last_name, a.ssn_encrypted, a.date_of_birth_encrypted,
                  a.current_state, u.email
             FROM applications a
             LEFT JOIN users u ON u.id = a.submitted_by
            WHERE a.id = $1`,
          [applicationId]
        );
        const a = appRow.rows[0] || {};
        // PII stays minimal even when handed to the CRA: only the last 4 of SSN.
        const ssnLast4 = a.ssn_encrypted ? decrypt(a.ssn_encrypted).slice(-4) : "";
        const dob = a.date_of_birth_encrypted
          ? decrypt(a.date_of_birth_encrypted)
          : "";

        // Create both report orders. A throw here (e.g. credentialing not yet
        // configured) is fail-loud: we do NOT fall through to a normal submit,
        // which would skip the consumer-report gate. The app stays in `submitted`.
        const [background, credit] = await Promise.all([
          backgroundCheck.createReport({
            applicationId,
            firstName: a.first_name,
            lastName: a.last_name,
            ssnLast4,
            dateOfBirth: dob,
            state: a.current_state || "NV",
            email: a.email,
            returnUrl,
          }),
          creditCheck.createReport({
            applicationId,
            firstName: a.first_name,
            lastName: a.last_name,
            ssnLast4,
            dateOfBirth: dob,
            email: a.email,
            returnUrl,
          }),
        ]);

        await transitionApplicationStatus({
          applicationId,
          from: "submitted",
          to: "awaiting_consumer_report",
          trigger: "consumer_report_started",
          actorId: submittedBy,
          actorRole: submitterRole,
          evidence: {
            source: "submit_consumer_report_capture",
            backgroundReportId: background.reportId,
            creditReportId: credit.reportId,
          },
        });

        // Persist ONLY the report references + categorical statuses + the
        // applicant-authorization timestamp. NEVER charge narratives, tradeline
        // detail, addresses, or full DOB/SSN — those live on the CRA.
        // screening_authorization_at is bound to the ACTUAL authorization record
        // (consumer_report_authorizations), not order-creation time — the pull is
        // provably tied to a captured §1681b authorization.
        await query(
          `UPDATE applications SET
             background_report_id = $2,
             credit_report_id = $3,
             consumer_report_background_status = $4,
             consumer_report_credit_status = $5,
             screening_authorization_at = $6
           WHERE id = $1`,
          [
            applicationId,
            background.reportId,
            credit.reportId,
            background.status,
            credit.status,
            authorizedAt,
          ]
        );

        return {
          ...result.rows[0],
          status: "awaiting_consumer_report",
          consumerReport: {
            background: { url: background.url, status: background.status },
            credit: { url: credit.url, status: credit.status },
          },
        };
      } catch (err) {
        // Report creation failed. Do NOT silently fall through to a normal submit
        // (that would skip the consumer-report gate entirely). Leave the app in
        // `submitted` and surface loudly. Fail-loud, not fail-open.
        logger.error("Failed to create consumer-report orders on submit", {
          error: (err as Error).message,
          applicationId,
        });
        return result.rows[0];
      }
    }

    // Auto-screening on submit — dark-deployed behind SCREENING_ON_SUBMIT_ENABLED.
    // Flag off ⇒ byte-for-byte current behavior (manual /screen only). When on,
    // advance the app into `screening` through the chokepoint and kick the
    // pipeline fire-and-forget. A screening failure leaves the app in
    // `screening` (non-approvable) and never affects the submit response.
    if (process.env.SCREENING_ON_SUBMIT_ENABLED === "true") {
      try {
        await transitionApplicationStatus({
          applicationId,
          from: "submitted",
          to: "screening",
          trigger: "screening_started",
          actorId: submittedBy,
          actorRole: submitterRole,
          evidence: { source: "auto_on_submit" },
        });
        void this.runScreeningSafely(applicationId, submittedBy, submitterRole);
      } catch (err) {
        logger.error("Failed to kick off auto-screening on submit", {
          error: (err as Error).message,
          applicationId,
        });
      }
    }

    return result.rows[0];
  }

  /**
   * Run the full screening pipeline for an auto-submitted application without
   * letting a failure surface to the applicant. Lazy-imports ScreeningService
   * to avoid an application <-> screening import cycle. On any throw the app
   * stays in `screening` (non-approvable) and the error is logged — never a
   * silent pass, never a 500 to the applicant.
   */
  private async runScreeningSafely(
    applicationId: string,
    initiatedBy: string,
    initiatorRole: string
  ): Promise<void> {
    try {
      const { ScreeningService } = await import("../screening/service");
      await new ScreeningService().runFullScreening(
        applicationId,
        initiatedBy,
        initiatorRole
      );
    } catch (err) {
      logger.error("Auto-screening pipeline failed after submit", {
        error: (err as Error).message,
        applicationId,
      });
    }
  }

  async getById(applicationId: string): Promise<any> {
    const result = await query(
      `SELECT a.*, p.name as property_name, p.address_line1 as property_address
       FROM applications a
       JOIN properties p ON a.property_id = p.id
       WHERE a.id = $1`,
      [applicationId]
    );

    if (result.rows.length === 0) return null;

    const app = result.rows[0];
    // Strip encrypted fields from response
    delete app.ssn_encrypted;
    delete app.date_of_birth_encrypted;
    // Applications created without an SSN (e.g. the unit-claim FTU flow) carry a
    // null ssn_hash — leave the masked value null rather than crashing the detail fetch.
    app.ssn_masked = app.ssn_hash
      ? maskSSN("***-**-" + app.ssn_hash.substring(0, 4))
      : null;

    return app;
  }

  async list(filters: {
    propertyId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ applications: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.propertyId) {
      conditions.push(`a.property_id = $${idx++}`);
      params.push(filters.propertyId);
    }
    if (filters.status) {
      conditions.push(`a.status = $${idx++}`);
      params.push(filters.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT a.id, a.first_name, a.last_name, a.email, a.phone, a.status,
                a.submitted_at, a.created_at, a.property_id, a.unit_number,
                a.overall_screening_result, a.requested_rent_amount,
                a.qualifying_ami_tier,
                p.name as property_name
         FROM applications a
         JOIN properties p ON a.property_id = p.id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*) FROM applications a ${where}`,
        params
      ),
    ]);

    return {
      applications: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
    };
  }

  /**
   * Cancel an application.
   *
   * Allowed from any non-terminal status (i.e. not already approved, denied,
   * lease_generated, onboarded, or cancelled). Used when an applicant withdraws
   * or a manager administratively closes the application.
   *
   * Cancelled applications are excluded from duplicate-SSN checks, allowing
   * the same applicant to reapply in the future.
   */
  async cancel(
    applicationId: string,
    actorId: string,
    actorRole: string,
    reason?: string
  ): Promise<any> {
    const CANCELLABLE_STATUSES = [
      "draft",
      "submitted",
      "screening",
      "screening_passed",
      "screening_failed",
      "tier1_review",
      "tier2_review",
      "tier3_review",
    ];

    const result = await query(
      `UPDATE applications
       SET status = 'cancelled'
       WHERE id = $1 AND status = ANY($2::application_status[])
       RETURNING id, status`,
      [applicationId, CANCELLABLE_STATUSES]
    );

    if (result.rows.length === 0) {
      throw new Error(
        "Application not found or cannot be cancelled from its current status"
      );
    }

    await writeAuditLog({
      action: "application_cancelled",
      actorId,
      actorRole,
      applicationId,
      resourceType: "application",
      resourceId: applicationId,
      details: { reason: reason || null },
    });

    logger.info("Application cancelled", { applicationId, actorId, reason });

    return result.rows[0];
  }

  /**
   * Verify applicant income (LIHTC §42 compliance).
   *
   * Must be called by a manager after reviewing third-party income evidence
   * (pay stubs, W-2, employer letter, or HUD-approved verification form)
   * before a lease can be generated.
   *
   * If verifiedIncome is provided and differs from self-reported income,
   * the annual_income field is updated to the verified value before the
   * compliance check runs against AMI limits.
   */
  async verifyIncome(
    applicationId: string,
    actorId: string,
    actorRole: string,
    verifiedIncome?: number
  ): Promise<any> {
    const existing = await query(
      "SELECT id, status, annual_income FROM applications WHERE id = $1",
      [applicationId]
    );

    if (existing.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = existing.rows[0];

    // Only allow verification on active (non-terminal) applications
    const VERIFIABLE_STATUSES = [
      "draft",
      "submitted",
      "screening",
      "screening_passed",
      "screening_failed",
      "tier1_review",
      "tier1_approved",
      "tier2_review",
      "tier2_approved",
      "tier3_review",
      "tier3_approved",
    ];

    if (!VERIFIABLE_STATUSES.includes(app.status)) {
      throw new Error(
        `Income cannot be verified on an application with status: ${app.status}`
      );
    }

    const updates: string[] = [
      "income_verified = true",
      "income_verified_by = $2",
      "income_verified_at = NOW()",
    ];
    const params: unknown[] = [applicationId, actorId];

    if (verifiedIncome !== undefined) {
      updates.push(`annual_income = $${params.length + 1}`);
      params.push(verifiedIncome);
    }

    const result = await query(
      `UPDATE applications SET ${updates.join(", ")}
       WHERE id = $1
       RETURNING id, status, income_verified, annual_income`,
      params
    );

    await writeAuditLog({
      action: "income_verified",
      actorId,
      actorRole,
      applicationId,
      resourceType: "application",
      resourceId: applicationId,
      details: {
        verifiedIncome: verifiedIncome ?? null,
        previousIncome: parseFloat(app.annual_income || "0"),
      },
    });

    logger.info("Income verified", { applicationId, actorId, verifiedIncome });

    return result.rows[0];
  }

  async update(applicationId: string, input: UpdateApplicationInput): Promise<any> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const fieldMap: Record<string, string> = {
      propertyId: "property_id",
      unitNumber: "unit_number",
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      phone: "phone",
      currentAddressLine1: "current_address_line1",
      currentAddressLine2: "current_address_line2",
      currentCity: "current_city",
      currentState: "current_state",
      currentZip: "current_zip",
      employerName: "employer_name",
      employerPhone: "employer_phone",
      employmentStartDate: "employment_start_date",
      annualIncome: "annual_income",
      householdSize: "household_size",
      previousLandlordName: "previous_landlord_name",
      previousLandlordPhone: "previous_landlord_phone",
      previousRentalAddress: "previous_rental_address",
      previousRentalDurationMonths: "previous_rental_duration_months",
      emergencyContactName: "emergency_contact_name",
      emergencyContactPhone: "emergency_contact_phone",
      emergencyContactRelationship: "emergency_contact_relationship",
      requestedLeaseTermMonths: "requested_lease_term_months",
      requestedRentAmount: "requested_rent_amount",
      requestedMoveInDate: "requested_move_in_date",
    };

    for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
      if ((input as any)[jsKey] !== undefined) {
        setClauses.push(`${dbKey} = $${idx++}`);
        params.push((input as any)[jsKey]);
      }
    }

    if (setClauses.length === 0) {
      throw new Error("No fields to update");
    }

    params.push(applicationId);
    const result = await query(
      `UPDATE applications SET ${setClauses.join(", ")} WHERE id = $${idx} AND status = 'draft' RETURNING id, status`,
      params
    );

    if (result.rows.length === 0) {
      throw new Error("Application not found or not in draft status");
    }

    return result.rows[0];
  }
}
