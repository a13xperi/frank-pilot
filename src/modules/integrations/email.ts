import { logger } from "../../utils/logger";

/**
 * Resend Email Service.
 *
 * Primary channel for applicant-facing notifications:
 *   - Magic-link verification (sendMagicLink)
 *   - Application status updates (submitted / approved / denied)
 *
 * Design notes:
 *   - If RESEND_API_KEY is unset, every send is a no-op that logs a WARN.
 *     This lets the rest of the deploy work before Resend is provisioned.
 *   - RESEND_FROM defaults to Resend's verified sandbox sender so the first
 *     demo doesn't require domain verification. Set a verified domain sender
 *     before sending to real applicants in production.
 *   - Templates are inline (no external files) and intentionally small —
 *     one CTA per message, plain-text fallback, terracotta brand color.
 *   - Raw secrets, tokens, or full magic-link URLs are never logged. Only
 *     the Resend message id (returned by their API) is captured.
 */

const BRAND_COLOR = "#C9492A";
const FONT_STACK = "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const COMPANY_NAME = "Community Development Programs Center of Nevada";
const DEFAULT_FROM = "CDPC Nevada <onboarding@resend.dev>";

type ResendLike = {
  emails: {
    send: (args: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
      text: string;
    }) => Promise<{ data?: { id?: string } | null; error?: unknown }>;
  };
};

export interface EmailSendResult {
  sent: boolean;
  messageId?: string;
}

export class EmailService {
  private client: ResendLike | null;
  private fromAddress: string;

  constructor() {
    this.fromAddress = process.env.RESEND_FROM || DEFAULT_FROM;
    const apiKey = process.env.RESEND_API_KEY;

    if (apiKey && apiKey !== "changeme") {
      // Lazy-require so test environments without the dep installed still load.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Resend } = require("resend") as { Resend: new (k: string) => ResendLike };
      this.client = new Resend(apiKey);
    } else {
      this.client = null;
    }
  }

  /**
   * Internal send wrapper — never throws. Returns { sent:false } on any
   * configuration or API failure so callers can fire-and-forget without
   * leaking a branch-specific failure mode.
   */
  private async send(args: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<EmailSendResult> {
    if (!this.client) {
      logger.warn("Resend not configured — email not sent", {
        subject: args.subject,
        // `to` is PII — do not log the address.
        to: "[REDACTED]",
      });
      return { sent: false };
    }

    try {
      const result = await this.client.emails.send({
        from: this.fromAddress,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      });

      if (result.error) {
        logger.error("Resend API error", {
          subject: args.subject,
          error: String((result.error as { message?: string })?.message ?? result.error),
        });
        return { sent: false };
      }

      const messageId = result.data?.id;
      logger.info("Email sent", { subject: args.subject, messageId });
      return { sent: true, messageId };
    } catch (err) {
      logger.error("Failed to send email", {
        subject: args.subject,
        error: (err as Error).message,
      });
      return { sent: false };
    }
  }

  /**
   * Magic-link verification email. The raw token is included once, inside
   * the CTA href, and nowhere else — no token in alt text, no token in
   * preview text, no token in plain-text body besides the URL line itself.
   */
  async sendMagicLink(
    to: string,
    link: string,
    options?: { firstName?: string }
  ): Promise<EmailSendResult> {
    const greeting = options?.firstName ? `Hi ${options.firstName},` : "Hi,";
    const subject = "Your sign-in link for CDPC Nevada";

    const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#FAF8F5;font-family:${FONT_STACK};color:#222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px;">
          <tr><td style="font-size:18px;font-weight:600;color:${BRAND_COLOR};">CDPC Nevada</td></tr>
          <tr><td style="padding-top:24px;font-size:16px;line-height:1.5;">
            <p style="margin:0 0 16px;">${greeting}</p>
            <p style="margin:0 0 16px;">Click the button below to sign in and continue your application. This link expires in 15 minutes.</p>
          </td></tr>
          <tr><td align="center" style="padding:8px 0 24px;">
            <a href="${link}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">Sign in</a>
          </td></tr>
          <tr><td style="font-size:13px;color:#666;line-height:1.5;">
            <p style="margin:0;">Didn't request this? You can safely ignore this email.</p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#999;">${COMPANY_NAME}</p>
      </td></tr>
    </table>
  </body>
</html>`;

    const text = [
      greeting,
      "",
      "Click the link below to sign in and continue your application.",
      "This link expires in 15 minutes.",
      "",
      link,
      "",
      "Didn't request this? You can safely ignore this email.",
      "",
      COMPANY_NAME,
    ].join("\n");

    return this.send({ to, subject, html, text });
  }

  /**
   * The $35.95 verification-fee payment link, emailed after Frank takes the
   * caller through start_verification on a voice call. Email — not SMS — because
   * texting an arbitrary link from the local number is A2P-blocked; email is the
   * reliable channel until 10DLC is registered. The Stripe Checkout URL is the
   * single CTA href.
   */
  async sendVerificationFeeLink(
    to: string,
    payUrl: string,
    options?: { firstName?: string }
  ): Promise<EmailSendResult> {
    const greeting = options?.firstName ? `Hi ${options.firstName},` : "Hi,";
    const subject = "Your application — one step left ($35.95 to verify)";
    const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#FAF8F5;font-family:${FONT_STACK};color:#222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px;">
          <tr><td style="font-size:18px;font-weight:600;color:${BRAND_COLOR};">CDPC Nevada</td></tr>
          <tr><td style="padding-top:24px;font-size:16px;line-height:1.5;">
            <p style="margin:0 0 16px;">${greeting}</p>
            <p style="margin:0 0 16px;">You're almost there. To lock in your application and start verification, complete the one-time <strong>$35.95</strong> fee. It covers your identity, credit, and background checks — results usually come back within a few hours.</p>
          </td></tr>
          <tr><td align="center" style="padding:8px 0 24px;">
            <a href="${payUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">Pay $35.95 &amp; verify</a>
          </td></tr>
          <tr><td style="font-size:13px;color:#666;line-height:1.5;">
            <p style="margin:0;">This fee is non-refundable. Questions? Just reply to this email or call us back.</p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#999;">${COMPANY_NAME}</p>
      </td></tr>
    </table>
  </body>
</html>`;
    const text = [
      greeting,
      "",
      "You're almost there. To lock in your application and start verification,",
      "complete the one-time $35.95 fee (identity, credit, and background checks).",
      "Results usually come back within a few hours.",
      "",
      payUrl,
      "",
      "This fee is non-refundable.",
      "",
      COMPANY_NAME,
    ].join("\n");
    return this.send({ to, subject, html, text });
  }

  async sendApplicationSubmitted(to: string, applicantName: string): Promise<EmailSendResult> {
    const subject = "We received your application";
    const html = templateNotice({
      heading: "Application received",
      body: `Thanks ${escapeHtml(applicantName)}. Your rental application is in our queue and a team member will follow up with any next steps.`,
    });
    const text = [
      `Hello ${applicantName},`,
      "",
      "Thanks for your rental application. We have it in our queue and a team member will follow up with any next steps.",
      "",
      COMPANY_NAME,
    ].join("\n");
    return this.send({ to, subject, html, text });
  }

  async sendApproved(to: string, applicantName: string): Promise<EmailSendResult> {
    const subject = "Your application was approved";
    const html = templateNotice({
      heading: "Application approved",
      body: `Congratulations ${escapeHtml(applicantName)} — your application has been approved. We'll send lease-signing instructions in a separate email.`,
    });
    const text = [
      `Hello ${applicantName},`,
      "",
      "Congratulations — your application has been approved. We'll send lease-signing instructions in a separate email.",
      "",
      COMPANY_NAME,
    ].join("\n");
    return this.send({ to, subject, html, text });
  }

  /**
   * Payment receipt. Fired (fire-and-forget) from the Stripe
   * `payment_intent.succeeded` webhook after the ledger entry posts. The
   * Stripe PaymentIntent id is the customer-facing confirmation number; the
   * hosted Stripe `receipt_url`, when present, is linked as the canonical
   * itemized receipt.
   */
  async sendPaymentReceipt(
    to: string,
    opts: {
      firstName?: string;
      amountCents: number;
      currency: string;
      paymentIntentId: string;
      receiptUrl?: string | null;
      newBalanceCents?: number | null;
      paidAt?: Date;
    }
  ): Promise<EmailSendResult> {
    const greeting = opts.firstName ? `Hi ${opts.firstName},` : "Hi,";
    const amount = formatAmount(opts.amountCents, opts.currency);
    const paidAt = (opts.paidAt ?? new Date()).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const balanceLine =
      opts.newBalanceCents != null
        ? `<p style="margin:0 0 8px;">Remaining balance: <strong>${formatAmount(opts.newBalanceCents, opts.currency)}</strong></p>`
        : "";
    const receiptLine = opts.receiptUrl
      ? `<p style="margin:16px 0 0;"><a href="${opts.receiptUrl}" style="color:${BRAND_COLOR};">View your itemized receipt</a></p>`
      : "";

    const subject = `Payment received — ${amount}`;
    const html = templateNotice({
      heading: "Payment received",
      body: `${greeting}<br/><br/>
        <p style="margin:0 0 8px;">We've received your rent payment. Thank you.</p>
        <p style="margin:0 0 8px;">Amount paid: <strong>${amount}</strong></p>
        <p style="margin:0 0 8px;">Date: ${paidAt}</p>
        <p style="margin:0 0 8px;">Confirmation: ${escapeHtml(opts.paymentIntentId)}</p>
        ${balanceLine}${receiptLine}`,
    });
    const text = [
      greeting,
      "",
      "We've received your rent payment. Thank you.",
      `Amount paid: ${amount}`,
      `Date: ${paidAt}`,
      `Confirmation: ${opts.paymentIntentId}`,
      ...(opts.newBalanceCents != null
        ? [`Remaining balance: ${formatAmount(opts.newBalanceCents, opts.currency)}`]
        : []),
      ...(opts.receiptUrl ? ["", `Itemized receipt: ${opts.receiptUrl}`] : []),
      "",
      COMPANY_NAME,
    ].join("\n");

    return this.send({ to, subject, html, text });
  }

  /**
   * Refund confirmation. Fired (fire-and-forget) from the Stripe
   * `charge.refunded` webhook after the offsetting ledger entry posts.
   */
  async sendRefundConfirmation(
    to: string,
    opts: {
      firstName?: string;
      amountCents: number;
      currency: string;
      refundId: string;
      newBalanceCents?: number | null;
    }
  ): Promise<EmailSendResult> {
    const greeting = opts.firstName ? `Hi ${opts.firstName},` : "Hi,";
    const amount = formatAmount(opts.amountCents, opts.currency);
    const balanceLine =
      opts.newBalanceCents != null
        ? `<p style="margin:0 0 8px;">Updated balance: <strong>${formatAmount(opts.newBalanceCents, opts.currency)}</strong></p>`
        : "";

    const subject = `Refund issued — ${amount}`;
    const html = templateNotice({
      heading: "Refund issued",
      body: `${greeting}<br/><br/>
        <p style="margin:0 0 8px;">We've issued a refund to your original payment method. It may take 5–10 business days to appear.</p>
        <p style="margin:0 0 8px;">Refund amount: <strong>${amount}</strong></p>
        <p style="margin:0 0 8px;">Reference: ${escapeHtml(opts.refundId)}</p>
        ${balanceLine}`,
    });
    const text = [
      greeting,
      "",
      "We've issued a refund to your original payment method. It may take 5–10 business days to appear.",
      `Refund amount: ${amount}`,
      `Reference: ${opts.refundId}`,
      ...(opts.newBalanceCents != null
        ? [`Updated balance: ${formatAmount(opts.newBalanceCents, opts.currency)}`]
        : []),
      "",
      COMPANY_NAME,
    ].join("\n");

    return this.send({ to, subject, html, text });
  }

  async sendDenied(to: string, applicantName: string): Promise<EmailSendResult> {
    const subject = "Update on your application";
    const html = templateNotice({
      heading: "Application update",
      body: `Hello ${escapeHtml(applicantName)}. We were unable to approve your application at this time. You'll receive a detailed adverse-action notice by mail with the specific reasons and your rights under the FCRA.`,
    });
    const text = [
      `Hello ${applicantName},`,
      "",
      "We were unable to approve your application at this time. You'll receive a detailed adverse-action notice by mail with the specific reasons and your rights under the FCRA.",
      "",
      COMPANY_NAME,
    ].join("\n");
    return this.send({ to, subject, html, text });
  }
}

/**
 * Format a minor-unit (cents) integer as a localized currency string, e.g.
 * (123456, "usd") -> "$1,234.56". Falls back to a plain decimal + uppercased
 * code if Intl doesn't recognize the currency.
 */
function formatAmount(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Minimal HTML escaping for user-supplied names rendered in templates. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function templateNotice(opts: { heading: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#FAF8F5;font-family:${FONT_STACK};color:#222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px;">
          <tr><td style="font-size:18px;font-weight:600;color:${BRAND_COLOR};">CDPC Nevada</td></tr>
          <tr><td style="padding-top:16px;font-size:20px;font-weight:600;">${opts.heading}</td></tr>
          <tr><td style="padding-top:16px;font-size:16px;line-height:1.5;">${opts.body}</td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#999;">${COMPANY_NAME}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Lazily-constructed default instance — avoids touching env at import time. */
let defaultInstance: EmailService | null = null;
export function getEmailService(): EmailService {
  if (!defaultInstance) {
    defaultInstance = new EmailService();
  }
  return defaultInstance;
}

/** Test-only: reset the singleton so env-variable changes take effect. */
export function __resetEmailServiceForTests(): void {
  defaultInstance = null;
}
