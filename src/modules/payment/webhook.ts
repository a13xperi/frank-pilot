import { Router, Request, Response } from "express";
import express from "express";
import type Stripe from "stripe";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { getStripe, expectedLivemode } from "../../lib/stripe";
import { stampTape } from "../tape";
import { buildIdempotencyKey, markStatus } from "./idempotency";
import { LedgerService } from "../ledger/service";

/**
 * Stripe webhook receiver.
 *
 * SECURITY-CRITICAL: this router MUST be mounted BEFORE `express.json()` in
 * src/index.ts. Stripe's signature verification operates on the raw request
 * body — any JSON parsing in the chain before us mutates the buffer and breaks
 * the signature check. We mount `express.raw({ type: 'application/json' })`
 * here so the rest of the app keeps its JSON-parsed `req.body` everywhere
 * else.
 *
 * Three layers of idempotency stack here:
 *
 *   1. Stripe-side header idempotency on the originating PaymentIntent.create
 *      call (handled in intents.ts).
 *
 *   2. `stripe_processed_events` table — Stripe retries the same event_id on
 *      delivery timeout; this short-circuits the second delivery with a 200.
 *
 *   3. `payment_idempotency.status` transition — `pending → succeeded|failed`
 *      is gated on `status = 'pending'`, so a second terminal event for the
 *      same intent doesn't double-post to the ledger.
 *
 * Error handling: any throw during dispatch parks the raw payload in
 * `stripe_webhook_dlq` and returns 200. We NEVER 5xx Stripe — they'd just
 * retry the same broken event forever, DLQ-thrashing nothing useful.
 */

const ledgerService = new LedgerService();

interface PaymentIntentMetadata {
  applicationId?: string;
  attemptN?: string;
  actorId?: string;
}

function parseMetadata(intent: Stripe.PaymentIntent): PaymentIntentMetadata {
  const md = (intent.metadata ?? {}) as Record<string, string>;
  return {
    applicationId: md.applicationId,
    attemptN: md.attemptN,
    actorId: md.actorId,
  };
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM stripe_processed_events WHERE event_id = $1 LIMIT 1`,
    [eventId]
  );
  return result.rows.length > 0;
}

async function markProcessed(
  eventId: string,
  eventType: string,
  applicationId: string | null
): Promise<void> {
  await query(
    `INSERT INTO stripe_processed_events (event_id, event_type, application_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType, applicationId]
  );
}

// Soft cap on the number of still-actionable DLQ rows. Stripe will never make
// us 5xx, so a buggy handler under sustained traffic could otherwise grow this
// table without bound. Once the un-exhausted backlog (attempt_count < 5) hits
// the cap we stop inserting NEW rows — existing rows still get their
// attempt_count bumped on retry (ON CONFLICT path), so we never lose track of
// an event we've already parked. This is a pressure-relief valve, not a hard
// limit: it favours keeping Stripe happy (200) over perfectly capturing every
// failure once we're already drowning in them.
const DLQ_ACTIVE_ROW_CAP = 10_000;

async function activeDlqRowCount(): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM stripe_webhook_dlq WHERE attempt_count < 5`,
    []
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function recordDlq(
  event: Stripe.Event,
  rawPayload: unknown,
  err: Error
): Promise<void> {
  try {
    // A new row only adds to the backlog when this event_id isn't already
    // parked. Bumping an existing row's attempt_count is always allowed (it
    // doesn't grow the table), so we only gate the cap on first-time inserts.
    const alreadyParked = await query(
      `SELECT 1 FROM stripe_webhook_dlq WHERE event_id = $1 LIMIT 1`,
      [event.id]
    );

    if (alreadyParked.rows.length === 0) {
      const activeCount = await activeDlqRowCount();
      if (activeCount >= DLQ_ACTIVE_ROW_CAP) {
        logger.warn("Stripe webhook DLQ at capacity — skipping new row", {
          eventId: event.id,
          type: event.type,
          activeCount,
          cap: DLQ_ACTIVE_ROW_CAP,
        });
        return;
      }
    }

    await query(
      `INSERT INTO stripe_webhook_dlq
         (event_id, event_type, raw_payload, error_message)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (event_id) DO UPDATE
         SET attempt_count = stripe_webhook_dlq.attempt_count + 1,
             last_failed_at = NOW(),
             error_message = EXCLUDED.error_message`,
      [event.id, event.type, JSON.stringify(rawPayload), err.message]
    );
  } catch (dlqErr) {
    logger.error("Stripe webhook DLQ insert failed", {
      eventId: event.id,
      error: (dlqErr as Error).message,
    });
  }
}

async function handlePaymentIntentSucceeded(event: Stripe.Event): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const meta = parseMetadata(intent);

  if (!meta.applicationId || !meta.attemptN) {
    logger.warn("payment_intent.succeeded missing metadata", { intentId: intent.id });
    return;
  }

  const idempotencyKey = buildIdempotencyKey(meta.applicationId, Number(meta.attemptN));
  const amountCents = intent.amount_received ?? intent.amount ?? 0;
  const amountDollars = Math.round(amountCents) / 100;
  const currency = intent.currency;

  const ledgerEntry = await ledgerService.recordPayment(
    meta.applicationId,
    amountDollars,
    intent.id,
    "stripe-webhook",
    "system",
    `Stripe PaymentIntent ${intent.id}`
  );

  await markStatus(idempotencyKey, "succeeded");

  void stampTape({
    kind: "BP08_PAYMENT_SUCCEEDED",
    actor: "stripe-webhook",
    sessionId: idempotencyKey,
    payload: {
      applicationId: meta.applicationId,
      paymentIntentId: intent.id,
      amountCents,
      currency,
      ledgerEntryId: ledgerEntry.id,
    },
  });

  await writeAuditLog({
    action: "payment_intent_succeeded",
    actorId: "stripe-webhook",
    actorRole: "system",
    applicationId: meta.applicationId,
    resourceType: "payment_intent",
    resourceId: intent.id,
    details: { amountCents, currency, ledgerEntryId: ledgerEntry.id, idempotencyKey },
  });
}

async function handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const meta = parseMetadata(intent);

  if (!meta.applicationId || !meta.attemptN) {
    logger.warn("payment_intent.payment_failed missing metadata", { intentId: intent.id });
    return;
  }

  const idempotencyKey = buildIdempotencyKey(meta.applicationId, Number(meta.attemptN));
  const failureCode = intent.last_payment_error?.code ?? null;
  const failureMessage = intent.last_payment_error?.message ?? null;

  await markStatus(idempotencyKey, "failed");

  void stampTape({
    kind: "BP08_PAYMENT_FAILED",
    actor: "stripe-webhook",
    sessionId: idempotencyKey,
    payload: {
      applicationId: meta.applicationId,
      paymentIntentId: intent.id,
      failureCode,
      failureMessage,
    },
  });

  await writeAuditLog({
    action: "payment_intent_failed",
    actorId: "stripe-webhook",
    actorRole: "system",
    applicationId: meta.applicationId,
    resourceType: "payment_intent",
    resourceId: intent.id,
    details: { failureCode, failureMessage, idempotencyKey },
  });
}

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event);
      return;
    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event);
      return;
    default:
      logger.info("Stripe webhook event ignored", { type: event.type, id: event.id });
      return;
  }
}

const router = Router();

router.post(
  "/",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response): Promise<void> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    if (!secret || secret === "whsec_changeme") {
      // Treat misconfiguration as the most fail-closed thing possible: refuse
      // to verify, so an attacker can't trick us into accepting an unsigned
      // payload because the secret was empty.
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }

    const sig = req.headers["stripe-signature"];
    if (!sig || Array.isArray(sig)) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
    } catch (err) {
      // Do NOT log the body — could be attacker-controlled. Just the error.
      logger.warn("Stripe webhook signature verification failed", {
        error: (err as Error).message,
      });
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    // Livemode guard: even with a valid signature, a live-mode event arriving
    // at a test-mode deployment (or vice-versa) means the wrong webhook secret
    // / wrong endpoint is wired up. Processing it would post the wrong-mode
    // money to the ledger. Reject with 400 so the misconfiguration surfaces
    // loudly instead of silently corrupting state. We derive the expected mode
    // from the SECRET KEY prefix (sk_live_* ⇒ live) rather than the
    // STRIPE_LIVE_ENABLED flag: the flag is a route/UI on-off switch and stays
    // `true` even in test mode, so a test-mode deployment must still accept the
    // `livemode:false` events its sk_test_ key produces.
    const expectLive = expectedLivemode();
    if (event.livemode !== expectLive) {
      logger.error("Stripe webhook livemode mismatch", {
        eventId: event.id,
        type: event.type,
        eventLivemode: event.livemode,
        expectedLivemode: expectLive,
      });
      res.status(400).json({ error: "Livemode mismatch" });
      return;
    }

    if (await alreadyProcessed(event.id)) {
      logger.info("Stripe webhook duplicate event short-circuited", {
        eventId: event.id,
        type: event.type,
      });
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    let dispatchError: Error | null = null;
    try {
      await dispatch(event);
    } catch (err) {
      dispatchError = err as Error;
      logger.error("Stripe webhook dispatch failed", {
        eventId: event.id,
        type: event.type,
        error: dispatchError.message,
      });
      await recordDlq(event, event, dispatchError);
    }

    if (!dispatchError) {
      const meta = (event.data.object as { metadata?: Record<string, string> }).metadata ?? {};
      await markProcessed(event.id, event.type, meta.applicationId ?? null);
    }

    // Always 200 — see header comment. DLQ is the recovery path, not retry.
    res.status(200).json({ received: true });
  }
);

export default router;
