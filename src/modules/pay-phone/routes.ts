/**
 * On-call DTMF payment routes (Twilio `<Pay>` → Stripe Pay Connector).
 *
 * Flow: Frank transfers the caller to our pay line → Twilio fetches /api/pay/twiml
 * → we return a `<Pay>` verb that charges the $35.95 fee via the Stripe connector
 * → caller keys the card on the dialpad (Twilio scrubs the DTMF, SAQ-A) → Twilio
 * POSTs the outcome to /api/pay/result.
 *
 * Slice 1 (this file): the `<Pay>` TwiML + the action callback that correlates the
 * caller (From) to their application. The post-payment work (ledger + FCRA-gated
 * runFullScreening + draft→submitted) is intentionally NOT wired here yet — that is
 * slice 2, which extracts the shared body of handleApplicationFeeSucceeded
 * (webhook.ts) so the link path and this DTMF path run the exact same code. Until
 * then /result correlates, logs, and acknowledges the caller.
 *
 * DARK: until PAY_DTMF_ENABLED=true, /twiml speaks an "unavailable" line and hangs
 * up, so a mis-routed call degrades to the working email-link path.
 */
import { Router, Request, Response } from "express";
import express from "express";
import { logger } from "../../utils/logger";
import { query } from "../../config/database";
import {
  APPLICATION_FEE_DOLLARS,
  PAY_RESULT_ACTION,
  payDtmfEnabled,
  payStripeConnector,
} from "./config";
import { applyApplicationFeePaid } from "../payment/apply-fee";

const router = Router();
// Twilio posts application/x-www-form-urlencoded; parse it here so this router is
// self-contained regardless of where it mounts relative to express.json().
router.use(express.urlencoded({ extended: false }));

const XML_DECL = `<?xml version="1.0" encoding="UTF-8"?>`;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sayHangup(message: string): string {
  return `${XML_DECL}<Response><Say>${xmlEscape(message)}</Say><Hangup/></Response>`;
}

/**
 * GET/POST /api/pay/twiml — Twilio fetches this when the transferred caller lands
 * on the pay line. Returns the `<Pay>` verb (charge transaction, $35.95) bound to
 * the Stripe Pay Connector. Twilio collects + tokenizes the card (SAQ-A) and POSTs
 * the result to PAY_RESULT_ACTION.
 */
function twimlHandler(_req: Request, res: Response): void {
  res.type("text/xml");
  if (!payDtmfEnabled()) {
    res
      .status(200)
      .send(
        sayHangup(
          "Card payment by phone isn't available right now. We'll text you a secure payment link instead."
        )
      );
    return;
  }
  const connector = xmlEscape(payStripeConnector());
  const twiml =
    `${XML_DECL}<Response>` +
    `<Pay paymentConnector="${connector}" chargeAmount="${APPLICATION_FEE_DOLLARS}" ` +
    `currency="usd" action="${PAY_RESULT_ACTION}" description="Rental application fee">` +
    `</Pay>` +
    `</Response>`;
  res.status(200).send(twiml);
}

router.post("/twiml", twimlHandler);
router.get("/twiml", twimlHandler);

/**
 * POST /api/pay/result — Twilio's `<Pay>` action callback. On a successful charge
 * Twilio sends Result=success plus PaymentConfirmationCode. We correlate the caller
 * (From, E.164) to their application by phone.
 *
 * CORRELATION DEPENDS ON A BLIND TRANSFER. Frank reaches this pay line via the
 * transfer_to_number tool; only a *blind* transfer (native-Twilio) preserves the
 * caller's original caller ID, so `From` here is the applicant's number. A
 * conference transfer would dial the pay line FROM the platform number and `From`
 * would be wrong — the WHERE phone = $1 lookup below would miss. See
 * battlestation/scripts/wire-pay-transfer.sh (TRANSFER_TYPE=blind).
 *
 * On success we call the shared applyApplicationFeePaid() — the exact same
 * post-payment core the Stripe webhook runs (ledger + FCRA-gated runFullScreening
 * + draft→submitted + tape + audit) — passing this applicationId and the
 * PaymentConfirmationCode as the charge ref. dedupeOnRef:true guards against
 * Twilio re-POSTing the action callback (recordPayment does not dedupe).
 */
router.post("/result", async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = String(body.Result ?? body.result ?? "");
  const from = String(body.From ?? body.from ?? "");
  const confirmation = String(body.PaymentConfirmationCode ?? "");

  let applicationId: string | null = null;
  if (from) {
    try {
      const r = await query(`SELECT id FROM applications WHERE phone = $1 LIMIT 1`, [from]);
      applicationId = (r.rows[0]?.id as string) ?? null;
    } catch (err) {
      logger.error("pay/result application lookup failed", {
        from,
        error: (err as Error).message,
      });
    }
  }

  logger.info("pay/result received", {
    result,
    from,
    applicationId,
    hasConfirmation: Boolean(confirmation),
  });

  res.type("text/xml");
  if (result === "success") {
    if (applicationId) {
      try {
        await applyApplicationFeePaid({
          applicationId,
          amountDollars: Number(APPLICATION_FEE_DOLLARS),
          chargeRef: confirmation || `twilio-pay:${from}`,
          source: "twilio-pay",
          notes: `Application fee — Twilio Pay ${confirmation || from}`,
          dedupeOnRef: true,
        });
      } catch (err) {
        // The card was already charged by Twilio/Stripe; a failure to post the
        // ledger/screening must not tell the caller their payment failed. Log
        // loudly for reconciliation and still acknowledge receipt.
        logger.error("pay/result post-payment apply failed", {
          applicationId,
          from,
          error: (err as Error).message,
        });
      }
    } else {
      // Money was taken but we couldn't correlate the caller to an application.
      // Log for manual reconciliation; do not fail the caller.
      logger.error("pay/result success but no application correlated", {
        from,
        hasConfirmation: Boolean(confirmation),
      });
    }
    res
      .status(200)
      .send(
        sayHangup(
          "Thank you. Your thirty-five ninety-five application fee was received. We'll be in touch shortly."
        )
      );
    return;
  }

  res
    .status(200)
    .send(
      sayHangup(
        "We weren't able to process that payment. We'll text you a secure link instead."
      )
    );
});

export default router;
