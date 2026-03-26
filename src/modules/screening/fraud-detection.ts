import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { writeAuditLog } from "../../middleware/audit";
import { PoolClient } from "pg";

interface FraudFlagInput {
  applicationId: string;
  flagType: string;
  description: string;
  severity: string;
}

interface AddressInput {
  addressLine1: string;
  city?: string;
  state?: string;
  zip?: string;
}

export class FraudDetectionService {
  /**
   * Check for duplicate SSN across all applications.
   */
  async checkDuplicateSSN(ssnHash: string): Promise<{
    isDuplicate: boolean;
    existingApplicationIds: string[];
  }> {
    const result = await query(
      "SELECT id FROM applications WHERE ssn_hash = $1 AND status NOT IN ('cancelled')",
      [ssnHash]
    );

    return {
      isDuplicate: result.rows.length > 0,
      existingApplicationIds: result.rows.map((r) => r.id),
    };
  }

  /**
   * Check address against known problem addresses.
   */
  async checkAddressFraud(
    client: PoolClient,
    applicationId: string,
    address: AddressInput
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT id, reason FROM known_problem_addresses
       WHERE LOWER(address_line1) = LOWER($1)
       AND ($2::varchar IS NULL OR LOWER(city) = LOWER($2))
       AND ($3::varchar IS NULL OR state = $3)`,
      [address.addressLine1, address.city || null, address.state || null]
    );

    if (result.rows.length > 0) {
      await this.raiseFraudFlag(client, {
        applicationId,
        flagType: "address_fraud",
        description: `Address matches known problem address: ${result.rows[0].reason}`,
        severity: "high",
      });
      return true;
    }

    return false;
  }

  /**
   * Check for income verification mismatches.
   */
  async checkIncomeMismatch(
    applicationId: string,
    reportedIncome: number,
    verifiedIncome: number
  ): Promise<boolean> {
    const discrepancy = Math.abs(reportedIncome - verifiedIncome) / reportedIncome;

    if (discrepancy > 0.15) {
      // >15% discrepancy
      await query(
        `INSERT INTO fraud_flags (application_id, flag_type, description, severity)
         VALUES ($1, 'income_mismatch', $2, $3)`,
        [
          applicationId,
          `Reported income: $${reportedIncome}, Verified: $${verifiedIncome} (${(discrepancy * 100).toFixed(1)}% discrepancy)`,
          discrepancy > 0.3 ? "high" : "medium",
        ]
      );

      await writeAuditLog({
        action: "fraud_flag_raised",
        applicationId,
        resourceType: "fraud_flag",
        details: {
          flagType: "income_mismatch",
          discrepancyPercent: (discrepancy * 100).toFixed(1),
        },
      });

      return true;
    }

    return false;
  }

  /**
   * Check for unusually fast approval speed.
   */
  async checkApprovalSpeed(applicationId: string): Promise<boolean> {
    const result = await query(
      `SELECT submitted_at, tier1_decided_at,
              EXTRACT(EPOCH FROM (tier1_decided_at - submitted_at)) / 60 as minutes_to_approve
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (result.rows.length === 0) return false;

    const minutesToApprove = result.rows[0].minutes_to_approve;

    // Flag if approved in under 5 minutes (anomaly)
    if (minutesToApprove !== null && minutesToApprove < 5) {
      await query(
        `INSERT INTO fraud_flags (application_id, flag_type, description, severity)
         VALUES ($1, 'unusual_approval_speed', $2, 'medium')`,
        [applicationId, `Application approved in ${minutesToApprove.toFixed(1)} minutes`]
      );

      await writeAuditLog({
        action: "fraud_flag_raised",
        applicationId,
        resourceType: "fraud_flag",
        details: {
          flagType: "unusual_approval_speed",
          minutesToApprove: minutesToApprove.toFixed(1),
        },
      });

      return true;
    }

    return false;
  }

  /**
   * Get all unresolved fraud flags for an application.
   */
  async getUnresolvedFlags(applicationId: string): Promise<any[]> {
    const result = await query(
      "SELECT * FROM fraud_flags WHERE application_id = $1 AND resolved = false ORDER BY created_at DESC",
      [applicationId]
    );
    return result.rows;
  }

  /**
   * Resolve a fraud flag.
   */
  async resolveFlag(
    flagId: string,
    resolvedBy: string,
    notes: string
  ): Promise<any> {
    const result = await query(
      `UPDATE fraud_flags
       SET resolved = true, resolved_by = $2, resolved_at = NOW(), resolution_notes = $3
       WHERE id = $1
       RETURNING *`,
      [flagId, resolvedBy, notes]
    );
    return result.rows[0];
  }

  /**
   * Raise a fraud flag (used by other services).
   */
  async raiseFraudFlag(client: PoolClient, input: FraudFlagInput): Promise<void> {
    await client.query(
      `INSERT INTO fraud_flags (application_id, flag_type, description, severity)
       VALUES ($1, $2, $3, $4)`,
      [input.applicationId, input.flagType, input.description, input.severity]
    );

    logger.warn("Fraud flag raised", {
      applicationId: input.applicationId,
      flagType: input.flagType,
      severity: input.severity,
    });
  }
}
