import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { normalizePhone } from "../voice-intake/service";
import {
  getCallerHistory,
  buildRapportSummary,
} from "../caller-history/service";

/**
 * Follow-ups — scheduled callbacks + the context spine that makes a callback a
 * WARM re-entry, not a cold redial.
 *
 * Phase 1 here: create a follow-up (the `schedule_followup` tool), read a
 * person's open loop (`get_followups`), and assemble the Context Continuity
 * Packet (`get_call_context` / the Phase-2 dialer) — the full picture of who
 * this person is and where they are, so Frank opens already knowing everything.
 */

export interface FollowUp {
  id: string;
  phone_e164: string;
  reason: string;
  scheduled_for: string;
  status: string;
  attempts: number;
  notes: string | null;
}

export interface CreateFollowUpInput {
  phoneE164: string;
  reason: string;
  scheduledForIso: string;
  voiceCallId?: string | null;
  userId?: string | null;
  consentOutbound?: boolean;
  notes?: string | null;
  source?: string;
}

/** Insert a pending follow-up. Returns null on a bad phone / time. */
export async function createFollowUp(input: CreateFollowUpInput): Promise<FollowUp | null> {
  const phone = normalizePhone(input.phoneE164);
  if (!phone) return null;
  const when = new Date(input.scheduledForIso);
  if (Number.isNaN(when.getTime())) return null;

  const res = await query(
    `INSERT INTO follow_ups (
       phone_e164, user_id, voice_call_id, reason, scheduled_for,
       consent_outbound, notes, source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, phone_e164, reason, scheduled_for, status, attempts, notes`,
    [
      phone,
      input.userId ?? null,
      input.voiceCallId ?? null,
      input.reason,
      when.toISOString(),
      input.consentOutbound ?? false,
      input.notes ?? null,
      input.source ?? "voice_intake",
    ]
  );
  return rowToFollowUp(res.rows[0]);
}

/** A person's still-open follow-ups (pending or mid-dial), soonest first. */
export async function getOpenFollowUpsByPhone(phoneE164: string | null): Promise<FollowUp[]> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return [];
  const res = await query(
    `SELECT id, phone_e164, reason, scheduled_for, status, attempts, notes
       FROM follow_ups
      WHERE phone_e164 = $1 AND status IN ('pending','in_progress')
      ORDER BY scheduled_for ASC`,
    [phone]
  );
  return res.rows.map(rowToFollowUp).filter((f): f is FollowUp => f !== null);
}

export interface ContextPacket {
  phone_e164: string;
  rapport: string | null;
  application: {
    status: string;
    screening: Record<string, string | null>;
  } | null;
  open_followups: FollowUp[];
}

/**
 * The Context Continuity Packet — assembled server-side for a callback (or any
 * re-engagement) so Frank opens warm: who they are (caller_history rapport),
 * where they stand (latest application + screening verdicts), and the open loop
 * (pending follow-ups). This is the dynamic-variable payload the Phase-2 dialer
 * hands to the agent, and what `get_call_context` reads back mid-call.
 */
export async function buildContextPacket(phoneE164: string | null): Promise<ContextPacket | null> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return null;

  let rapport: string | null = null;
  try {
    const profile = await getCallerHistory(phone);
    if (profile && profile.callCount > 0) rapport = buildRapportSummary(profile);
  } catch (err) {
    logger.warn("context packet rapport failed", { error: (err as Error).message });
  }

  let application: ContextPacket["application"] = null;
  try {
    const a = await query(
      `SELECT status, identity_verification_result, background_check_result,
              credit_check_result, compliance_check_result, income_verification_result
         FROM applications
        WHERE phone = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [phone]
    );
    if (a.rows.length > 0) {
      const r = a.rows[0];
      application = {
        status: r.status as string,
        screening: {
          identity: (r.identity_verification_result as string) ?? null,
          background: (r.background_check_result as string) ?? null,
          credit: (r.credit_check_result as string) ?? null,
          compliance: (r.compliance_check_result as string) ?? null,
          income: (r.income_verification_result as string) ?? null,
        },
      };
    }
  } catch (err) {
    logger.warn("context packet application failed", { error: (err as Error).message });
  }

  const open_followups = await getOpenFollowUpsByPhone(phone);
  return { phone_e164: phone, rapport, application, open_followups };
}

function rowToFollowUp(row: Record<string, unknown> | undefined): FollowUp | null {
  if (!row) return null;
  const ts = row.scheduled_for;
  return {
    id: row.id as string,
    phone_e164: row.phone_e164 as string,
    reason: row.reason as string,
    scheduled_for: ts instanceof Date ? ts.toISOString() : String(ts),
    status: row.status as string,
    attempts: Number(row.attempts ?? 0),
    notes: (row.notes as string) ?? null,
  };
}
