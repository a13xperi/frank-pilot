import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";

/**
 * DocuSign Integration Stub.
 *
 * Used for:
 * - Sending lease + TOS envelopes for tenant e-signature (BP-11)
 * - Webhook callbacks when envelope completes
 * - Fetching executed PDF for storage
 *
 * Frank-approved per the Process Spec; awaiting credentials (account ID,
 * integration key, RSA keypair for JWT auth) — see
 * docs/onboarding/frank-credentials-request.md Section 7.
 *
 * Stub pattern matches loft.ts / onesite.ts: env-gated, stub fallback when
 * key absent, throws on production path until credentialed.
 */
export class DocuSignService {
  private apiUrl: string;
  private accountId: string;
  private integrationKey: string;
  private userId: string;
  private privateKey: string;

  constructor() {
    this.apiUrl = process.env.DOCUSIGN_API_URL || "https://demo.docusign.net/restapi";
    this.accountId = process.env.DOCUSIGN_ACCOUNT_ID || "";
    this.integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY || "";
    this.userId = process.env.DOCUSIGN_USER_ID || "";
    this.privateKey = process.env.DOCUSIGN_PRIVATE_KEY || "";
  }

  private isStub(): boolean {
    return (
      !this.integrationKey ||
      this.integrationKey === "changeme" ||
      !this.privateKey ||
      this.privateKey === "changeme"
    );
  }

  /**
   * Send a lease + TOS envelope to the tenant for e-signature.
   */
  async sendLeaseEnvelope(input: {
    applicationId: string;
    tenantFirstName: string;
    tenantLastName: string;
    tenantEmail: string;
    leasePdfUrl: string;
    tosPdfUrl: string;
    actorId: string;
    actorRole: string;
  }): Promise<{ envelopeId: string; status: "sent" }> {
    logger.info("Sending DocuSign envelope", {
      applicationId: input.applicationId,
      tenant: `${input.tenantFirstName} ${input.tenantLastName}`,
    });

    if (this.isStub()) {
      const stubEnvelopeId = `ds_${Date.now()}`;
      logger.warn("Using stub DocuSign envelope send");

      await query(
        "UPDATE applications SET docusign_envelope_id = $2, status = 'lease_sent_for_signature' WHERE id = $1",
        [input.applicationId, stubEnvelopeId]
      );

      await writeAuditLog({
        action: "lease_sent_for_signature",
        actorId: input.actorId,
        actorRole: input.actorRole,
        applicationId: input.applicationId,
        details: {
          envelopeId: stubEnvelopeId,
          tenantEmail: input.tenantEmail,
          stub: true,
        },
      });

      return { envelopeId: stubEnvelopeId, status: "sent" };
    }

    throw new Error("DocuSign production API not yet configured");
  }

  /**
   * Handle a DocuSign Connect webhook callback (envelope completion event).
   * Verifies HMAC signature, updates application status, triggers PDF fetch.
   */
  async handleWebhook(input: {
    envelopeId: string;
    event: "envelope-completed" | "envelope-declined" | "envelope-voided" | string;
    signedAt?: string;
  }): Promise<{ acknowledged: boolean }> {
    logger.info("DocuSign webhook received", {
      envelopeId: input.envelopeId,
      event: input.event,
    });

    if (this.isStub()) {
      logger.warn("Using stub DocuSign webhook handler");
      return { acknowledged: true };
    }

    throw new Error("DocuSign production webhook handler not yet configured");
  }

  /**
   * Fetch the fully-executed PDF from DocuSign and return a storage URL.
   */
  async fetchExecutedPdf(input: {
    envelopeId: string;
  }): Promise<{ pdfUrl: string }> {
    logger.info("Fetching executed DocuSign PDF", { envelopeId: input.envelopeId });

    if (this.isStub()) {
      logger.warn("Using stub DocuSign PDF fetch");
      return { pdfUrl: `https://docusign.example.com/envelopes/${input.envelopeId}/executed.pdf` };
    }

    throw new Error("DocuSign production PDF fetch not yet configured");
  }
}
