import { query } from "../config/database";
import { logger } from "./logger";

/**
 * Background-job liveness (backlog #12). A job upserts its named row on every
 * successful tick; /health (and any external monitor) reads the row's age to
 * tell "quiet" from "dead" — the outbound dialer's failure mode was silent
 * death that stayed invisible until the 8pm Notion report.
 */

/** The outbound waitlist-validation dialer's beat, written every successful tick. */
export const DIALER_HEARTBEAT = "outbound_dialer_tick";

/**
 * Record a beat. NEVER throws: a liveness write must not fail the job it
 * instruments — a missed beat just shows up as staleness in /health, which is
 * the alarm doing its job.
 */
export async function recordHeartbeat(
  name: string,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO service_heartbeats (name, beat_at, detail)
       VALUES ($1, NOW(), $2)
       ON CONFLICT (name) DO UPDATE SET beat_at = NOW(), detail = EXCLUDED.detail`,
      [name, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    logger.warn("recordHeartbeat failed", { name, error: (err as Error).message });
  }
}

/** Latest beat for a job, or null if it has never beaten. Throws on DB failure. */
export async function getHeartbeat(
  name: string
): Promise<{ beatAt: Date; detail: unknown } | null> {
  const r = await query(
    `SELECT beat_at, detail FROM service_heartbeats WHERE name = $1`,
    [name]
  );
  if (r.rows.length === 0) return null;
  return { beatAt: new Date(r.rows[0].beat_at), detail: r.rows[0].detail };
}
