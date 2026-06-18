import { query } from '../../config/database';
import { parseOneSiteCsv, RawWaitlistRow } from './onesite-adapter';
import { waitlistRowSchema } from './validation';

// Compliance windows for the wait-list (DM-FRANK-029).
export const RESPONSE_WINDOW_HOURS = 48; // per offer: applicant must respond within 48h
export const REMOVAL_WINDOW_DAYS = 12; // overall: removed if still unworked after 12 days

// The pg config wrapper may return either the pg result ({rows}) or rows[].
function rowsOf(res: any): any[] {
  return Array.isArray(res) ? res : res?.rows ?? [];
}

export interface IngestResult {
  batchId: string | null;
  parsed: number;
  imported: number;
  duplicates: number;
  invalid: number;
  errors: { row: number; reason: string }[];
}

/**
 * Ingest a OneSite (or generic) wait-list CSV for a property: parse, validate,
 * sequence into a stable priority order, and load as a queue with the 12-day
 * overall window started. Idempotent per (property, phone) via ON CONFLICT.
 */
export async function ingestOneSiteCsv(opts: {
  propertyId: string;
  csvText: string;
  fileName?: string;
  importedBy?: string;
  source?: string;
}): Promise<IngestResult> {
  const { propertyId, csvText, fileName, importedBy, source = 'onesite' } = opts;

  const raw = parseOneSiteCsv(csvText);
  const errors: { row: number; reason: string }[] = [];
  const valid: RawWaitlistRow[] = [];
  raw.forEach((r, i) => {
    const parsed = waitlistRowSchema.safeParse(r);
    if (parsed.success) valid.push(parsed.data as RawWaitlistRow);
    else errors.push({ row: i + 2, reason: parsed.error.issues.map((x) => x.message).join('; ') });
  });

  // Sequence: explicit source position wins, then original date added, then
  // file order (Array.sort is stable) — preserves the operator's intended order.
  valid.sort((a, b) => {
    const pa = a.sourcePosition ?? Number.MAX_SAFE_INTEGER;
    const pb = b.sourcePosition ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    const da = a.sourceDateAdded ? Date.parse(a.sourceDateAdded) : NaN;
    const db = b.sourceDateAdded ? Date.parse(b.sourceDateAdded) : NaN;
    return (isNaN(da) ? Number.MAX_SAFE_INTEGER : da) - (isNaN(db) ? Number.MAX_SAFE_INTEGER : db);
  });

  // De-dupe by phone within the file (keep the highest-priority occurrence).
  const seen = new Set<string>();
  const deduped = valid.filter((r) => {
    const p = r.phone as string;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  const fileDuplicates = valid.length - deduped.length;

  if (deduped.length === 0) {
    return { batchId: null, parsed: raw.length, imported: 0, duplicates: fileDuplicates, invalid: errors.length, errors };
  }

  const batchRes = await query(
    `INSERT INTO waitlist_import_batches (property_id, source, file_name, imported_count, imported_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [propertyId, source, fileName ?? null, 0, importedBy ?? null]
  );
  const batchId = rowsOf(batchRes)[0].id as string;

  const cols = [
    'batch_id', 'property_id', 'source_applicant_id', 'first_name', 'last_name',
    'phone', 'email', 'bedroom_count', 'source_position', 'source_date_added', 'position', 'expires_at',
  ];
  const params: any[] = [];
  const tuples: string[] = [];
  deduped.forEach((r, i) => {
    const b = params.length;
    const dateAdded =
      r.sourceDateAdded && !isNaN(Date.parse(r.sourceDateAdded))
        ? new Date(r.sourceDateAdded).toISOString()
        : null;
    params.push(
      batchId, propertyId, r.sourceApplicantId ?? null, r.firstName ?? null, r.lastName ?? null,
      r.phone, r.email ?? null, r.bedroomCount ?? null, r.sourcePosition ?? null, dateAdded, i + 1
    );
    // expires_at is computed in SQL so it tracks server time, not the client clock.
    tuples.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11}, NOW() + INTERVAL '${REMOVAL_WINDOW_DAYS} days')`
    );
  });

  const insertRes = await query(
    `INSERT INTO waitlist_import_entries (${cols.join(',')})
     VALUES ${tuples.join(',')}
     ON CONFLICT (property_id, phone) DO NOTHING
     RETURNING id`,
    params
  );
  const imported = rowsOf(insertRes).length;
  const duplicates = fileDuplicates + (deduped.length - imported); // file dupes + already-on-list

  await query(`UPDATE waitlist_import_batches SET imported_count = $1 WHERE id = $2`, [imported, batchId]);

  return { batchId, parsed: raw.length, imported, duplicates, invalid: errors.length, errors };
}

/** Pull the next queued prospect to contact and open their 48-hour response window. */
export async function offerNext(propertyId: string) {
  const res = await query(
    `UPDATE waitlist_import_entries SET
       status = 'offered', offered_at = NOW(),
       response_required_by = NOW() + INTERVAL '${RESPONSE_WINDOW_HOURS} hours', updated_at = NOW()
     WHERE id = (
       SELECT id FROM waitlist_import_entries
       WHERE property_id = $1 AND status = 'queued'
       ORDER BY position ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [propertyId]
  );
  return rowsOf(res)[0] ?? null;
}

/** Applicant responded (still interested) — clears their offer from expiry. */
export async function markResponded(entryId: string): Promise<boolean> {
  const res = await query(
    `UPDATE waitlist_import_entries SET status = 'responded', responded_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'offered' RETURNING id`,
    [entryId]
  );
  return rowsOf(res).length > 0;
}

/** Cron: 48-hour response window lapsed → expire the offer so the queue advances. */
export async function expireOverdueOffers(): Promise<number> {
  const res = await query(
    `UPDATE waitlist_import_entries SET status = 'expired', updated_at = NOW()
     WHERE status = 'offered' AND response_required_by < NOW() RETURNING id`
  );
  return rowsOf(res).length;
}

/** Cron: 12-day overall window lapsed without a response → remove from the list. */
export async function removeExpiredEntries(): Promise<number> {
  const res = await query(
    `UPDATE waitlist_import_entries SET status = 'removed', updated_at = NOW()
     WHERE status IN ('queued','offered') AND expires_at < NOW() RETURNING id`
  );
  return rowsOf(res).length;
}

/** The live, ordered queue for a property (queued + offered). */
export async function getQueue(propertyId: string) {
  const res = await query(
    `SELECT id, position, first_name, last_name, phone, email, bedroom_count,
            status, offered_at, response_required_by, expires_at
     FROM waitlist_import_entries
     WHERE property_id = $1 AND status IN ('queued','offered')
     ORDER BY position ASC`,
    [propertyId]
  );
  return rowsOf(res);
}
