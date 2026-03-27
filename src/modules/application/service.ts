import { query, transaction } from "../../config/database";
import { encrypt, hashSSN, maskSSN } from "../../utils/encryption";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { CreateApplicationInput, UpdateApplicationInput } from "./validation";
import { FraudDetectionService } from "../screening/fraud-detection";

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
          status, submitted_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
          'draft', $29
        ) RETURNING id, status, created_at`,
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
        ]
      );

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
      },
    });

    logger.info("Application created", {
      applicationId: result.id,
      propertyId: input.propertyId,
    });

    return result;
  }

  async submit(applicationId: string, submittedBy: string, submitterRole: string): Promise<any> {
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

    return result.rows[0];
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
    app.ssn_masked = maskSSN("***-**-" + app.ssn_hash.substring(0, 4));

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
