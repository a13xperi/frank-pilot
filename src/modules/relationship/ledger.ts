import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { normalizePhone } from "../voice-intake/service";

/**
 * The Relationship Ledger — the applicant-facing "ledger of truth": every
 * meaningful step Frank takes for a person, append-only and person-centric.
 *
 * recordLedgerEntry is BEST-EFFORT and NEVER THROWS, so it's safe to fire from
 * anywhere in a hot path (status transitions, the payment webhook, the callback
 * loop) without risking the caller. getLedgerByPhone reads the journey back.
 */

export type LedgerChannel = "system" | "email" | "voice" | "sms";
export type LedgerDirection = "inbound" | "outbound" | "internal";

export interface LedgerEntryInput {
  phoneE164: string | null;
  eventType: string;
  channel?: LedgerChannel;
  direction?: LedgerDirection;
  summary?: string | null;
  ref?: string | null;
  program?: string;
}

export interface LedgerEntry {
  event_type: string;
  channel: string;
  direction: string;
  summary: string | null;
  occurred_at: string;
}

/** Append one ledger entry. Best-effort: a bad phone or a write error logs + no-ops. */
export async function recordLedgerEntry(input: LedgerEntryInput): Promise<void> {
  const phone = normalizePhone(input.phoneE164);
  if (!phone) return;
  try {
    await query(
      `INSERT INTO relationship_ledger
         (phone_e164, program, event_type, channel, direction, summary, ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        phone,
        input.program ?? "housing",
        input.eventType,
        input.channel ?? "system",
        input.direction ?? "internal",
        input.summary ?? null,
        input.ref ?? null,
      ]
    );
  } catch (err) {
    logger.warn("relationship ledger write failed (non-fatal)", {
      eventType: input.eventType,
      error: (err as Error).message,
    });
  }
}

/** The person's journey, most-recent first (capped). */
export async function getLedgerByPhone(
  phoneE164: string | null,
  limit = 25
): Promise<LedgerEntry[]> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return [];
  const res = await query(
    `SELECT event_type, channel, direction, summary, occurred_at
       FROM relationship_ledger
      WHERE phone_e164 = $1
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [phone, limit]
  );
  return res.rows.map((r) => ({
    event_type: r.event_type as string,
    channel: r.channel as string,
    direction: r.direction as string,
    summary: (r.summary as string) ?? null,
    occurred_at: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
  }));
}
