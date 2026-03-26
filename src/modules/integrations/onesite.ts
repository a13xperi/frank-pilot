import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";

/**
 * OneSite Integration Stub.
 *
 * OneSite is the property management system used for:
 * - Generating lease documents
 * - Storing lease documents in document management
 * - Syncing tenant/unit data
 *
 * In production, replace stub methods with actual API calls.
 */
export class OneSiteService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.ONESITE_API_URL || "https://api.onesite.example.com";
    this.apiKey = process.env.ONESITE_API_KEY || "";
  }

  /**
   * Generate a lease document in OneSite.
   */
  async generateLease(input: {
    applicationId: string;
    propertyId: string;
    unitNumber: string;
    tenantFirstName: string;
    tenantLastName: string;
    leaseTermMonths: number;
    rentAmount: number;
    moveInDate: string;
    actorId: string;
    actorRole: string;
  }): Promise<{ leaseId: string; documentUrl: string }> {
    logger.info("Generating lease in OneSite", {
      applicationId: input.applicationId,
      propertyId: input.propertyId,
    });

    // STUB: Replace with actual OneSite API call
    if (!this.apiKey || this.apiKey === "changeme") {
      const stubLeaseId = `ols_${Date.now()}`;
      logger.warn("Using stub OneSite lease generation");

      await query(
        "UPDATE applications SET onesite_lease_id = $2, status = 'lease_generated' WHERE id = $1",
        [input.applicationId, stubLeaseId]
      );

      await writeAuditLog({
        action: "lease_generated",
        actorId: input.actorId,
        actorRole: input.actorRole,
        applicationId: input.applicationId,
        details: {
          leaseId: stubLeaseId,
          unitNumber: input.unitNumber,
          leaseTermMonths: input.leaseTermMonths,
          rentAmount: input.rentAmount,
          moveInDate: input.moveInDate,
          stub: true,
        },
      });

      return {
        leaseId: stubLeaseId,
        documentUrl: `https://onesite.example.com/leases/${stubLeaseId}`,
      };
    }

    // Production implementation
    throw new Error("OneSite production API not yet configured");
  }

  /**
   * Sync tenant data to OneSite after onboarding.
   */
  async syncTenant(input: {
    applicationId: string;
    onesiteLeaseId: string;
  }): Promise<{ synced: boolean }> {
    logger.info("Syncing tenant to OneSite", { applicationId: input.applicationId });

    if (!this.apiKey || this.apiKey === "changeme") {
      logger.warn("Using stub OneSite tenant sync");
      return { synced: true };
    }

    throw new Error("OneSite production API not yet configured");
  }
}
