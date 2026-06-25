import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { normalizePhone } from "../voice-intake/service";

/**
 * The Relationship Report — a running per-person summary derived from the
 * relationship_ledger + the person's latest application. Refreshed on every
 * ledger write (best-effort, never throws) so it's one fast read for "where does
 * this person stand overall." This is the CRM record + the warm-re-entry source.
 *
 * Deterministic v1 (no model call): a clean one-liner from the events on file.
 * A cheap-model distilled narrative can replace summary later (the comms-distill
 * pattern) without changing the read shape.
 */

export interface PersonReport {
  phone_e164: string;
  summary: string | null;
  interactions: number;
  last_status: string | null;
  last_event: string | null;
}

/** Recompute + upsert the report for one person. Best-effort; never throws. */
export async function refreshPersonReport(phoneE164: string | null): Promise<void> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return;
  try {
    const led = await query(
      `SELECT count(*)::int AS n,
              max(occurred_at) AS last_at,
              array_agg(DISTINCT event_type) AS events,
              (array_agg(event_type ORDER BY occurred_at DESC))[1] AS last_event
         FROM relationship_ledger WHERE phone_e164 = $1`,
      [phone]
    );
    const row = led.rows[0];
    const n = (row?.n as number) ?? 0;
    if (n === 0) return; // nothing to summarize yet
    const events: string[] = Array.isArray(row.events) ? row.events : [];
    const lastEvent = (row.last_event as string) ?? null;
    const lastAt = row.last_at as string | Date | null;

    // Latest application status for this phone (if any).
    const appRes = await query(
      `SELECT status FROM applications WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    const status = (appRes.rows[0]?.status as string) ?? null;

    const summary = buildSummary(n, events, status);

    await query(
      `INSERT INTO relationship_report
         (phone_e164, summary, interactions, last_status, last_event, last_event_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, NOW())
       ON CONFLICT (phone_e164) DO UPDATE SET
         summary = EXCLUDED.summary,
         interactions = EXCLUDED.interactions,
         last_status = EXCLUDED.last_status,
         last_event = EXCLUDED.last_event,
         last_event_at = EXCLUDED.last_event_at,
         updated_at = NOW()`,
      [phone, summary, n, status, lastEvent, lastAt]
    );
  } catch (err) {
    logger.warn("relationship report refresh failed (non-fatal)", {
      error: (err as Error).message,
    });
  }
}

/** Read the stored report. */
export async function getPersonReport(phoneE164: string | null): Promise<PersonReport | null> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return null;
  const res = await query(
    `SELECT phone_e164, summary, interactions, last_status, last_event
       FROM relationship_report WHERE phone_e164 = $1`,
    [phone]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    phone_e164: r.phone_e164 as string,
    summary: (r.summary as string) ?? null,
    interactions: (r.interactions as number) ?? 0,
    last_status: (r.last_status as string) ?? null,
    last_event: (r.last_event as string) ?? null,
  };
}

// Deterministic one-liner from the events on file + the application status.
export function buildSummary(n: number, events: string[], status: string | null): string {
  const has = (e: string) => events.includes(e);
  const parts: string[] = [];
  if (has("application_created")) parts.push("applied");
  if (has("fee_paid")) parts.push("fee paid");
  if (has("screening_passed")) parts.push("screening passed");
  else if (has("screening_failed")) parts.push("screening did not pass");
  else if (has("screening_started")) parts.push("screening underway");
  if (has("callback_scheduled")) parts.push("callback scheduled");

  const lead = n === 1 ? "First contact" : `${n} interactions`;
  const journey = parts.length ? `: ${parts.join(", ")}` : "";
  const statusTail = status ? ` Current status: ${status}.` : "";
  return `${lead}${journey}.${statusTail}`.trim();
}
