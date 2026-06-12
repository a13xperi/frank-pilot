/**
 * Outbound wait-list calling — orchestration (DM-FRANK-029).
 *
 * State machines this file owns:
 *
 *   external_waitlist_entries.status
 *     pending ──propose──▶ queued ──real dial──▶ contacted ─┐
 *        ▲                   │                              │ (response window
 *        └──reject/dry-run───┘                              │  reopens it)
 *     contacted ──propose──▶ queued …                       ◀┘
 *     anything ──window lapse / attempts maxed──▶ removal_review (PERSON decides)
 *
 *   outbound_call_queue.status
 *     proposed ──approve──▶ approved ──dial──▶ dialing ──▶ completed | failed
 *         └─────reject────▶ rejected
 *
 * Human-on-the-loop invariant: the dialer ONLY runs against rows a reviewer
 * explicitly approved, and every attempt — including dry runs — stamps
 * VOICE_INTAKE_OUTBOUND_ATTEMPTED on the compliance tape (TCPA PEWC anchor).
 * Sequencing FILTERS but never REORDERS: proposal order is source_position.
 */

import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { normalizePhone } from "../voice-intake/service";
import { placeOutboundCall } from "./dialer";
import {
  evaluateEligibility,
  isWithinCallingHours,
  nextAllowedDialTime,
  outboundLocalTimeZone,
  windowsAfterContact,
  type EligibilityInput,
  type IneligibleReason,
} from "./sequencing";
import type { WaitlistImportRow } from "./csv";

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportOptions {
  sourceLabel: string;
  propertyId: string | null;
  importedBy: string;
  rows: WaitlistImportRow[];
}

export interface ImportResult {
  batchId: string;
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importWaitlist(opts: ImportOptions): Promise<ImportResult> {
  const batchRes = await query(
    `INSERT INTO waitlist_import_batches (property_id, source_label, imported_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [opts.propertyId, opts.sourceLabel, opts.importedBy]
  );
  const batchId = batchRes.rows[0].id as string;

  const errors: string[] = [];
  let imported = 0;
  let nextPosition = 1;

  for (const row of opts.rows) {
    // Explicit positions (operator's own numbering) win; otherwise file order.
    // Either way the ordering is the operator's, never ours.
    const position = row.position ?? nextPosition;
    nextPosition = Math.max(nextPosition, position) + 1;

    if (!row.name?.trim()) {
      errors.push(`position ${position}: skipped — no name`);
      continue;
    }
    const phone = normalizePhone(row.phone);
    const listedAt = row.listedAt && !Number.isNaN(Date.parse(row.listedAt)) ? row.listedAt : null;

    try {
      await query(
        `INSERT INTO external_waitlist_entries
           (batch_id, property_id, source_position, full_name, phone, email,
            bedroom_count, listed_at, consent_outbound, consent_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          batchId,
          opts.propertyId,
          position,
          row.name.trim(),
          phone,
          row.email,
          row.bedrooms,
          listedAt,
          row.consent,
          row.consentSource,
        ]
      );
      imported++;
    } catch (err) {
      errors.push(`position ${position}: ${(err as Error).message}`);
    }
  }

  await query(
    `UPDATE waitlist_import_batches SET row_count = $1, skipped_count = $2 WHERE id = $3`,
    [imported, errors.length, batchId]
  );

  void stampTape({
    kind: "WAITING_LIST_APP_CAPTURED",
    actor: opts.importedBy,
    sessionId: batchId,
    payload: {
      surface: "outbound_import",
      batchId,
      sourceLabel: opts.sourceLabel,
      propertyId: opts.propertyId,
      imported,
      skipped: errors.length,
    },
  });

  return { batchId, imported, skipped: errors.length, errors };
}

// ── Proposal ────────────────────────────────────────────────────────────────

interface EntryRow {
  id: string;
  status: string;
  phone: string | null;
  full_name: string;
  source_position: number;
  consent_outbound: boolean;
  contact_attempts: number;
  first_contacted_at: Date | null;
  last_contacted_at: Date | null;
  response_window_expires_at: Date | null;
  removal_window_expires_at: Date | null;
}

function toEligibilityInput(row: EntryRow): EligibilityInput {
  return {
    status: row.status,
    phone: row.phone,
    consentOutbound: row.consent_outbound,
    contactAttempts: row.contact_attempts,
    firstContactedAt: row.first_contacted_at,
    lastContactedAt: row.last_contacted_at,
    responseWindowExpiresAt: row.response_window_expires_at,
    removalWindowExpiresAt: row.removal_window_expires_at,
  };
}

export interface ProposeOptions {
  propertyId: string | null;
  limit: number;
  actorId: string;
  now?: Date;
}

export interface ProposeResult {
  proposed: Array<{ queueId: string; entryId: string; name: string; position: number; scheduledAfter: string }>;
  skipped: Array<{ entryId: string; position: number; reason: IneligibleReason }>;
  flaggedForReview: number;
}

export async function proposeCalls(opts: ProposeOptions): Promise<ProposeResult> {
  const now = opts.now ?? new Date();
  const tz = outboundLocalTimeZone();

  const params: unknown[] = [];
  let propertyClause = "";
  if (opts.propertyId) {
    params.push(opts.propertyId);
    propertyClause = `AND e.property_id = $${params.length}`;
  }

  // Compliance ordering: source_position ASC, full stop. Entries with a live
  // queue row are excluded (partial unique index is the backstop).
  const candidates = await query(
    `SELECT e.id, e.status, e.phone, e.full_name, e.source_position,
            e.consent_outbound, e.contact_attempts,
            e.first_contacted_at, e.last_contacted_at,
            e.response_window_expires_at, e.removal_window_expires_at
       FROM external_waitlist_entries e
      WHERE e.status IN ('pending','contacted')
        ${propertyClause}
        AND NOT EXISTS (
          SELECT 1 FROM outbound_call_queue q
           WHERE q.entry_id = e.id
             AND q.status IN ('proposed','approved','dialing')
        )
      ORDER BY e.source_position ASC`,
    params
  );

  const proposed: ProposeResult["proposed"] = [];
  const skipped: ProposeResult["skipped"] = [];
  let flaggedForReview = 0;

  for (const row of candidates.rows as EntryRow[]) {
    if (proposed.length >= opts.limit) break;

    const verdict = evaluateEligibility(toEligibilityInput(row), now);
    if (!verdict.eligible) {
      if (verdict.needsRemovalReview) {
        await query(
          `UPDATE external_waitlist_entries
              SET status = 'removal_review', updated_at = NOW()
            WHERE id = $1 AND status IN ('pending','contacted')`,
          [row.id]
        );
        flaggedForReview++;
      }
      skipped.push({ entryId: row.id, position: row.source_position, reason: verdict.reason });
      continue;
    }

    const scheduledAfter = nextAllowedDialTime(now, tz);
    const queueRes = await query(
      `INSERT INTO outbound_call_queue
         (entry_id, attempt_number, proposed_by, consent_snapshot, scheduled_after)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [row.id, row.contact_attempts + 1, opts.actorId, row.consent_outbound, scheduledAfter]
    );
    await query(
      `UPDATE external_waitlist_entries SET status = 'queued', updated_at = NOW() WHERE id = $1`,
      [row.id]
    );
    proposed.push({
      queueId: queueRes.rows[0].id as string,
      entryId: row.id,
      name: row.full_name,
      position: row.source_position,
      scheduledAfter: scheduledAfter.toISOString(),
    });
  }

  logger.info("outbound proposal batch", {
    actorId: opts.actorId,
    proposed: proposed.length,
    skipped: skipped.length,
    flaggedForReview,
  });
  return { proposed, skipped, flaggedForReview };
}

// ── Review (human-on-the-loop gate) ─────────────────────────────────────────

export interface ReviewOptions {
  queueId: string;
  decision: "approve" | "reject";
  actorId: string;
  reason?: string;
}

/** Revert a queued entry to its natural contactable state. */
async function revertEntryStatus(entryId: string): Promise<void> {
  await query(
    `UPDATE external_waitlist_entries
        SET status = CASE WHEN contact_attempts > 0 THEN 'contacted' ELSE 'pending' END,
            updated_at = NOW()
      WHERE id = $1 AND status = 'queued'`,
    [entryId]
  );
}

export async function reviewQueueItem(opts: ReviewOptions): Promise<{ status: string }> {
  const nextStatus = opts.decision === "approve" ? "approved" : "rejected";
  const res = await query(
    `UPDATE outbound_call_queue
        SET status = $1, reviewed_by = $2, reviewed_at = NOW(),
            reject_reason = $3, updated_at = NOW()
      WHERE id = $4 AND status = 'proposed'
      RETURNING entry_id`,
    [nextStatus, opts.actorId, opts.decision === "reject" ? (opts.reason ?? null) : null, opts.queueId]
  );
  if (res.rows.length === 0) {
    throw Object.assign(new Error("queue item not found or not in 'proposed'"), {
      code: "BAD_QUEUE_STATE",
    });
  }

  if (opts.decision === "reject") {
    await revertEntryStatus(res.rows[0].entry_id as string);
  }

  void stampTape({
    kind: "VOICE_INTAKE_DECISION",
    actor: opts.actorId,
    sessionId: opts.queueId,
    payload: {
      surface: "outbound_queue",
      queueId: opts.queueId,
      entryId: res.rows[0].entry_id,
      decision: nextStatus,
      reason: opts.reason ?? null,
    },
  });

  return { status: nextStatus };
}

// ── Dial ────────────────────────────────────────────────────────────────────

export interface DialOptions {
  queueId: string;
  actorId: string;
  now?: Date;
}

export type DialServiceResult =
  | { placed: false; refused: "not_approved" | "no_consent" | "no_phone" }
  | { placed: false; refused: "outside_calling_hours"; nextAllowedAt: string }
  | { placed: false; refused: "dial_failed"; error: string }
  | { placed: true; dryRun: boolean; conversationId: string | null };

export async function dialQueueItem(opts: DialOptions): Promise<DialServiceResult> {
  const now = opts.now ?? new Date();
  const tz = outboundLocalTimeZone();

  const res = await query(
    `SELECT q.id AS queue_id, q.status AS queue_status, q.attempt_number,
            q.consent_snapshot, q.scheduled_after,
            e.id AS entry_id, e.full_name, e.phone, e.consent_outbound,
            e.contact_attempts, e.first_contacted_at, e.last_contacted_at,
            e.response_window_expires_at, e.removal_window_expires_at,
            e.property_id
       FROM outbound_call_queue q
       JOIN external_waitlist_entries e ON e.id = q.entry_id
      WHERE q.id = $1`,
    [opts.queueId]
  );
  const row = res.rows[0];
  if (!row || row.queue_status !== "approved") {
    return { placed: false, refused: "not_approved" };
  }
  if (!row.phone) {
    return { placed: false, refused: "no_phone" };
  }
  // TCPA PEWC, checked twice on purpose: the snapshot frozen at proposal AND
  // the entry's current flag (covers consent withdrawn after approval).
  if (!row.consent_snapshot || !row.consent_outbound) {
    return { placed: false, refused: "no_consent" };
  }
  const scheduledAfter: Date | null = row.scheduled_after;
  if (
    (scheduledAfter && now.getTime() < scheduledAfter.getTime()) ||
    !isWithinCallingHours(now, tz)
  ) {
    const nextAllowed = nextAllowedDialTime(
      scheduledAfter && now.getTime() < scheduledAfter.getTime() ? scheduledAfter : now,
      tz
    );
    return {
      placed: false,
      refused: "outside_calling_hours",
      nextAllowedAt: nextAllowed.toISOString(),
    };
  }

  await query(
    `UPDATE outbound_call_queue SET status = 'dialing', updated_at = NOW() WHERE id = $1`,
    [opts.queueId]
  );

  const firstName = (row.full_name as string).split(/\s+/)[0] ?? "";
  const outcome = await placeOutboundCall({
    toNumber: row.phone,
    queueId: opts.queueId,
    entryId: row.entry_id,
    dynamicVariables: { applicant_first_name: firstName },
  });

  // Every attempt — dry runs included — lands on the tape with its consent
  // evidence. This is the TCPA 47 CFR §64.1200(a)(2) audit anchor.
  void stampTape({
    kind: "VOICE_INTAKE_OUTBOUND_ATTEMPTED",
    actor: opts.actorId,
    sessionId: opts.queueId,
    payload: {
      queueId: opts.queueId,
      entryId: row.entry_id,
      propertyId: row.property_id,
      phone: row.phone,
      attemptNumber: row.attempt_number,
      consentSnapshot: row.consent_snapshot,
      dryRun: outcome.dryRun,
      ok: outcome.ok,
      conversationId: outcome.conversationId,
      error: outcome.error ?? null,
    },
  });

  if (!outcome.ok) {
    await query(
      `UPDATE outbound_call_queue
          SET status = 'failed', dial_result = $1, dialed_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [outcome.error ?? "failed", opts.queueId]
    );
    await revertEntryStatus(row.entry_id as string);
    return { placed: false, refused: "dial_failed", error: outcome.error ?? "failed" };
  }

  await query(
    `UPDATE outbound_call_queue
        SET status = 'completed', dial_result = $1, conversation_id = $2,
            dialed_at = NOW(), updated_at = NOW()
      WHERE id = $3`,
    [outcome.dryRun ? "dry_run" : "initiated", outcome.conversationId, opts.queueId]
  );

  if (outcome.dryRun) {
    // No PSTN traffic happened — no contact attempt is consumed, no windows
    // open. The entry simply returns to the contactable pool.
    await revertEntryStatus(row.entry_id as string);
    return { placed: true, dryRun: true, conversationId: null };
  }

  const windows = windowsAfterContact(
    {
      contactAttempts: row.contact_attempts,
      firstContactedAt: row.first_contacted_at,
      lastContactedAt: row.last_contacted_at,
      responseWindowExpiresAt: row.response_window_expires_at,
      removalWindowExpiresAt: row.removal_window_expires_at,
    },
    now
  );
  await query(
    `UPDATE external_waitlist_entries
        SET status = 'contacted',
            contact_attempts = $1,
            first_contacted_at = $2,
            last_contacted_at = $3,
            response_window_expires_at = $4,
            removal_window_expires_at = $5,
            updated_at = NOW()
      WHERE id = $6`,
    [
      windows.contactAttempts,
      windows.firstContactedAt,
      windows.lastContactedAt,
      windows.responseWindowExpiresAt,
      windows.removalWindowExpiresAt,
      row.entry_id,
    ]
  );

  return { placed: true, dryRun: false, conversationId: outcome.conversationId };
}
