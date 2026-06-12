import { Router, Request, Response } from "express";
import express from "express";
import crypto from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { persistConversation, type PostCallPayload } from "./service";
import {
  isOutboundValidationEvent,
  handleOutboundPostCall,
} from "../outbound-validation/outcome";

/**
 * ElevenLabs Conv. AI post-call webhook receiver.
 *
 * SECURITY-CRITICAL: this router MUST be mounted BEFORE `express.json()` in
 * src/index.ts. ElevenLabs computes its HMAC over the raw bytes of the
 * request body (with a leading `<timestamp>.` prefix); any JSON parsing in
 * the chain before us mutates the buffer and breaks signature verification.
 * We mount `express.raw({ type: 'application/json' })` here so the rest of
 * the app keeps its JSON-parsed `req.body` everywhere else.
 *
 * Three layers of idempotency stack here (mirrors the BP-08 Stripe pattern):
 *
 *   1. Timestamp-tolerance check on the signature header — old/replayed
 *      payloads are rejected at the door (30-minute window).
 *
 *   2. `elevenlabs_processed_events` table — ElevenLabs may retry the same
 *      delivery on timeout; the second arrival short-circuits with a 200.
 *
 *   3. `voice_intake_calls.conversation_id` UNIQUE — even if the same call
 *      is delivered under two distinct event ids (eg `post_call_transcription`
 *      then `post_call_audio`), the ON CONFLICT update keeps a single row.
 *
 * Error handling: any throw during dispatch parks the raw payload in
 * `elevenlabs_webhook_dlq` and returns 200. We NEVER 5xx ElevenLabs — they'd
 * just retry the same broken event forever and we'd hit their auto-disable
 * threshold (10 consecutive failures over 7 days).
 */

// 30-minute tolerance for the signed `t=` timestamp. Matches Stripe's default
// and gives ElevenLabs plenty of room for delivery retries while still
// shutting the door on the obvious replay window.
const SIGNATURE_TIMESTAMP_TOLERANCE_SECS = 30 * 60;

// Soft cap on the still-actionable DLQ rows. ElevenLabs will never make us
// 5xx, so a buggy handler under sustained traffic could otherwise grow this
// table without bound. Once the un-exhausted backlog (attempt_count < 5)
// hits the cap we stop inserting NEW rows; existing rows still get their
// attempt_count bumped on retry (ON CONFLICT path), so we never lose track of
// an event we've already parked. Pressure-relief valve, not a hard limit.
const DLQ_ACTIVE_ROW_CAP = 10_000;

// ElevenLabs signs only `post_call_transcription` and `post_call_audio` today.
// `dispatch()` is the single switch where new types get wired.
type ElevenLabsEvent = {
  type: string;
  // Some payloads use `event_timestamp`, others `data.metadata.start_time_unix_secs`.
  // Both are unix seconds.
  event_timestamp?: number;
  data: PostCallPayload;
};

interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

/**
 * Parse `ElevenLabs-Signature: t=<ts>,v0=<sig>[,v0=<sig>...]`.
 * Multiple `v0` entries can appear during key rotation; we accept any match.
 */
function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts = header.split(",").map((p) => p.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    if (k === "t") {
      const n = Number(v);
      if (Number.isFinite(n)) timestamp = n;
    } else if (k === "v0") {
      signatures.push(v);
    }
  }
  if (timestamp == null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * HMAC-SHA256 of `<timestamp>.<raw_body>` keyed with the webhook secret.
 * Returns hex digest.
 */
function computeSignature(secret: string, timestamp: number, rawBody: Buffer): string {
  const h = crypto.createHmac("sha256", secret);
  h.update(`${timestamp}.`);
  h.update(rawBody);
  return h.digest("hex");
}

interface VerifyResult {
  ok: boolean;
  reason?: string;
  event?: ElevenLabsEvent;
}

function verifyAndParse(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  nowSecs: number
): VerifyResult {
  if (!signatureHeader || Array.isArray(signatureHeader)) {
    return { ok: false, reason: "missing-signature" };
  }
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: "malformed-signature" };

  if (Math.abs(nowSecs - parsed.timestamp) > SIGNATURE_TIMESTAMP_TOLERANCE_SECS) {
    return { ok: false, reason: "stale-timestamp" };
  }

  const expected = computeSignature(secret, parsed.timestamp, rawBody);
  const match = parsed.signatures.some((sig) => timingSafeEqualHex(sig, expected));
  if (!match) return { ok: false, reason: "bad-signature" };

  let event: ElevenLabsEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as ElevenLabsEvent;
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!event?.type || !event?.data?.conversation_id) {
    return { ok: false, reason: "missing-fields" };
  }
  return { ok: true, event };
}

/**
 * Synthesize a stable event_id: ElevenLabs payloads don't carry a top-level
 * `id`, so we key off (type + conversation_id + timestamp). Same call
 * re-delivered under the same signature timestamp dedupes; an updated call
 * (different timestamp) is allowed through and ON CONFLICT-merges at the
 * voice_intake_calls level.
 */
function buildEventId(type: string, conversationId: string, ts: number): string {
  return `${type}:${conversationId}:${ts}`;
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM elevenlabs_processed_events WHERE event_id = $1 LIMIT 1`,
    [eventId]
  );
  return result.rows.length > 0;
}

async function markProcessed(
  eventId: string,
  eventType: string,
  conversationId: string
): Promise<void> {
  await query(
    `INSERT INTO elevenlabs_processed_events (event_id, event_type, conversation_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType, conversationId]
  );
}

async function activeDlqRowCount(): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM elevenlabs_webhook_dlq WHERE attempt_count < 5`,
    []
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function recordDlq(
  eventId: string,
  eventType: string,
  rawPayload: unknown,
  err: Error
): Promise<void> {
  try {
    const alreadyParked = await query(
      `SELECT 1 FROM elevenlabs_webhook_dlq WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );

    if (alreadyParked.rows.length === 0) {
      const activeCount = await activeDlqRowCount();
      if (activeCount >= DLQ_ACTIVE_ROW_CAP) {
        logger.warn("ElevenLabs webhook DLQ at capacity — skipping new row", {
          eventId,
          type: eventType,
          activeCount,
          cap: DLQ_ACTIVE_ROW_CAP,
        });
        return;
      }
    }

    await query(
      `INSERT INTO elevenlabs_webhook_dlq
         (event_id, event_type, raw_payload, error_message)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (event_id) DO UPDATE
         SET attempt_count = elevenlabs_webhook_dlq.attempt_count + 1,
             last_failed_at = NOW(),
             error_message = EXCLUDED.error_message`,
      [eventId, eventType, JSON.stringify(rawPayload), err.message]
    );
  } catch (dlqErr) {
    logger.error("ElevenLabs webhook DLQ insert failed", {
      eventId,
      error: (dlqErr as Error).message,
    });
  }
}

async function dispatch(event: ElevenLabsEvent): Promise<void> {
  switch (event.type) {
    case "post_call_transcription":
    case "post_call_audio": {
      // Outbound waitlist-validation calls share this front door (same
      // signature/idempotency/DLQ stack) but are NOT intakes — route them to
      // the outcome mapper and skip voice_intake_calls persistence.
      if (isOutboundValidationEvent(event.data)) {
        await handleOutboundPostCall(event.data);
        void stampTape({
          kind: "OUTBOUND_VALIDATION_CALL_COMPLETED",
          actor: "elevenlabs-webhook",
          sessionId: event.data.conversation_id,
          payload: {
            conversationId: event.data.conversation_id,
            agentId: event.data.agent_id,
            eventType: event.type,
          },
        });
        return;
      }
      if (process.env.VOICE_INTAKE_ENABLED !== "true") {
        // Receiver is open because FRANK_OUTBOUND_ENABLED is on, but intake
        // persistence stays dark while its own flag is off.
        logger.info("ElevenLabs webhook: non-outbound event ignored (voice intake off)", {
          conversationId: event.data.conversation_id,
        });
        return;
      }
      const result = await persistConversation(event.data);
      void stampTape({
        kind: "VOICE_INTAKE_COMPLETED",
        actor: "elevenlabs-webhook",
        sessionId: event.data.conversation_id,
        payload: {
          conversationId: event.data.conversation_id,
          agentId: event.data.agent_id,
          language: result.language,
          callSuccessful: result.callSuccessful,
          consentRecording: result.consentRecording,
          callbackRequested: result.callbackRequested,
          eventType: event.type,
        },
      });
      return;
    }
    default:
      logger.info("ElevenLabs webhook event ignored", { type: event.type });
      return;
  }
}

const router = Router();

router.post(
  "/",
  express.raw({ type: "application/json", limit: "5mb" }),
  async (req: Request, res: Response): Promise<void> => {
    if (
      process.env.VOICE_INTAKE_ENABLED !== "true" &&
      process.env.FRANK_OUTBOUND_ENABLED !== "true"
    ) {
      res.status(503).json({ error: "Voice intake disabled" });
      return;
    }

    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";
    if (!secret || secret === "wsec_changeme") {
      // Fail closed on misconfiguration: refuse to accept an unsigned payload
      // because the secret happens to be empty.
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const sigHeader = req.headers["elevenlabs-signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    const nowSecs = Math.floor(Date.now() / 1000);

    const verified = verifyAndParse(rawBody, sig, secret, nowSecs);
    if (!verified.ok || !verified.event) {
      logger.warn("ElevenLabs webhook rejected", { reason: verified.reason });
      // 400 for any verification failure — never reveal which check failed.
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const event = verified.event;
    const parsedTs = parseSignatureHeader(sig as string)!.timestamp;
    const eventId = buildEventId(event.type, event.data.conversation_id, parsedTs);

    if (await alreadyProcessed(eventId)) {
      logger.info("ElevenLabs webhook duplicate event short-circuited", {
        eventId,
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
      logger.error("ElevenLabs webhook dispatch failed", {
        eventId,
        type: event.type,
        error: dispatchError.message,
      });
      await recordDlq(eventId, event.type, event, dispatchError);
    }

    if (!dispatchError) {
      await markProcessed(eventId, event.type, event.data.conversation_id);
    }

    // Always 200 — see header comment. DLQ is the recovery path, not retry.
    res.status(200).json({ received: true });
  }
);

export default router;

// Exposed for the Vitest harness — lets the spec exercise the parser and HMAC
// path without spinning up Express.
export const __test = {
  parseSignatureHeader,
  computeSignature,
  verifyAndParse,
  buildEventId,
};
