import type Stripe from "stripe";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { getStripe, isStripeConfigured } from "../../lib/stripe";
import {
  recordAuthorization,
  FCRA_DISCLOSURE_VERSION,
  METHOD_VOICE_VERBAL_UNVERIFIED,
} from "../screening/consumer-report-consent";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Phase B voice tool: `take_payment` — collect the $35.95 verification fee by
 * CARD, on the call, so the applicant never has to leave the line to open an
 * email and pay (the email-link flow drops the call: they can't talk + pay on
 * one phone — see conv_4601).
 *
 * Frank reads the disclosure, collects card number / expiry / CVC verbally, and
 * fires this. We confirm a Stripe PaymentIntent stamped `type=application_fee`
 * (MOTO — keyed telephone order, so no browser-3DS), and the SAME payment
 * webhook that handles the email-link path flips draft→submitted + runs
 * screening. No duplicate post-payment logic.
 *
 * PCI: card data is keyed straight into Stripe and never stored by us. In LIVE
 * mode this requires Stripe raw-card-data access (PCI SAQ-D) + pausing call
 * recording during card capture — a go-live (G6) gate. Test mode (test cards)
 * needs neither, so this is provable now.
 *
 * SOFT-FAIL: every "no" path returns { ok:false, message } — never throws.
 */

const APPLICATION_FEE_CENTS = 3595; // $35.95

export async function takePaymentHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const applicationId = pickString(parameters, "application_id");
  const cardNumber = digitsOnly(pickString(parameters, "card_number"));
  const expMonth = pickNumber(parameters, "exp_month");
  const expYear = normalizeYear(pickNumber(parameters, "exp_year"));
  const cvc = digitsOnly(pickString(parameters, "cvc"));
  const consentAcknowledged = pickBool(parameters, "consent_acknowledged");

  if (!applicationId) {
    return {
      ok: false,
      message: "I need your application started before I take the fee. Let me get a few details first.",
    };
  }
  if (!cardNumber || cardNumber.length < 13 || !expMonth || !expYear || !cvc) {
    return {
      ok: false,
      message: "I didn't get all the card details. Can you read me the card number, the expiration month and year, and the three-digit code on the back?",
    };
  }
  if (!isStripeConfigured()) {
    logger.error("take_payment Stripe not configured", { conversationId: context.conversationId });
    return {
      ok: false,
      message: "I can't run the card right now, but I've got your information and we'll follow up with the secure link shortly.",
    };
  }

  const appRes = await query(
    `SELECT submitted_by, status FROM applications WHERE id = $1`,
    [applicationId]
  );
  if (appRes.rows.length === 0) {
    return { ok: false, message: "I couldn't find your application yet. Let me finish your details first." };
  }
  const submittedBy = (appRes.rows[0].submitted_by as string) ?? "";

  // FCRA: record consent before the charge so the webhook will run screening.
  // Audit C4: the tool's consent boolean is caller-controlled, so the record
  // is minted UNVERIFIED and anchored to this conversation — the post-call
  // transcript verification upgrades it once the read disclosure + the
  // caller's affirmative are found in the actual turns.
  if (consentAcknowledged) {
    try {
      await recordAuthorization({
        applicationId,
        applicantId: submittedBy || null,
        applicantRole: "applicant",
        disclosureVersion: FCRA_DISCLOSURE_VERSION,
        method: METHOD_VOICE_VERBAL_UNVERIFIED,
        conversationId: context.conversationId,
      });
    } catch (err) {
      logger.error("take_payment consent record failed", {
        conversationId: context.conversationId,
        error: (err as Error).message,
      });
    }
  }

  try {
    const stripe = getStripe();
    // Built as a plain object + asserted: Stripe's discriminated-union typing on
    // payment_method_data.type rejects the inline "card" literal, but it is a
    // valid Stripe payment-method type at runtime.
    const params = {
      amount: APPLICATION_FEE_CENTS,
      currency: "usd",
      payment_method_data: {
        type: "card",
        card: { number: cardNumber, exp_month: expMonth, exp_year: expYear, cvc },
      },
      // Keyed telephone order — flags it MOTO so Stripe doesn't expect browser 3DS.
      payment_method_options: { card: { moto: true } },
      confirm: true,
      // Stamped for the same webhook the email-link path uses → submitted + screening.
      metadata: {
        type: "application_fee",
        applicationId,
        attemptN: "1",
        actorId: submittedBy,
        conversationId: context.conversationId,
      },
    } as unknown as Stripe.PaymentIntentCreateParams;
    const intent = await stripe.paymentIntents.create(params, {
      idempotencyKey: `appfee-phone:${applicationId}`,
    });

    if (intent.status !== "succeeded") {
      logger.warn("take_payment not succeeded", {
        conversationId: context.conversationId,
        status: intent.status,
      });
      return {
        ok: false,
        result: { status: intent.status },
        message: "That didn't go through cleanly. Do you have another card we can try?",
      };
    }

    logger.info("take_payment succeeded", {
      conversationId: context.conversationId,
      intentId: intent.id,
      consent: consentAcknowledged,
    });
    return {
      ok: true,
      result: { payment_intent_id: intent.id, status: intent.status, amount: "$35.95" },
      message:
        "Perfect — that went through, thirty-five ninety-five paid. I'm running your identity, credit, and background now, and results usually come back within a few hours. You're all set; I'll follow up the moment it's done.",
    };
  } catch (err) {
    const msg = (err as Error).message || "";
    logger.error("take_payment charge failed", {
      conversationId: context.conversationId,
      error: msg,
    });
    // Stripe card errors (declined, bad number) come back here — keep it human.
    return {
      ok: false,
      message: "That card didn't go through — it may have been declined or mistyped. Want to try it again or use a different card?",
    };
  }
}

function digitsOnly(s: string | null): string {
  return s ? s.replace(/\D/g, "") : "";
}
function normalizeYear(y: number | null): number | null {
  if (!y) return null;
  return y < 100 ? 2000 + y : y; // "34" → 2034
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
function pickNumber(parameters: Record<string, unknown>, key: string): number | null {
  const v = parameters[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
function pickBool(parameters: Record<string, unknown>, key: string): boolean {
  const v = parameters[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return false;
}

let registered = false;
export function registerTakePaymentHandler(): void {
  if (registered) return;
  registerToolHandler("take_payment", takePaymentHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
