import { query } from "../../config/database";

/**
 * BP-08 Stripe PaymentIntent idempotency store.
 *
 * Two layers stack on top of each other:
 *
 *   1. Stripe header `Idempotency-Key` (handled at PaymentIntent.create call
 *      site) — protects against duplicate Stripe-side charges when the network
 *      retries.
 *
 *   2. Postgres `payment_idempotency` table — protects against the application
 *      doing anything observable twice for the same logical attempt: emitting
 *      two `bp08.payment_intent_created` stamps, returning two distinct
 *      client_secrets to the client, double-posting to the ledger, etc.
 *
 * Key shape: `pi:${applicationId}:${attemptN}`. Per spec §4.1 the client must
 * bump `attemptN` after a terminal status (succeeded/failed) to start a new
 * logical payment — replays with the same key after a terminal status are
 * blocked, not silently re-issued.
 */

export type IdempotencyStatus = "pending" | "succeeded" | "failed";

export interface IdempotencyRow {
  idempotencyKey: string;
  applicationId: string;
  attemptN: number;
  status: IdempotencyStatus;
  paymentIntentId: string | null;
  clientSecret: string | null;
  amountCents: number | null;
  currency: string | null;
  lastEventAt: Date | null;
  createdAt: Date;
}

export type IdempotencyDecision =
  | { kind: "create" }
  | { kind: "replay"; row: IdempotencyRow }
  | { kind: "blocked"; reason: "succeeded" | "failed"; row: IdempotencyRow };

export function buildIdempotencyKey(applicationId: string, attemptN: number): string {
  return `pi:${applicationId}:${attemptN}`;
}

/**
 * Pure decision: given the current row (or null), what should the caller do?
 *
 *   null              → create:   no prior attempt under this key
 *   pending row       → replay:   client is retrying mid-flow, return cached
 *                                 client_secret instead of minting a new one
 *   succeeded/failed  → blocked:  terminal state, caller must bump attemptN
 */
export function decide(row: IdempotencyRow | null): IdempotencyDecision {
  if (row === null) return { kind: "create" };
  if (row.status === "pending") return { kind: "replay", row };
  return { kind: "blocked", reason: row.status, row };
}

function rowFromDb(r: Record<string, unknown>): IdempotencyRow {
  return {
    idempotencyKey: r.idempotency_key as string,
    applicationId: r.application_id as string,
    attemptN: r.attempt_n as number,
    status: r.status as IdempotencyStatus,
    paymentIntentId: (r.payment_intent_id as string | null) ?? null,
    clientSecret: (r.client_secret as string | null) ?? null,
    amountCents: (r.amount_cents as number | null) ?? null,
    currency: (r.currency as string | null) ?? null,
    lastEventAt: (r.last_event_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function lookup(idempotencyKey: string): Promise<IdempotencyRow | null> {
  const result = await query(
    `SELECT idempotency_key, application_id, attempt_n, status, payment_intent_id,
            client_secret, amount_cents, currency, last_event_at, created_at
       FROM payment_idempotency
      WHERE idempotency_key = $1
      LIMIT 1`,
    [idempotencyKey]
  );
  if (result.rows.length === 0) return null;
  return rowFromDb(result.rows[0]);
}

export interface InsertPendingInput {
  idempotencyKey: string;
  applicationId: string;
  attemptN: number;
  amountCents: number;
  currency: string;
  paymentIntentId: string;
  clientSecret: string;
}

/**
 * Insert the pending row that records "we created a PaymentIntent for this
 * key." Uses ON CONFLICT DO NOTHING so a concurrent caller racing on the same
 * key resolves cleanly — the second caller sees the existing row on its next
 * lookup() and routes through `replay`.
 */
export async function insertPending(input: InsertPendingInput): Promise<IdempotencyRow> {
  await query(
    `INSERT INTO payment_idempotency
       (idempotency_key, application_id, attempt_n, status,
        payment_intent_id, client_secret, amount_cents, currency, last_event_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      input.idempotencyKey,
      input.applicationId,
      input.attemptN,
      input.paymentIntentId,
      input.clientSecret,
      input.amountCents,
      input.currency,
    ]
  );
  const row = await lookup(input.idempotencyKey);
  if (!row) {
    throw new Error("payment_idempotency row vanished immediately after insert");
  }
  return row;
}

/**
 * Transition `pending → succeeded|failed`. Called from the webhook handler
 * once Stripe confirms a terminal state for the PaymentIntent.
 *
 * Idempotent: re-applying the same terminal status is a no-op. We intentionally
 * do NOT support transitioning between succeeded ↔ failed — if Stripe ever
 * sends conflicting terminal events for the same intent, we want the first
 * one to win and the second to surface in the webhook DLQ for inspection.
 */
export async function markStatus(
  idempotencyKey: string,
  status: Exclude<IdempotencyStatus, "pending">
): Promise<void> {
  await query(
    `UPDATE payment_idempotency
        SET status = $2, last_event_at = NOW()
      WHERE idempotency_key = $1
        AND status = 'pending'`,
    [idempotencyKey, status]
  );
}
