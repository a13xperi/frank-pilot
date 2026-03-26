import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { meetsMinimumRole } from "../../middleware/rbac";
import { logger } from "../../utils/logger";

/**
 * Decision Matrix for Lease Modifications.
 *
 * Rules:
 * - Rent increase >10%     → Regional Manager approval required
 * - Tenant substitution    → Full re-screening
 * - Lease term shortening  → Asset Manager review
 * - Pet policy changes     → Senior Manager approval
 */

interface ModificationRequest {
  applicationId: string;
  modificationType: "rent_increase" | "tenant_substitution" | "lease_term_change" | "pet_policy_change" | "other";
  description: string;
  originalValue?: string;
  requestedValue?: string;
  requestedBy: string;
  requestedByRole: string;
}

const MODIFICATION_RULES: Record<string, {
  requiredRole: string;
  requiresRescreening: boolean;
  description: string;
}> = {
  rent_increase: {
    requiredRole: "regional_manager",
    requiresRescreening: false,
    description: "Rent increase >10% requires Regional Manager approval",
  },
  tenant_substitution: {
    requiredRole: "regional_manager",
    requiresRescreening: true,
    description: "Tenant substitution requires full re-screening and Regional Manager approval",
  },
  lease_term_change: {
    requiredRole: "asset_manager",
    requiresRescreening: false,
    description: "Lease term changes require Asset Manager review",
  },
  pet_policy_change: {
    requiredRole: "senior_manager",
    requiresRescreening: false,
    description: "Pet policy changes require Senior Manager approval",
  },
  other: {
    requiredRole: "senior_manager",
    requiresRescreening: false,
    description: "Other modifications require Senior Manager approval",
  },
};

export class DecisionMatrixService {
  /**
   * Request a lease modification. Automatically determines required approval level.
   */
  async requestModification(input: ModificationRequest): Promise<any> {
    const rule = MODIFICATION_RULES[input.modificationType];
    if (!rule) {
      throw new Error(`Unknown modification type: ${input.modificationType}`);
    }

    // For rent increases, verify if it's actually >10%
    if (input.modificationType === "rent_increase" && input.originalValue && input.requestedValue) {
      const original = parseFloat(input.originalValue);
      const requested = parseFloat(input.requestedValue);
      const increasePercent = ((requested - original) / original) * 100;

      if (increasePercent <= 10) {
        // Under 10% — Senior Manager can approve
        rule.requiredRole = "senior_manager";
      }
    }

    const result = await query(
      `INSERT INTO lease_modifications (
        application_id, modification_type, description,
        original_value, requested_value,
        required_role, rescreening_required, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *`,
      [
        input.applicationId,
        input.modificationType,
        input.description,
        input.originalValue || null,
        input.requestedValue || null,
        rule.requiredRole,
        rule.requiresRescreening,
      ]
    );

    await writeAuditLog({
      action: "lease_modification_requested",
      actorId: input.requestedBy,
      actorRole: input.requestedByRole,
      applicationId: input.applicationId,
      resourceType: "lease_modification",
      resourceId: result.rows[0].id,
      details: {
        modificationType: input.modificationType,
        requiredRole: rule.requiredRole,
        requiresRescreening: rule.requiresRescreening,
      },
    });

    logger.info("Lease modification requested", {
      modificationId: result.rows[0].id,
      applicationId: input.applicationId,
      type: input.modificationType,
      requiredRole: rule.requiredRole,
    });

    return {
      ...result.rows[0],
      rule: rule.description,
    };
  }

  /**
   * Approve or deny a lease modification.
   */
  async decideModification(input: {
    modificationId: string;
    decision: "approve" | "deny";
    notes: string;
    decidedBy: string;
    decidedByRole: string;
  }): Promise<any> {
    const mod = await this.getModification(input.modificationId);

    if (mod.status !== "pending") {
      throw new Error("Modification already decided");
    }

    // Verify the decider has the required role
    if (!meetsMinimumRole(input.decidedByRole, mod.required_role)) {
      throw new Error(
        `Insufficient role: ${input.decidedByRole}. Requires: ${mod.required_role}`
      );
    }

    const updateField = input.decision === "approve" ? "approved" : "denied";
    const result = await query(
      `UPDATE lease_modifications SET
        status = $2,
        ${updateField}_by = $3,
        ${updateField}_at = NOW(),
        decision_notes = $4
       WHERE id = $1
       RETURNING *`,
      [input.modificationId, input.decision === "approve" ? "approved" : "denied", input.decidedBy, input.notes]
    );

    await writeAuditLog({
      action: input.decision === "approve" ? "lease_modification_approved" : "lease_modification_denied",
      actorId: input.decidedBy,
      actorRole: input.decidedByRole,
      applicationId: mod.application_id,
      resourceType: "lease_modification",
      resourceId: input.modificationId,
      details: {
        decision: input.decision,
        modificationType: mod.modification_type,
        notes: input.notes,
      },
    });

    return result.rows[0];
  }

  /**
   * List modifications for an application.
   */
  async listModifications(applicationId: string): Promise<any[]> {
    const result = await query(
      `SELECT * FROM lease_modifications WHERE application_id = $1 ORDER BY created_at DESC`,
      [applicationId]
    );
    return result.rows;
  }

  private async getModification(modificationId: string): Promise<any> {
    const result = await query(
      "SELECT * FROM lease_modifications WHERE id = $1",
      [modificationId]
    );
    if (result.rows.length === 0) throw new Error("Modification not found");
    return result.rows[0];
  }
}
