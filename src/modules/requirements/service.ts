import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { normalizePhone } from "../voice-intake/service";
import {
  REQUIREMENT_CATALOG,
  CATALOG_BY_KEY,
  isSatisfied,
  type AppSignals,
  type RequirementStatus,
} from "./catalog";

/**
 * Application requirements — the structured "what's still missing" that makes a
 * Frank callback (and an inbound resume) DETERMINISTIC instead of relying on the
 * LLM to recall the gap from the free-form follow_ups.checkpoint.
 *
 * computeMissing() fuses two sources, per item:
 *   1. an explicit `application_requirements` override row (set by Frank's
 *      mark_requirement tool, a PM action, or a document upload), if present;
 *   2. otherwise the column-derived status from the catalog (the screening
 *      verdicts already on `applications`).
 * So this works for EVERY application with zero backfill — the table is an
 * override/receipt layer over the system-of-record columns.
 */

export interface ChecklistEntry {
  key: string;
  label: string;
  required: boolean;
  status: RequirementStatus;
  /** True when this entry's status came from an explicit override row. */
  explicit: boolean;
}

export interface MissingItem {
  key: string;
  label: string;
}

/** The coarse signal columns the catalog derives from. PII-free. */
const SIGNAL_SELECT = `
  SELECT id, status,
         (ssn_encrypted IS NOT NULL) AS has_ssn,
         identity_verification_result, identity_session_status,
         income_verified, income_verification_result, screening_authorization_at
    FROM applications
   WHERE id = $1`;

function rowToSignals(row: Record<string, unknown>): AppSignals {
  return {
    status: (row.status as string) ?? null,
    hasSsn: Boolean(row.has_ssn),
    identityResult: (row.identity_verification_result as string) ?? null,
    identitySessionStatus: (row.identity_session_status as string) ?? null,
    incomeVerified: Boolean(row.income_verified),
    incomeResult: (row.income_verification_result as string) ?? null,
    screeningAuthorizedAt: (row.screening_authorization_at as string | Date) ?? null,
  };
}

/** Explicit override rows for an application, keyed by item_key. */
async function explicitStatuses(applicationId: string): Promise<Map<string, RequirementStatus>> {
  const res = await query(
    `SELECT item_key, status FROM application_requirements WHERE application_id = $1`,
    [applicationId]
  );
  const map = new Map<string, RequirementStatus>();
  for (const r of res.rows) map.set(r.item_key as string, r.status as RequirementStatus);
  return map;
}

/** Full per-item checklist for an application (override wins over derivation). */
export async function getChecklist(applicationId: string): Promise<ChecklistEntry[]> {
  const appRes = await query(SIGNAL_SELECT, [applicationId]);
  if (appRes.rows.length === 0) return [];
  const signals = rowToSignals(appRes.rows[0]);
  const overrides = await explicitStatuses(applicationId);

  return REQUIREMENT_CATALOG.map((item) => {
    const override = overrides.get(item.key);
    const status = override ?? item.deriveStatus(signals);
    return {
      key: item.key,
      label: item.label,
      required: item.required,
      status,
      explicit: override != null,
    };
  });
}

/** Required, not-yet-satisfied items — the open loop a follow-up chases. */
export async function computeMissing(applicationId: string): Promise<MissingItem[]> {
  const checklist = await getChecklist(applicationId);
  return checklist
    .filter((e) => e.required && !isSatisfied(e.status))
    .map((e) => ({ key: e.key, label: e.label }));
}

export interface MissingByPhone {
  applicationId: string | null;
  missing: MissingItem[];
}

/** Resolve the latest application for a phone-of-record, then its missing items. */
export async function computeMissingByPhone(phoneE164: string | null): Promise<MissingByPhone> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return { applicationId: null, missing: [] };
  const res = await query(
    `SELECT id FROM applications WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (res.rows.length === 0) return { applicationId: null, missing: [] };
  const applicationId = res.rows[0].id as string;
  return { applicationId, missing: await computeMissing(applicationId) };
}

export interface MarkItemInput {
  applicationId: string;
  itemKey: string;
  status: RequirementStatus;
  receivedRef?: string | null;
  verifiedBy?: string | null;
  source?: string;
}

/**
 * Record (override) an item's status — e.g. Frank's mark_requirement tool when a
 * caller says "here are my pay stubs", or a PM marking income verified. Upserts
 * the explicit row, then auto-closes the open document-chase follow-up loop for
 * this applicant if nothing required remains. Returns false on an unknown item.
 */
export async function markItem(input: MarkItemInput): Promise<boolean> {
  if (!CATALOG_BY_KEY.has(input.itemKey)) {
    logger.warn("markItem unknown item_key", { itemKey: input.itemKey });
    return false;
  }
  const received = input.status === "received" || input.status === "verified";
  await query(
    `INSERT INTO application_requirements (
       application_id, item_key, status, received_at, received_ref, verified_by, source
     ) VALUES ($1,$2,$3, CASE WHEN $4 THEN NOW() END, $5, $6, $7)
     ON CONFLICT (application_id, item_key) DO UPDATE SET
       status       = EXCLUDED.status,
       received_at  = COALESCE(EXCLUDED.received_at, application_requirements.received_at),
       received_ref = COALESCE(EXCLUDED.received_ref, application_requirements.received_ref),
       verified_by  = COALESCE(EXCLUDED.verified_by, application_requirements.verified_by),
       verified_at  = CASE WHEN EXCLUDED.status = 'verified' THEN NOW()
                           ELSE application_requirements.verified_at END,
       source       = COALESCE(EXCLUDED.source, application_requirements.source),
       updated_at   = NOW()`,
    [
      input.applicationId,
      input.itemKey,
      input.status,
      received,
      input.receivedRef ?? null,
      input.verifiedBy ?? null,
      input.source ?? "voice",
    ]
  );
  await resolveFollowupsIfComplete(input.applicationId);
  return true;
}

/**
 * When an application has no required items left outstanding, close its open
 * document-chase follow-ups (reason `needs_info`) so the auto-dialer never calls
 * back about a gap that's already filled. Conservative: only `needs_info`, only
 * when nothing required remains. Best-effort — never throws into a caller path.
 */
export async function resolveFollowupsIfComplete(applicationId: string): Promise<void> {
  try {
    const missing = await computeMissing(applicationId);
    if (missing.length > 0) return;
    const phoneRes = await query(
      `SELECT phone FROM applications WHERE id = $1`,
      [applicationId]
    );
    const phone = normalizePhone(phoneRes.rows[0]?.phone as string | null);
    if (!phone) return;
    const upd = await query(
      `UPDATE follow_ups
          SET status = 'completed', updated_at = NOW()
        WHERE phone_e164 = $1
          AND status IN ('pending','in_progress')
          AND reason = 'needs_info'
        RETURNING id`,
      [phone]
    );
    if (upd.rows.length > 0) {
      logger.info("requirements complete — closed document-chase follow-ups", {
        applicationId,
        closed: upd.rows.length,
      });
    }
  } catch (err) {
    logger.warn("resolveFollowupsIfComplete failed (non-fatal)", {
      applicationId,
      error: (err as Error).message,
    });
  }
}

/**
 * Phone-keyed convenience for the in-call `mark_requirement` tool: resolve the
 * latest application on a phone-of-record, then mark the item. Returns the
 * application id (or null when no application exists on that number).
 */
export async function markItemByPhone(
  phoneE164: string | null,
  itemKey: string,
  status: RequirementStatus,
  receivedRef?: string | null
): Promise<{ ok: boolean; applicationId: string | null }> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return { ok: false, applicationId: null };
  const res = await query(
    `SELECT id FROM applications WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (res.rows.length === 0) return { ok: false, applicationId: null };
  const applicationId = res.rows[0].id as string;
  const ok = await markItem({ applicationId, itemKey, status, receivedRef, source: "voice" });
  return { ok, applicationId };
}

/** One-line, voice-friendly summary of what's still missing (for a checkpoint / script). */
export function summarizeMissing(missing: MissingItem[]): string {
  if (missing.length === 0) return "everything's in — nothing outstanding";
  if (missing.length === 1) return `still needs ${missing[0].label}`;
  const labels = missing.map((m) => m.label);
  const last = labels.pop();
  return `still needs ${labels.join(", ")} and ${last}`;
}
