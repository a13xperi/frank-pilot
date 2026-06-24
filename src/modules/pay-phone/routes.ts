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
 * SLICE 2 (TODO): on success, call the shared applyApplicationFeePaid() that
 * handleApplicationFeeSucceeded will be refactored to expose — ledger + FCRA-gated
 * runFullScreening + draft→submitted — passing this applicationId and the
 * PaymentConfirmationCode as the charge ref.
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
    // slice 2: await applyApplicationFeePaid({ applicationId, amountDollars: 35.95,
    //   ref: confirmation, actorIdFallback: undefined });
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
