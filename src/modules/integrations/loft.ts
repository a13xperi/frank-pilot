import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";

/**
 * Loft Integration Stub.
 *
 * Loft handles:
 * - Payment processing
 * - Auto-pay setup
 * - Rent collection
 * - Tenant portal
 *
 * In production, replace stub methods with actual API calls.
 */
export class LoftService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.LOFT_API_URL || "https://api.loft.example.com";
    this.apiKey = process.env.LOFT_API_KEY || "";
  }

  /**
   * Create tenant in Loft for payment processing.
   */
  async createTenant(input: {
    applicationId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    unitNumber: string;
    rentAmount: number;
    autoPayEnrolled: boolean;
    actorId: string;
    actorRole: string;
  }): Promise<{ loftTenantId: string }> {
    logger.info("Creating tenant in Loft", {
      applicationId: input.applicationId,
    });

    if (!this.apiKey || this.apiKey === "changeme") {
      const stubTenantId = `lft_${Date.now()}`;
      logger.warn("Using stub Loft tenant creation");

      await query(
        "UPDATE applications SET loft_tenant_id = $2 WHERE id = $1",
        [input.applicationId, stubTenantId]
      );

      return { loftTenantId: stubTenantId };
    }

    throw new Error("Loft production API not yet configured");
  }

  /**
   * Set up auto-pay in Loft.
   */
  async setupAutoPay(input: {
    loftTenantId: string;
    paymentMethodToken: string;
    rentAmount: number;
    discountAmount: number;
  }): Promise<{ autoPayId: string }> {
    logger.info("Setting up auto-pay in Loft", { loftTenantId: input.loftTenantId });

    if (!this.apiKey || this.apiKey === "changeme") {
      logger.warn("Using stub Loft auto-pay setup");
      return { autoPayId: `ap_${Date.now()}` };
    }

    throw new Error("Loft production API not yet configured");
  }
}
