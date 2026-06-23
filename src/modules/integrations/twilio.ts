import { logger } from "../../utils/logger";

/**
 * Twilio SMS Notification Service.
 *
 * Sends notifications for:
 * - Application status updates
 * - Approval/denial notifications
 * - Lease ready for signing
 * - Payment confirmation
 */
export class TwilioService {
  private client: any;
  private fromNumber: string;
  private verifyServiceSid: string;

  constructor() {
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || "";
    this.verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID || "";
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (sid && token && sid !== "changeme") {
      const twilio = require("twilio");
      this.client = twilio(sid, token);
    }
  }

  /** True when a Twilio Verify service is wired (account creds + service SID). */
  verifyConfigured(): boolean {
    return Boolean(this.client && this.verifyServiceSid);
  }

  /**
   * Start a Twilio Verify SMS challenge. Twilio generates the one-time code,
   * texts it, and owns the code's TTL + attempt limits server-side — so this
   * path bypasses A2P 10DLC (error 30034) that blocks raw `messages.create`
   * from an unregistered local number. We never see or store the code.
   */
  async startVerification(to: string): Promise<{ sent: boolean }> {
    if (!this.verifyConfigured()) {
      logger.warn("Twilio Verify not configured — code not sent", { to: "[REDACTED]" });
      return { sent: false };
    }
    try {
      const v = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({ to, channel: "sms" });
      logger.info("Verify started", { status: v.status });
      return { sent: v.status === "pending" };
    } catch (err) {
      logger.error("Failed to start Verify", { error: (err as Error).message });
      return { sent: false };
    }
  }

  /**
   * Check a read-back code against the live Verify challenge for this number.
   * `approved` is the only success state. A consumed/expired/absent challenge
   * surfaces as matched:false (Twilio 404s once a verification is gone, which
   * we treat as "no live code"), never as a thrown error to the caller.
   */
  async checkVerification(to: string, code: string): Promise<{ matched: boolean; exhausted?: boolean }> {
    if (!this.verifyConfigured()) {
      logger.warn("Twilio Verify not configured — cannot check code", { to: "[REDACTED]" });
      return { matched: false };
    }
    try {
      const check = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({ to, code });
      return { matched: check.status === "approved" };
    } catch (err: any) {
      // 20404 = no pending verification (consumed/expired); 60202 = max checks.
      const exhausted = err?.code === 60202;
      logger.info("Verify check miss", { code: err?.code, exhausted });
      return { matched: false, exhausted };
    }
  }

  async sendSMS(to: string, message: string): Promise<{ sent: boolean; messageId?: string }> {
    if (!this.client) {
      logger.warn("Twilio not configured — SMS not sent", { to: "[REDACTED]", messagePreview: message.substring(0, 50) });
      return { sent: false };
    }

    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to,
      });

      logger.info("SMS sent", { messageId: result.sid });
      return { sent: true, messageId: result.sid };
    } catch (err) {
      logger.error("Failed to send SMS", { error: (err as Error).message });
      return { sent: false };
    }
  }

  async notifyApplicationSubmitted(phone: string, applicantName: string): Promise<void> {
    await this.sendSMS(
      phone,
      `Hello ${applicantName}, your rental application has been received and is being processed. You will be notified of any updates. — Community Development Programs Center of Nevada`
    );
  }

  async notifyScreeningComplete(phone: string, applicantName: string, passed: boolean): Promise<void> {
    const status = passed ? "passed initial screening" : "requires additional review";
    await this.sendSMS(
      phone,
      `Hello ${applicantName}, your application has ${status}. A representative will follow up with next steps. — CDPC Nevada`
    );
  }

  async notifyApproved(phone: string, applicantName: string): Promise<void> {
    await this.sendSMS(
      phone,
      `Congratulations ${applicantName}! Your rental application has been approved. Please check your email for lease signing instructions. — CDPC Nevada`
    );
  }

  async notifyDenied(phone: string, applicantName: string): Promise<void> {
    await this.sendSMS(
      phone,
      `Hello ${applicantName}, we regret to inform you that your application was not approved at this time. You will receive a detailed explanation via mail per FCRA requirements. — CDPC Nevada`
    );
  }

  async notifyLeaseReady(phone: string, applicantName: string): Promise<void> {
    await this.sendSMS(
      phone,
      `Hello ${applicantName}, your lease is ready for review and signing. Please check your email for the document link. — CDPC Nevada`
    );
  }
}
