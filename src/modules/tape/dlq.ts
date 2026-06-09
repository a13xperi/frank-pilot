/**
 * BP-02 Compliance Tape — dead-letter queue + reconciliation.
 *
 * The acquisitions stamp sites (award-service.ts `stampSafe`,
 * recert-compliance.ts `stampNau` + `stampSafe`) deliberately swallow tape
 * failures: a tape outage must never block a durable management-side write
 * (a units.ami_designation designation, a recert review). The cost of that
 * deliberate swallow used to be a *silently lost compliance record* — the gap
 * the 2026-05-23-compliance-tape.sql migration comment called out.
 *
 * This module closes that gap without changing the swallow contract:
 *   - parkFailedStamp(event, err) — called from each swallow's catch. Persists
 *     the failed TapeEvent to compliance_tape_dlq. Never throws (it is itself
 *     wrapped in try/catch): a DLQ outage must not turn a swallowed tape failure
 *     into a thrown one.
 *   - replayTapeDlq(opts?)  — re-stamps unresolved rows. Replay is safe because
 *     stamp() commits its row as the last statement before returning, so a
 *     thrown (= parked) stamp committed nothing → re-stamping never double-writes
 *     a row that already exists. Marks rows resolved on success, bumps
 *     attempt_count on repeat failure.
 *   - getTapeDlqStats() — counts for an ops view / tests.
 *
 * Mirrors the cra_webhook_dlq pattern (src/modules/screening/cra-webhook.ts),
 * minus the event_id idempotency key: acq stamps carry no natural delivery id,
 * so each failed stamp is a discrete row and the active-row cap is the runaway
 * backstop. What's stored is exactly the payload the tape itself would have held
 * (compliance metadata) — never raw PII.
 */

import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { createTapeService } from "./service";
import { PgTapeRepository } from "./repository";
import type { TapeEvent, TapeStampKind } from "./types";

const tape = createTapeService(new PgTapeRepository());

/** Stop accepting new parked rows past this many unreplayed/unexhausted entries.
 *  A standing tape outage would otherwise grow this table unbounded. Matches the
 *  cra_webhook_dlq cap. */
const DLQ_ACTIVE_ROW_CAP = 10_000;

/** A row past this many failed replays is left for manual triage (it stops
 *  counting against the active cap and is skipped by replay). */
const MAX_REPLAY_ATTEMPTS = 5;

/** Count rows still eligible for replay (unresolved and under the attempt cap). */
async function activeDlqRowCount(): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count
       FROM compliance_tape_dlq
      WHERE resolved_at IS NULL
        AND attempt_count < $1`,
    [MAX_REPLAY_ATTEMPTS]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Park a tape stamp that a stamp site swallowed. Best-effort and silent: this
 * runs inside an already-swallowed catch, so it must never throw.
 */
export async function parkFailedStamp(event: TapeEvent, err: Error): Promise<void> {
  try {
    const activeCount = await activeDlqRowCount();
    if (activeCount >= DLQ_ACTIVE_ROW_CAP) {
      logger.warn("compliance-tape DLQ at capacity — skipping new row", {
        kind: event.kind,
        activeCount,
        cap: DLQ_ACTIVE_ROW_CAP,
      });
      return;
    }
    await query(
      `INSERT INTO compliance_tape_dlq (kind, session_id, payload, error_message)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [event.kind, event.sessionId ?? null, JSON.stringify(event.payload), err.message]
    );
  } catch (dlqErr) {
    logger.error("compliance-tape DLQ insert failed", {
      kind: event.kind,
      error: (dlqErr as Error).message,
    });
  }
}

interface DlqRow {
  id: string;
  kind: string;
  session_id: string | null;
  payload: TapeEvent["payload"];
  attempt_count: number;
}

export interface ReplayResult {
  scanned: number;
  replayed: number;
  failed: number;
}

/**
 * Re-stamp unresolved DLQ rows. Oldest-first, capped per run. On success marks
 * the row resolved; on failure bumps attempt_count (a row that exhausts
 * MAX_REPLAY_ATTEMPTS drops out of scope for manual triage).
 */
export async function replayTapeDlq(opts?: { limit?: number }): Promise<ReplayResult> {
  const limit = opts?.limit ?? 100;
  const { rows } = await query(
    `SELECT id, kind, session_id, payload, attempt_count
       FROM compliance_tape_dlq
      WHERE resolved_at IS NULL
        AND attempt_count < $1
      ORDER BY first_failed_at ASC
      LIMIT $2`,
    [MAX_REPLAY_ATTEMPTS, limit]
  );

  let replayed = 0;
  let failed = 0;
  for (const row of rows as DlqRow[]) {
    try {
      await tape.stamp({
        kind: row.kind as TapeStampKind,
        payload: row.payload,
        sessionId: row.session_id ?? undefined,
      });
      await query(
        `UPDATE compliance_tape_dlq SET resolved_at = NOW() WHERE id = $1`,
        [row.id]
      );
      replayed++;
    } catch (err) {
      failed++;
      await query(
        `UPDATE compliance_tape_dlq
            SET attempt_count = attempt_count + 1,
                last_failed_at = NOW(),
                error_message = $2
          WHERE id = $1`,
        [row.id, (err as Error).message]
      );
      logger.warn("compliance-tape DLQ replay failed for row", {
        id: row.id,
        kind: row.kind,
        attempt: row.attempt_count + 1,
        error: (err as Error).message,
      });
    }
  }

  return { scanned: rows.length, replayed, failed };
}

export interface DlqStats {
  unresolved: number;
  resolved: number;
  exhausted: number;
}

/** Snapshot counts for an ops view: replayable, resolved, and exhausted. */
export async function getTapeDlqStats(): Promise<DlqStats> {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND attempt_count < $1)::int  AS unresolved,
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int                     AS resolved,
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND attempt_count >= $1)::int AS exhausted
     FROM compliance_tape_dlq`,
    [MAX_REPLAY_ATTEMPTS]
  );
  const r = rows[0] ?? {};
  return {
    unresolved: Number(r.unresolved ?? 0),
    resolved: Number(r.resolved ?? 0),
    exhausted: Number(r.exhausted ?? 0),
  };
}
