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
  /** Structured "exactly where we are in the process" so a callback resumes here. */
  checkpoint: string | null;
}

export interface CreateFollowUpInput {
  phoneE164: string;
  reason: string;
  scheduledForIso: string;
  voiceCallId?: string | null;
  userId?: string | null;
  consentOutbound?: boolean;
  notes?: string | null;
  /** Structured resume checkpoint (current step + gathered facts + what's next). */
  checkpoint?: string | null;
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
       consent_outbound, notes, checkpoint, source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, phone_e164, reason, scheduled_for, status, attempts, notes, checkpoint`,
    [
      phone,
      input.userId ?? null,
      input.voiceCallId ?? null,
      input.reason,
      when.toISOString(),
      input.consentOutbound ?? false,
      input.notes ?? null,
      input.checkpoint ?? null,
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
    `SELECT id, phone_e164, reason, scheduled_for, status, attempts, notes, checkpoint
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
  /**
   * The freshest open follow-up's checkpoint — "exactly where we left off" — so
   * Frank resumes at that step on a callback or re-entry. Null when none.
   */
  resume_checkpoint: string | null;
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
  // Soonest-scheduled open follow-up carries the live "where we left off" state.
  const resume_checkpoint =
    open_followups.find((f) => f.checkpoint && f.checkpoint.trim())?.checkpoint ?? null;
  return { phone_e164: phone, rapport, application, open_followups, resume_checkpoint };
}

/**
 * Atomically claim the next due, pending follow-up (soonest first) and flip it
 * to in_progress. FOR UPDATE SKIP LOCKED so concurrent ticks never grab the same
 * row — the local-pg analogue of Sage's gpm_claim_next_call. Returns null when
 * nothing is due.
 */
export async function claimNextDueFollowUp(): Promise<ClaimedFollowUp | null> {
  const res = await query(
    `UPDATE follow_ups
        SET status = 'in_progress', last_attempted_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT id FROM follow_ups
         WHERE status = 'pending'
           AND scheduled_for <= NOW()
           AND attempts < max_attempts
         ORDER BY scheduled_for ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, phone_e164, reason, scheduled_for, status, attempts,
                notes, checkpoint, consent_outbound, voice_call_id, user_id`,
    []
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id as string,
    phoneE164: r.phone_e164 as string,
    reason: r.reason as string,
    attempts: Number(r.attempts ?? 0),
    notes: (r.notes as string) ?? null,
    checkpoint: (r.checkpoint as string) ?? null,
    consentOutbound: Boolean(r.consent_outbound),
    voiceCallId: (r.voice_call_id as string) ?? null,
  };
}

export interface ClaimedFollowUp {
  id: string;
  phoneE164: string;
  reason: string;
  attempts: number;
  notes: string | null;
  checkpoint: string | null;
  consentOutbound: boolean;
  voiceCallId: string | null;
}

/** Stamp the placed callback's conversation id on a claimed follow-up. */
export async function markFollowUpDialed(id: string, outboundConversationId: string | null): Promise<void> {
  await query(
    `UPDATE follow_ups SET outbound_conversation_id = $2, updated_at = NOW() WHERE id = $1`,
    [id, outboundConversationId]
  );
}

/**
 * Record a callback's outcome. completed/declined → close; no_answer/voicemail →
 * bump attempts + reschedule 24h out (until max_attempts → expired). Idempotent
 * enough for webhook re-delivery (a closed row stays closed).
 */
export async function recordFollowUpOutcome(
  id: string,
  outcome: "completed" | "declined" | "no_answer"
): Promise<void> {
  await query(
    `UPDATE follow_ups
        SET attempts = attempts + 1,
            last_attempted_at = NOW(),
            updated_at = NOW(),
            status = CASE
              WHEN $2 = 'completed' THEN 'completed'
              WHEN $2 = 'declined'  THEN 'declined'
              WHEN attempts + 1 >= max_attempts THEN 'expired'
              ELSE 'pending'
            END,
            scheduled_for = CASE
              WHEN $2 = 'no_answer' AND attempts + 1 < max_attempts THEN NOW() + INTERVAL '24 hours'
              ELSE scheduled_for
            END,
            next_attempt_after = CASE
              WHEN $2 = 'no_answer' AND attempts + 1 < max_attempts THEN NOW() + INTERVAL '24 hours'
              ELSE next_attempt_after
            END
      WHERE id = $1 AND status = 'in_progress'`,
    [id, outcome]
  );
}

/** Find an in-progress follow-up by the callback's conversation id (webhook). */
export async function findFollowUpByConversation(conversationId: string): Promise<string | null> {
  const res = await query(
    `SELECT id FROM follow_ups WHERE outbound_conversation_id = $1 AND status = 'in_progress' LIMIT 1`,
    [conversationId]
  );
  return res.rows.length ? (res.rows[0].id as string) : null;
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
    checkpoint: (row.checkpoint as string) ?? null,
  };
}
