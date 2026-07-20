import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { sanitizeObject } from "../../utils/pii-filter";

/**
 * Redact-in-place sweep for voice_intake_calls rows persisted BEFORE the
 * write-side C1 redaction landed (PR #386) — the backlog row's "migration for
 * existing rows". Those rows still hold the caller's spoken SSN/DOB in
 * plaintext: the inline transcript inside `raw_payload` plus the collected
 * fields in `data_collection_results`.
 *
 * Applies the EXACT transform persistConversation() now applies on write
 * (src/modules/voice-intake/service.ts), so there is one redaction source of
 * truth (utils/pii-filter):
 *   - drop the inline `transcript` key from raw_payload — the call stays
 *     retrievable via transcript_url, which needs the ElevenLabs API key
 *   - sanitizeObject() over the remaining raw_payload and over
 *     data_collection_results (key-pattern redaction for ssn/dob/etc plus
 *     PII-pattern scans of string leaves)
 *
 * Idempotent and resumable: a row is rewritten only when the redacted JSON
 * differs from what is stored, so a second run reports updated=0; rows the
 * write-side redaction already cleaned are untouched. Keyset-paginated on id
 * so the sweep never holds a long transaction or a big result set.
 *
 * The read-side defense on the PM detail GET (routes.ts) keeps pre-sweep rows
 * safe to SERVE in the meantime — this sweep is what removes the plaintext
 * at REST.
 */

export interface RedactSweepOptions {
  /** Rows per SELECT batch (default 200). */
  batchSize?: number;
  /** Report what would change without writing. */
  dryRun?: boolean;
}

export interface RedactSweepResult {
  scanned: number;
  updated: number;
  batches: number;
  dryRun: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * The write-side transform, applied to stored jsonb. Returns null when the
 * value is not a plain object (nothing to redact — left untouched).
 */
export function redactStoredRawPayload(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  const { transcript: _omitTranscript, ...rest } = raw;
  return sanitizeObject(rest);
}

export function redactStoredDataResults(dcr: unknown): Record<string, unknown> | null {
  if (!isPlainObject(dcr)) return null;
  return sanitizeObject(dcr);
}

export async function redactExistingVoiceIntakeRows(
  opts: RedactSweepOptions = {}
): Promise<RedactSweepResult> {
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? 200));
  const dryRun = opts.dryRun ?? false;

  let scanned = 0;
  let updated = 0;
  let batches = 0;
  let lastId: string | null = null;

  for (;;) {
    const batch = await query(
      `SELECT id, raw_payload, data_collection_results
         FROM voice_intake_calls
        WHERE ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id
        LIMIT $2`,
      [lastId, batchSize]
    );
    if (batch.rows.length === 0) break;
    batches += 1;

    for (const row of batch.rows as Array<{
      id: string;
      raw_payload: unknown;
      data_collection_results: unknown;
    }>) {
      scanned += 1;
      lastId = row.id;

      const safeRaw = redactStoredRawPayload(row.raw_payload);
      const safeDcr = redactStoredDataResults(row.data_collection_results);

      const rawChanged =
        safeRaw !== null && JSON.stringify(safeRaw) !== JSON.stringify(row.raw_payload);
      const dcrChanged =
        safeDcr !== null &&
        JSON.stringify(safeDcr) !== JSON.stringify(row.data_collection_results);
      if (!rawChanged && !dcrChanged) continue;

      updated += 1;
      if (dryRun) continue;

      await query(
        `UPDATE voice_intake_calls
            SET raw_payload = $2::jsonb,
                data_collection_results = $3::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [
          row.id,
          JSON.stringify(safeRaw ?? row.raw_payload),
          JSON.stringify(safeDcr ?? row.data_collection_results),
        ]
      );
    }

    logger.info("voice-intake PII redact sweep — batch done", {
      batches,
      scanned,
      updated,
      dryRun,
    });
  }

  logger.info("voice-intake PII redact sweep — complete", {
    batches,
    scanned,
    updated,
    dryRun,
  });
  return { scanned, updated, batches, dryRun };
}
