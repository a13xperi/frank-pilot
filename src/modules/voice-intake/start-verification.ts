import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { getStripe, isStripeConfigured } from "../../lib/stripe";
import { getEmailService } from "../integrations/email";
import { TwilioService } from "../integrations/twilio";
import {
  recordAuthorization,
  FCRA_DISCLOSURE_VERSION,
} from "../screening/consumer-report-consent";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Phase B voice tool: `start_verification` — the paid-conversion keystone.
 *
 * Once a caller has seen what they qualify for (prequalify) and the real units
 * open to them (present_options) and says they're ready to move forward, Frank
 * fires this. It:
 *   1. records the caller's FCRA consent (verbal, on a recorded line, after
 *      Frank read the background/credit disclosure) — only when
 *      `consent_acknowledged` is true,
 *   2. opens a Stripe Checkout Session for the $35.95 application fee, stamping
 *      the PaymentIntent with `type=application_fee` + the applicationId so the
 *      webhook can route it,
 *   3. hands back a hosted payment URL Frank can text / the portal can open.
 *
 * On payment success, the Stripe webhook (handleApplicationFeeSucceeded) posts
 * the fee to the ledger and — gated on a recorded FCRA authorization — fires the
 * full screening pipeline. So the gate is two-key: fee PAID *and* consent ON
 * FILE before any background/credit pull.
 *
 * SOFT-FAIL discipline (matches the other voice tools): every "no" path returns
 * { ok:false, message } with a spoken line; we never throw at the agent.
 *
 * Returns ToolCallbackResult:
 *   { ok:true, result:{ checkout_url, payment_intent_id, amount:"$35.95" }, message }
 *   { ok:false, message }   // missing app, no consent, Stripe down
 */

const APPLICATION_FEE_CENTS = 3595; // $35.95

export async function startVerificationHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const applicationId = pickString(parameters, "application_id");
  const consentAcknowledged = pickBool(parameters, "consent_acknowledged");
  const providedEmail = pickString(parameters, "email");

  if (!applicationId) {
    logger.warn("start_verification missing application_id", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I need to have your application started before I can take the fee. Let me get a few details first.",
    };
  }

  if (!isStripeConfigured()) {
    logger.error("start_verification Stripe not configured", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I can't take the payment right now, but I've got your information. Someone will follow up with the secure link shortly.",
    };
  }

  // The application must exist; pull the applicant (submitted_by) so the
  // post-payment screening runs under the right actor.
  const appRes = await query(
    `SELECT id, submitted_by, status, email, first_name, phone FROM applications WHERE id = $1`,
    [applicationId]
  );
  if (appRes.rows.length === 0) {
    logger.warn("start_verification unknown application", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I couldn't find your application on file yet. Let me finish getting your details first.",
    };
  }
  const submittedBy = (appRes.rows[0].submitted_by as string) ?? "";
  const rawEmail = (appRes.rows[0].email as string) ?? "";
  const firstName = (appRes.rows[0].first_name as string) ?? undefined;
  // The caller's phone (from the application) — where we text the link for
  // people who have no email. A real E.164 number, not the placeholder.
  const rawPhone = (appRes.rows[0].phone as string) ?? "";
  const applicantPhone = /^\+?\d{10,15}$/.test(rawPhone.replace(/[\s()-]/g, ""))
    ? rawPhone.replace(/[\s()-]/g, "")
    : "";
  // A real, reachable address — not the synth voice-handoff placeholder.
  let deliverableEmail =
    rawEmail && !rawEmail.endsWith("@voice-handoff.invalid") ? rawEmail : "";
  // Frank collects the email at the fee step ("where should I send the link?").
  // Capture it here even if create_application missed it — a valid provided
  // address wins, and we persist it so the receipt + every later notice reach
  // the applicant (this was the gap: the pay link had nowhere to go).
  if (providedEmail && isLikelyEmail(providedEmail) && providedEmail !== deliverableEmail) {
    deliverableEmail = providedEmail;
    try {
      await query(`UPDATE applications SET email = $2 WHERE id = $1`, [
        applicationId,
        providedEmail,
      ]);
    } catch (err) {
      logger.warn("start_verification email persist failed", {
        conversationId: context.conversationId,
        error: (err as Error).message,
      });
    }
  }

  // FCRA gate: only record consent when Frank confirms the caller agreed after
  // hearing the disclosure. Without it the webhook will NOT run screening.
  if (consentAcknowledged) {
    try {
      await recordAuthorization({
        applicationId,
        applicantId: submittedBy || null,
        applicantRole: "applicant",
        disclosureVersion: FCRA_DISCLOSURE_VERSION,
        method: "voice_verbal",
      });
    } catch (err) {
      logger.error("start_verification consent record failed", {
        conversationId: context.conversationId,
        error: (err as Error).message,
      });
    }
  } else {
    logger.info("start_verification without consent ack — screening will hold", {
      conversationId: context.conversationId,
    });
  }

  const portal = process.env.TENANT_PORTAL_URL ?? "https://apply.cdpcnv.org";
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: APPLICATION_FEE_CENTS,
              product_data: {
                name: "Rental application fee",
                description:
                  "Non-refundable. Covers identity, credit, and background verification.",
              },
            },
          },
        ],
        payment_intent_data: {
          metadata: {
            type: "application_fee",
            applicationId,
            actorId: submittedBy,
            conversationId: context.conversationId,
          },
        },
        metadata: { type: "application_fee", applicationId },
        success_url: `${portal}/apply/fee-paid?app=${applicationId}`,
        cancel_url: `${portal}/apply/fee?app=${applicationId}`,
      },
      { idempotencyKey: `appfee:${applicationId}` }
    );

    // Deliver the link by the best available channel(s): EMAIL to whatever
    // address they gave, and/or TEXT to their phone for people who have no email.
    // Only claim a channel when the send actually goes through.
    //   - Email: needs a verified Resend domain to reach non-owner addresses.
    //   - SMS: gated on PAY_LINK_SMS_ENABLED (off until the toll-free number is
    //     A2P-verified; a custom link from an unregistered number bounces 30034).
    let emailed = false;
    if (deliverableEmail && session.url) {
      const res = await getEmailService().sendVerificationFeeLink(deliverableEmail, session.url, {
        firstName,
      });
      emailed = res.sent;
    }

    let texted = false;
    const smsEnabled = process.env.PAY_LINK_SMS_ENABLED === "true";
    if (smsEnabled && applicantPhone && session.url) {
      const body = `${firstName ? firstName + ", here" : "Here"}'s your CDPC Nevada application payment link ($35.95): ${session.url} Reply STOP to opt out.`;
      const sms = await new TwilioService().sendSMS(applicantPhone, body);
      texted = sms.sent;
    }

    logger.info("start_verification checkout created", {
      conversationId: context.conversationId,
      sessionId: session.id,
      consent: consentAcknowledged,
      emailed,
      texted,
    });

    let message: string;
    if (emailed && texted) {
      message = "Perfect. The fee is thirty-five ninety-five, and once it's paid I run your identity, credit, and background, usually back within a few hours. I just emailed and texted you the secure payment link.";
    } else if (emailed) {
      message = "Perfect. The fee is thirty-five ninety-five, and once it's paid I run your identity, credit, and background, usually back within a few hours. I just emailed you the secure payment link, so check your inbox.";
    } else if (texted) {
      message = "Perfect. The fee is thirty-five ninety-five, and once it's paid I run your identity, credit, and background, usually back within a few hours. I just texted you the secure payment link.";
    } else {
      message = "Perfect. The fee is thirty-five ninety-five, and once it's paid I run your identity, credit, and background. What's the best email or mobile number for me to send your secure payment link to?";
    }

    return {
      ok: true,
      result: {
        checkout_url: session.url,
        payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
        amount: "$35.95",
        emailed,
        texted,
      },
      message,
    };
  } catch (err) {
    logger.error("start_verification checkout failed", {
      conversationId: context.conversationId,
      error: (err as Error).message,
    });
    return {
      ok: false,
      message:
        "Sorry, I hit a snag setting up the payment. Let me try that again in a moment.",
    };
  }
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pickBool(parameters: Record<string, unknown>, key: string): boolean {
  const v = parameters[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return false;
}

// Light sanity check — Frank dictates emails from speech ("alex dot e dot peri
// at gmail dot com"), so we only guard against obvious junk, not RFC-perfection.
function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

let registered = false;
export function registerStartVerificationHandler(): void {
  if (registered) return;
  registerToolHandler("start_verification", startVerificationHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
