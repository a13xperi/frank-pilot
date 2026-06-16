import { Router, Request, Response } from "express";
import express from "express";
import { logger } from "../../utils/logger";
import { handleInbound, SmsIntakeDisabledError } from "./service";

/**
 * Twilio inbound-SMS webhook (Phase 1, phone-first Frank).
 *
 * Mount path (see src/index.ts): /api/webhooks/twilio
 *   POST /api/webhooks/twilio/inbound
 *
 * Twilio delivers inbound messages as `application/x-www-form-urlencoded` with
 * `Body` (the text) and `From` (the sender's E.164 number) among other fields.
 * We parse that form locally on this router (express.urlencoded) so the rest of
 * the app keeps its JSON-parsed body everywhere else — Twilio never posts JSON
 * here.
 *
 * The response is TwiML: a `<Response><Message>…</Message></Response>` envelope
 * Twilio reads to send the reply SMS back to the texter.
 *
 * FAIL-CLOSED: 503 while SMS_INTAKE_ENABLED is off. The route is always mounted
 * so a config flip doesn't 404 in-flight deliveries (mirrors the voice webhook
 * pattern), but it refuses to do any work until the flag is on.
 */

const router = Router();

/**
 * Escape the five XML predefined entities so an applicant's reply text (which
 * we never control) can't break out of the TwiML `<Message>` element.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
    message
  )}</Message></Response>`;
}

router.post(
  "/inbound",
  express.urlencoded({ extended: false }),
  async (req: Request, res: Response): Promise<void> => {
    if (process.env.SMS_INTAKE_ENABLED !== "true") {
      res.status(503).json({ error: "SMS intake disabled" });
      return;
    }

    const body = typeof req.body?.Body === "string" ? req.body.Body : "";
    const from = typeof req.body?.From === "string" ? req.body.From : "";

    if (!from) {
      // No sender — can't key a session. Empty TwiML (no reply) so Twilio
      // doesn't surface an error to the texter.
      res.set("Content-Type", "text/xml").status(200).send(twiml(""));
      return;
    }

    try {
      const reply = await handleInbound(from, body);
      res.set("Content-Type", "text/xml").status(200).send(twiml(reply));
    } catch (err) {
      if (err instanceof SmsIntakeDisabledError) {
        res.status(503).json({ error: "SMS intake disabled" });
        return;
      }
      logger.error("SMS intake inbound failed", { error: (err as Error).message });
      // Generic TwiML so the applicant gets a graceful nudge instead of a Twilio
      // error; the failure is logged for triage.
      res
        .set("Content-Type", "text/xml")
        .status(200)
        .send(twiml("Sorry, something went wrong on our end. Please try again shortly."));
    }
  }
);

export default router;
