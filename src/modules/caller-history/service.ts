import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { normalizePhone, pickField } from "../voice-intake/service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";

/**
 * Caller memory ("Frank remembers you").
 *
 * One row per phone-of-record in `caller_history`, accumulated across every
 * inbound voice conversation. The post-call webhook calls
 * `updateCallerHistory()` once a conversation lands (see service split below);
 * mid-call, the agent fires the `get_caller_history` server-tool which calls
 * `getCallerHistory()` and reads a one-line rapport summary back to the caller
 * ("Welcome back — last time we talked about a 2-bedroom...").
 *
 * PII-MINIMAL by design. We deliberately do NOT mirror the full
 * data_collection (name, exact income, household composition) into this table.
 * That detail already lives — append-only, consent-gated, audit-taped — in
 * `voice_intake_calls`. This table is a thin *recognition + rapport* cache, so
 * it carries only the coarse, non-sensitive signals Frank needs to sound like
 * he remembers the caller:
 *
 *   - call_count / first_call_at / latest_call_at  (recognition)
 *   - prior_outcome     — last call_successful (success|failure|unknown)
 *   - prior_apt_type    — apartment type of interest (eg "2BR"), coarse
 *   - prior_issue       — short free-text summary of the last open thread
 *   - prior_city        — current city, the one locality cue Frank reuses
 *   - prior_callback_requested — were we supposed to call them back?
 *
 * Income, full name, household size and the verbatim transcript are NEVER
 * written here; if a future feature needs them it reads `voice_intake_calls`
 * by phone under the existing RBAC + tape, not this cache.
 *
 * Schema contract (created by the caller-history migration slice — this module
 * does NOT create the table). Mirrors the conventions in
 * src/db/migrations/2026-05-27-voice-intake.sql:
 *
 *   CREATE TABLE IF NOT EXISTS caller_history (
 *     id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *     phone_e164                TEXT NOT NULL UNIQUE,
 *     call_count                INTEGER NOT NULL DEFAULT 0,
 *     first_call_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     latest_call_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     prior_outcome             VARCHAR(16),   -- success | failure | unknown
 *     prior_apt_type            VARCHAR(32),   -- coarse, eg "2BR"
 *     prior_issue               TEXT,          -- short last-thread summary
 *     prior_city                TEXT,          -- current city cue
 *     prior_callback_requested  BOOLEAN NOT NULL DEFAULT FALSE,
 *     created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   CREATE INDEX IF NOT EXISTS idx_caller_history_latest
 *     ON caller_history(latest_call_at DESC);
 */

// Coarse free-text cues are capped before they hit the DB columns so a runaway
// transcript summary can never blow past the VARCHAR/TEXT budgets or leak a
// wall of PII into the rapport cache.
const MAX_APT_TYPE_LEN = 32;
const MAX_ISSUE_LEN = 240;
const MAX_CITY_LEN = 120;
const MAX_OUTCOME_LEN = 16;

/**
 * The per-call signal the webhook hands us once a conversation lands. Field
 * names mirror the post-call dispatch shape (camelCase `dataCollection` /
 * `evaluationCriteria` — the ElevenLabs `analysis.data_collection_results` and
 * `analysis.evaluation_criteria_results` maps, already lifted out). We tolerate
 * the raw snake_case keys too so a caller that passes the untouched analysis
 * block still works.
 */
export interface CallData {
  /** ElevenLabs `analysis.data_collection_results` — `{ key: { value, ... } }`. */
  dataCollection?: Record<string, unknown>;
  /** ElevenLabs `analysis.evaluation_criteria_results` — `{ key: { result, rationale } }`. */
  evaluationCriteria?: Record<string, unknown>;
  /** Raw-shape fallbacks (untouched `analysis.*`). */
  data_collection_results?: Record<string, unknown>;
  evaluation_criteria_results?: Record<string, unknown>;
  /** Overall ElevenLabs `analysis.call_successful` — success|failure|unknown. */
  callSuccessful?: string | null;
  call_successful?: string | null;
}

/** A returning caller as stored in `caller_history`. */
export interface CallerProfile {
  phoneE164: string;
  callCount: number;
  firstCallAt: Date;
  latestCallAt: Date;
  priorOutcome: string | null;
  priorAptType: string | null;
  priorIssue: string | null;
  priorCity: string | null;
  priorCallbackRequested: boolean;
}

function dataCollectionOf(callData: CallData): Record<string, unknown> | undefined {
  return callData.dataCollection ?? callData.data_collection_results;
}

function evaluationCriteriaOf(callData: CallData): Record<string, unknown> | undefined {
  return callData.evaluationCriteria ?? callData.evaluation_criteria_results;
}

/**
 * Cap + tidy a free-text cue before it lands in a DB column. Returns null for
 * empty/blank input so COALESCE keeps the prior value instead of nulling it.
 */
function clip(value: string | null, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Resolve the coarse outcome for this call. Prefer the explicit
 * `call_successful` overall verdict; fall back to the `name` evaluation
 * criterion's `result` (the one criterion every Frank agent scores). Coarse on
 * purpose — success|failure|unknown only.
 */
function deriveOutcome(callData: CallData): string | null {
  const overall = callData.callSuccessful ?? callData.call_successful;
  if (typeof overall === "string" && overall.trim()) {
    return clip(overall, MAX_OUTCOME_LEN);
  }
  const criteria = evaluationCriteriaOf(callData);
  const nameEntry = criteria?.name;
  if (nameEntry && typeof nameEntry === "object") {
    const result = (nameEntry as { result?: unknown }).result;
    if (typeof result === "string" && result.trim()) {
      return clip(result, MAX_OUTCOME_LEN);
    }
  }
  return null;
}

/**
 * Map data_collection fields → the coarse apartment-type-of-interest cue.
 * Frank captures `apt_type_confirmed` ("2-bedroom", "studio", ...); we keep it
 * short and verbatim so the rapport line reads naturally.
 */
function deriveAptType(data: Record<string, unknown> | undefined): string | null {
  return clip(pickField(data, "apt_type_confirmed"), MAX_APT_TYPE_LEN);
}

/**
 * The last open-thread summary. Prefer Frank's `call_summary` collection field;
 * fall back to the `name` criterion's rationale (its free-text "why"). Kept
 * short — this is a rapport breadcrumb, not the transcript.
 */
function deriveIssue(callData: CallData): string | null {
  const data = dataCollectionOf(callData);
  const summary = pickField(data, "call_summary");
  if (summary) return clip(summary, MAX_ISSUE_LEN);

  const criteria = evaluationCriteriaOf(callData);
  const nameEntry = criteria?.name;
  if (nameEntry && typeof nameEntry === "object") {
    const rationale = (nameEntry as { rationale?: unknown }).rationale;
    if (typeof rationale === "string" && rationale.trim()) {
      return clip(rationale, MAX_ISSUE_LEN);
    }
  }
  return null;
}

function deriveCity(data: Record<string, unknown> | undefined): string | null {
  return clip(pickField(data, "current_city"), MAX_CITY_LEN);
}

/**
 * Did the caller ask us to call them back? Mirrors the readback Frank's tool
 * `record_callback_request` writes (`{value: 'true'}`).
 */
function deriveCallbackRequested(data: Record<string, unknown> | undefined): boolean {
  const raw = pickField(data, "callback_requested");
  if (raw == null) return false;
  return /^(true|yes|1|y)$/i.test(raw);
}

/**
 * UPSERT one `caller_history` row for this phone-of-record after a call lands.
 *
 * On first contact we INSERT with call_count = 1. On every subsequent call we
 * bump `call_count + 1`, set `latest_call_at = NOW()`, and refresh the coarse
 * `prior_*` cues from this call's collection/criteria — but only when this call
 * actually carried a value (COALESCE keeps the prior cue rather than nulling
 * it, so a quick "are you there?" call doesn't wipe a remembered apt type).
 * `prior_callback_requested` always reflects the latest call (a fulfilled
 * callback must be able to flip it back to FALSE).
 *
 * Idempotent on `phone_e164` (the UNIQUE key). PII-minimal — see file header.
 * Returns null for an unusable phone (we never key memory off a blank).
 */
export async function updateCallerHistory(
  phoneE164: string | null,
  callData: CallData
): Promise<CallerProfile | null> {
  const phone = normalizePhone(phoneE164);
  if (!phone) {
    logger.warn("updateCallerHistory skipped — no usable phone");
    return null;
  }

  const data = dataCollectionOf(callData);
  const priorOutcome = deriveOutcome(callData);
  const priorAptType = deriveAptType(data);
  const priorIssue = deriveIssue(callData);
  const priorCity = deriveCity(data);
  const priorCallbackRequested = deriveCallbackRequested(data);

  const result = await query(
    `INSERT INTO caller_history (
       phone_e164, call_count, first_call_at, latest_call_at,
       prior_outcome, prior_apt_type, prior_issue, prior_city,
       prior_callback_requested
     )
     VALUES ($1, 1, NOW(), NOW(), $2, $3, $4, $5, $6)
     ON CONFLICT (phone_e164) DO UPDATE SET
       call_count = caller_history.call_count + 1,
       latest_call_at = NOW(),
       prior_outcome = COALESCE(EXCLUDED.prior_outcome, caller_history.prior_outcome),
       prior_apt_type = COALESCE(EXCLUDED.prior_apt_type, caller_history.prior_apt_type),
       prior_issue = COALESCE(EXCLUDED.prior_issue, caller_history.prior_issue),
       prior_city = COALESCE(EXCLUDED.prior_city, caller_history.prior_city),
       prior_callback_requested = EXCLUDED.prior_callback_requested,
       updated_at = NOW()
     RETURNING phone_e164, call_count, first_call_at, latest_call_at,
               prior_outcome, prior_apt_type, prior_issue, prior_city,
               prior_callback_requested`,
    [
      phone,
      priorOutcome,
      priorAptType,
      priorIssue,
      priorCity,
      priorCallbackRequested,
    ]
  );

  const profile = rowToProfile(result.rows[0]);
  if (profile) {
    logger.info("caller history updated", {
      phoneMasked: maskPhone(phone),
      callCount: profile.callCount,
    });
  }
  return profile;
}

/**
 * Look up a caller's accumulated memory by phone. Returns null for an unknown
 * (or first-time) caller, or for an unusable phone string.
 */
export async function getCallerHistory(
  phoneE164: string | null
): Promise<CallerProfile | null> {
  const phone = normalizePhone(phoneE164);
  if (!phone) return null;

  const result = await query(
    `SELECT phone_e164, call_count, first_call_at, latest_call_at,
            prior_outcome, prior_apt_type, prior_issue, prior_city,
            prior_callback_requested
       FROM caller_history
      WHERE phone_e164 = $1
      LIMIT 1`,
    [phone]
  );
  if (result.rows.length === 0) return null;
  return rowToProfile(result.rows[0]);
}

function rowToProfile(row: Record<string, unknown> | undefined): CallerProfile | null {
  if (!row) return null;
  return {
    phoneE164: row.phone_e164 as string,
    callCount: Number(row.call_count ?? 0),
    firstCallAt: row.first_call_at as Date,
    latestCallAt: row.latest_call_at as Date,
    priorOutcome: (row.prior_outcome as string | null) ?? null,
    priorAptType: (row.prior_apt_type as string | null) ?? null,
    priorIssue: (row.prior_issue as string | null) ?? null,
    priorCity: (row.prior_city as string | null) ?? null,
    priorCallbackRequested: Boolean(row.prior_callback_requested),
  };
}

/**
 * Compose the one-line rapport summary the agent reads back. Short, natural,
 * and PII-minimal: outcome + apt-type-of-interest + last open thread, only the
 * clauses we actually have. Never names the caller or quotes income.
 *
 * Example: "Returning caller (3rd call); last outcome success; interested in
 * 2BR; prior issue: waiting on the waitlist callback."
 */
export function buildRapportSummary(profile: CallerProfile): string {
  const ordinal = nthCall(profile.callCount);
  const parts: string[] = [
    profile.callCount > 1
      ? `Returning caller (${ordinal} call)`
      : "First-time caller",
  ];
  if (profile.priorOutcome) parts.push(`last outcome ${profile.priorOutcome}`);
  if (profile.priorAptType) parts.push(`interested in ${profile.priorAptType}`);
  if (profile.priorCity) parts.push(`in ${profile.priorCity}`);
  if (profile.priorIssue) parts.push(`prior issue: ${profile.priorIssue}`);
  if (profile.priorCallbackRequested) parts.push("a callback was requested");
  return parts.join("; ");
}

function nthCall(count: number): string {
  if (count <= 0) return "0th";
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${count}th`;
  switch (count % 10) {
    case 1:
      return `${count}st`;
    case 2:
      return `${count}nd`;
    case 3:
      return `${count}rd`;
    default:
      return `${count}th`;
  }
}

/** Last-4-digits masking for log lines. Never log the full E.164. */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return `***${phone.slice(-4)}`;
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Phase 2 voice tool: `get_caller_history`.
 *
 * At the top of an inbound call Frank fires this with the caller's number
 * (`{phone_e164}`, or the alias `{phone}`). We look up the rapport cache and
 * hand back a single line for the agent to weave in ("Welcome back — last time
 * we talked about a 2-bedroom..."). Unknown / first-time callers return
 * `ok: true` with a neutral "no prior history" message so the agent simply
 * greets them fresh — never an error path.
 *
 * Returns ToolCallbackResult (the agent reads `message`):
 *   - { ok: true,  message: "Returning caller; last outcome success; ..." }
 *   - { ok: true,  message: "No prior call history for this number." }
 *   - { ok: false, message: "I couldn't catch your number..." }  → agent retries
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED with the
 * ok/handler outcome — we do NOT double-stamp.
 */
export async function getCallerHistoryHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phoneRaw = pickString(parameters, "phone_e164") ?? pickString(parameters, "phone");
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    logger.warn("get_caller_history missing phone", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I didn't catch your phone number, so I can't pull up your history just yet.",
    };
  }

  const profile = await getCallerHistory(phone);
  if (!profile || profile.callCount <= 1) {
    // First-ever contact (or the row that this very call just created) — there
    // is no PRIOR history to recall. Neutral, not an error.
    return {
      ok: true,
      result: { returning: false },
      message: "No prior call history for this number.",
    };
  }

  const summary = buildRapportSummary(profile);
  logger.info("get_caller_history hit", {
    conversationId: context.conversationId,
    phoneMasked: maskPhone(phone),
    callCount: profile.callCount,
  });

  return {
    ok: true,
    result: {
      returning: true,
      callCount: profile.callCount,
      priorOutcome: profile.priorOutcome,
      priorAptType: profile.priorAptType,
      priorCallbackRequested: profile.priorCallbackRequested,
    },
    message: summary,
  };
}

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once (wired by the Integrate
 * step in src/index.ts); tests can also call it after
 * clearToolHandlersForTests() to re-wire.
 */
export function registerCallerHistoryHandler(): void {
  if (registered) return;
  registerToolHandler("get_caller_history", getCallerHistoryHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so the suite can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
