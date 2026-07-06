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

  constructor() {
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || "";
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (sid && token && sid !== "changeme") {
      const twilio = require("twilio");
      this.client = twilio(sid, token);
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

  /**
   * Inbound post-call callback handoff (Phase 2): text the caller a link to
   * schedule a callback / book a time after they reach the front desk. Returns
   * the sendSMS result so the caller can record the outcome on the tape.
   */
  async notifyCallbackQueued(
    phone: string,
    link: string
  ): Promise<{ sent: boolean; messageId?: string }> {
    return this.sendSMS(
      phone,
      `Thanks for calling Frank. To schedule a callback or pick a time that works for you, tap here: ${link} — CDPC Nevada`
    );
  }
}
