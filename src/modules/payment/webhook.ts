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
import { getEmailService } from "../integrations/email";

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

interface ApplicantContact {
  email: string;
  firstName: string | null;
}

/**
 * Resolve the applicant's email + first name for a receipt/notice. The
 * `applications` table carries `email`/`first_name` directly (no join). Returns
 * null when the row or email is missing so callers can skip the send cleanly.
 */
async function lookupApplicantContact(
  applicationId: string
): Promise<ApplicantContact | null> {
  const result = await query(
    `SELECT email, first_name FROM applications WHERE id = $1`,
    [applicationId]
  );
  const row = result.rows[0];
  if (!row?.email) return null;
  return { email: row.email as string, firstName: (row.first_name as string) ?? null };
}

/**
 * Stripe's hosted itemized-receipt URL, when the charge happens to be expanded
 * on the event. `payment_intent.succeeded` carries `latest_charge` as a bare id
 * string by default, so this is usually null — the receipt still sends with the
 * PaymentIntent id as the confirmation number. We deliberately do NOT issue a
 * charge-retrieve API call here: the webhook stays lean and failure-free.
 */
function extractReceiptUrl(intent: Stripe.PaymentIntent): string | null {
  const charge = intent.latest_charge;
  if (charge && typeof charge === "object" && "receipt_url" in charge) {
    return (charge as Stripe.Charge).receipt_url ?? null;
  }
  return null;
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
    // System-initiated via the Stripe webhook — no user actor. posted_by is a
    // nullable UUID column, so we pass null; the Stripe identity is preserved
    // in reference_id (intent.id) and the note below.
    null,
    null,
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
    // System-initiated by the Stripe webhook: actor_id is a nullable UUID and
    // actor_role a fixed enum (no "system" member), so the textual actor lives
    // in details rather than those typed columns.
    applicationId: meta.applicationId,
    resourceType: "payment_intent",
    // resource_id is a UUID column; a Stripe `pi_…` id is not — keep it in details.
    details: { actor: "stripe-webhook", amountCents, currency, ledgerEntryId: ledgerEntry.id, idempotencyKey, paymentIntentId: intent.id },
  });

  // Fire-and-forget the tenant receipt (matches the void stampTape style above).
  // EmailService no-ops without RESEND_API_KEY, so this is safe in CI and in the
  // current test-mode prod. `balanceAfter` is the post-payment running balance in
  // dollars (positive = owed, negative = credit).
  void (async () => {
    try {
      const contact = await lookupApplicantContact(meta.applicationId!);
      if (!contact) {
        logger.warn("payment receipt skipped — no applicant email", {
          applicationId: meta.applicationId,
          paymentIntentId: intent.id,
        });
        return;
      }
      await getEmailService().sendPaymentReceipt(contact.email, {
        firstName: contact.firstName ?? undefined,
        amountCents,
        currency,
        paymentIntentId: intent.id,
        receiptUrl: extractReceiptUrl(intent),
        newBalanceCents: Math.round(ledgerEntry.balanceAfter * 100),
      });
    } catch (err) {
      logger.error("payment receipt send failed", {
        applicationId: meta.applicationId,
        paymentIntentId: intent.id,
        error: (err as Error).message,
      });
    }
  })();
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
    // System-initiated by the Stripe webhook — see succeeded path. Textual actor
    // goes in details, not the typed actor_id (uuid) / actor_role (enum) columns.
    applicationId: meta.applicationId,
    resourceType: "payment_intent",
    // resource_id is a UUID column; a Stripe `pi_…` id is not — keep it in details.
    details: { actor: "stripe-webhook", failureCode, failureMessage, idempotencyKey, paymentIntentId: intent.id },
  });
}

/**
 * Resolve the applicationId for a refunded charge: prefer the refund's own
 * metadata (set by our refunds route), else fall back to the originating
 * PaymentIntent via payment_idempotency. Returns null when neither resolves.
 */
async function resolveRefundApplication(
  refund: Stripe.Refund | undefined,
  paymentIntentId: string | null
): Promise<string | null> {
  const fromMeta = refund?.metadata?.applicationId;
  if (fromMeta) return fromMeta;
  if (!paymentIntentId) return null;
  const result = await query(
    `SELECT application_id FROM payment_idempotency
      WHERE payment_intent_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [paymentIntentId]
  );
  return (result.rows[0]?.application_id as string) ?? null;
}

async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);

  // The refund that triggered this event is the newest in the sublist; fall
  // back to the charge's cumulative refunded amount for a dashboard refund
  // where the sublist isn't expanded.
  const latestRefund = charge.refunds?.data?.[0];
  const refundId = latestRefund?.id ?? `${charge.id}:refund`;
  const amountCents = latestRefund?.amount ?? charge.amount_refunded ?? 0;
  const currency = (latestRefund?.currency ?? charge.currency) || "usd";

  if (amountCents <= 0) {
    logger.warn("charge.refunded with zero amount — skipping", { chargeId: charge.id });
    return;
  }

  const applicationId = await resolveRefundApplication(latestRefund, paymentIntentId);
  if (!applicationId) {
    logger.warn("charge.refunded could not resolve application", {
      chargeId: charge.id,
      paymentIntentId,
      refundId,
    });
    return;
  }

  // Per-event dedup is handled upstream by stripe_processed_events (event.id),
  // so each distinct refund posts exactly once.
  const ledgerEntry = await ledgerService.recordRefund(
    applicationId,
    Math.round(amountCents) / 100,
    refundId,
    null,
    null,
    `Refund — Stripe ${refundId}`
  );

  if (paymentIntentId) {
    await query(
      `UPDATE payment_idempotency
          SET refund_id = COALESCE(refund_id, $2),
              refunded_amount_cents = $3,
              refund_status = 'succeeded'
        WHERE payment_intent_id = $1`,
      [paymentIntentId, refundId, Math.round(amountCents)]
    );
  }

  void stampTape({
    kind: "BP08_PAYMENT_REFUNDED",
    actor: "stripe-webhook",
    sessionId: refundId,
    payload: { applicationId, paymentIntentId, refundId, amountCents, currency, ledgerEntryId: ledgerEntry.id },
  });

  await writeAuditLog({
    action: "payment_refunded",
    applicationId,
    resourceType: "payment_intent",
    // resource_id is a UUID column; Stripe `re_`/`pi_` ids are not — details only.
    details: { actor: "stripe-webhook", paymentIntentId, refundId, amountCents, currency, ledgerEntryId: ledgerEntry.id },
  });

  // Fire-and-forget refund confirmation (no-ops without RESEND_API_KEY).
  void (async () => {
    try {
      const contact = await lookupApplicantContact(applicationId);
      if (!contact) return;
      await getEmailService().sendRefundConfirmation(contact.email, {
        firstName: contact.firstName ?? undefined,
        amountCents,
        currency,
        refundId,
        newBalanceCents: Math.round(ledgerEntry.balanceAfter * 100),
      });
    } catch (err) {
      logger.error("refund confirmation send failed", {
        applicationId,
        refundId,
        error: (err as Error).message,
      });
    }
  })();
}

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event);
      return;
    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event);
      return;
    case "charge.refunded":
      await handleChargeRefunded(event);
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
