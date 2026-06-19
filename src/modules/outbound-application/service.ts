import { query } from "../../config/database";
import { logger } from "../../utils/logger";

/**
 * Outbound full-application agent queue (Frank core C3, "Jacqueline").
 *
 * Server-side scaffolding only — the queue + the application↔call map + the
 * needed-fields computation. The LIVE DIAL is DEFERRED (see ./index.ts and the
 * deferral note below). This module is intentionally dial-free: it answers
 * "which drafts need a completion call and what's still missing", and records
 * outcomes — but it never calls ElevenLabs/Twilio.
 *
 * Mirrors src/modules/outbound-validation/* so the eventual live dialer reuses
 * the same concurrency-1 / batch-cap / pacing gate philosophy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEFERRED (needs live integration; NOT built in this slice):
 *   - the live outbound dialer tick (initiateOutboundCall → ElevenLabs native
 *     Twilio) — a near-clone of outbound-validation/dialer.ts but pointed at a
 *     Jacqueline agent_id + applications drafts. Cannot be unit-tested without a
 *     live ElevenLabs agent + a real number, so it is left as a documented seam.
 *   - the ElevenLabs agent config / agent_id (a console artifact).
 *   - the post-call webhook → outcome mapping (a clone of
 *     outbound-validation/outcome.ts; trivial to add once the agent's
 *     data_collection schema is fixed).
 * The tool handlers (./tool-handlers.ts) ARE built + tested, because they run
 * inside the already-shipped, signed, deduped tool-callback pipeline and need no
 * live telephony to exercise.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The fields Jacqueline collects to complete a full application. */
export const COLLECTIBLE_FIELDS = [
  "date_of_birth_encrypted",
  "ssn_encrypted",
  "current_address_line1",
  "current_city",
  "current_state",
  "current_zip",
  "employer_name",
  "annual_income",
  "household_size",
] as const;

export type CollectibleField = (typeof COLLECTIBLE_FIELDS)[number];

/** Friendly labels for the agent's needed-fields prompt / report. */
export const FIELD_LABELS: Record<CollectibleField, string> = {
  date_of_birth_encrypted: "date of birth",
  ssn_encrypted: "Social Security number",
  current_address_line1: "current street address",
  current_city: "current city",
  current_state: "current state",
  current_zip: "current ZIP",
  employer_name: "employer",
  annual_income: "annual income",
  household_size: "household size",
};

interface DraftRow {
  id: string;
  status: string;
  phone: string | null;
  first_name: string | null;
  [k: string]: unknown;
}

/**
 * Compute which collectible fields are still missing on a draft. household_size
 * defaults to 1 in the schema, so it only counts as "needed" when explicitly
 * NULL (rare); the rest are needed when NULL/empty.
 */
export function computeNeededFields(draft: Record<string, unknown>): CollectibleField[] {
  const missing: CollectibleField[] = [];
  for (const f of COLLECTIBLE_FIELDS) {
    const v = draft[f];
    if (v === null || v === undefined || v === "") missing.push(f);
  }
  return missing;
}

export interface EnqueueInput {
  applicationId: string;
  testCall?: boolean;
}

export interface EnqueueResult {
  callId: string;
  status: string;
  neededFields: CollectibleField[];
  /** True when a NEW queue row was created; false when one was already open. */
  created: boolean;
}

/**
 * Enqueue an application draft for a Jacqueline completion call.
 *
 * Refuses (throws) if the application isn't a 'draft' (only drafts get
 * completed by phone) or doesn't exist. Idempotent: if an open (queued|dialed)
 * call already exists for the draft, returns it with created:false instead of
 * minting a duplicate (the partial-unique constraint also enforces this at the
 * DB level).
 */
export async function enqueueApplicationCall(
  input: EnqueueInput
): Promise<EnqueueResult> {
  const draftRes = await query(
    `SELECT * FROM applications WHERE id = $1 LIMIT 1`,
    [input.applicationId]
  );
  if (draftRes.rows.length === 0) {
    throw Object.assign(new Error("application not found"), {
      code: "APPLICATION_NOT_FOUND",
    });
  }
  const draft = draftRes.rows[0] as DraftRow;
  if (draft.status !== "draft") {
    throw Object.assign(new Error(`application status is '${draft.status}', not 'draft'`), {
      code: "APPLICATION_NOT_DRAFT",
    });
  }

  // Idempotency: reuse an existing open call.
  const openRes = await query(
    `SELECT id, status, needed_fields
       FROM outbound_application_calls
      WHERE application_id = $1 AND status IN ('queued','dialed')
      LIMIT 1`,
    [input.applicationId]
  );
  if (openRes.rows.length > 0) {
    const existing = openRes.rows[0];
    return {
      callId: existing.id as string,
      status: existing.status as string,
      neededFields: (existing.needed_fields as CollectibleField[]) ?? [],
      created: false,
    };
  }

  const needed = computeNeededFields(draft);
  const last4 = draft.phone ? String(draft.phone).replace(/\D/g, "").slice(-4) : null;

  const inserted = await query(
    `INSERT INTO outbound_application_calls
       (application_id, to_number_last4, test_call, status, needed_fields)
     VALUES ($1, $2, $3, 'queued', $4::jsonb)
     RETURNING id, status`,
    [input.applicationId, last4, Boolean(input.testCall), JSON.stringify(needed)]
  );
  const row = inserted.rows[0];
  logger.info("Outbound application call enqueued", {
    applicationId: input.applicationId,
    callId: row.id,
    neededCount: needed.length,
  });
  return {
    callId: row.id as string,
    status: row.status as string,
    neededFields: needed,
    created: true,
  };
}

/** Cancel an open (queued|dialed) call for a draft. Returns whether one changed. */
export async function cancelApplicationCall(applicationId: string): Promise<boolean> {
  const result = await query(
    `UPDATE outbound_application_calls
        SET status = 'canceled', completed_at = NOW()
      WHERE application_id = $1 AND status IN ('queued','dialed')`,
    [applicationId]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface QueueRow {
  id: string;
  application_id: string;
  status: string;
  attempts: number;
  needed_fields: CollectibleField[];
  queued_at: string;
}

/** The current queue (queued + dialed), oldest first. */
export async function listQueue(): Promise<QueueRow[]> {
  const result = await query(
    `SELECT id, application_id, status, attempts, needed_fields, queued_at
       FROM outbound_application_calls
      WHERE status IN ('queued','dialed')
      ORDER BY queued_at ASC`,
    []
  );
  return result.rows as QueueRow[];
}
