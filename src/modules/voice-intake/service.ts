import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { sanitizeObject } from "../../utils/pii-filter";
import { stampTape } from "../tape";
import { sendMagicLinkSms } from "../auth/magic-link-service";

/**
 * Shape of the `data` payload ElevenLabs sends on `post_call_*` webhooks.
 * Only the fields we actually persist are typed; the rest is preserved in
 * `raw_payload` for forensic replay.
 *
 * Reference: ElevenLabs Conv. AI post-call webhook v1 (see e2e harness at
 * ~/elevenlabs-training/frank-onboarder/e2e/ for the live agent shape).
 */
export interface PostCallPayload {
  conversation_id: string;
  agent_id: string;
  status?: string;
  transcript?: Array<{
    role: "agent" | "user";
    message?: string;
    time_in_call_secs?: number;
  }>;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    cost?: Record<string, unknown>;
    main_language?: string;
    detected_language?: string;
  };
  analysis?: {
    call_successful?: string;
    evaluation_criteria_results?: Record<string, unknown>;
    data_collection_results?: Record<string, unknown>;
  };
  // ElevenLabs hosts the audio + transcript behind URLs that require API-key
  // auth — we never serve these directly to the browser, the PM console
  // proxies through our `/audio` endpoint with RBAC. Optional because not
  // every event type carries them.
  transcript_url?: string;
  audio_url?: string;
}

export interface PersistResult {
  callId: string;
  language: string | null;
  callSuccessful: string | null;
  consentRecording: boolean;
  callbackRequested: boolean;
}

/**
 * Extract the `value` from a data_collection_results entry. ElevenLabs
 * shapes each entry as `{ value, rationale, json_schema, ... }`. Returns
 * null if missing or non-string.
 */
export function pickField(
  results: Record<string, unknown> | undefined,
  key: string
): string | null {
  if (!results) return null;
  const entry = results[key];
  if (!entry || typeof entry !== "object") return null;
  const value = (entry as { value?: unknown }).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Best-effort consent flag — Frank's tool `record_consent_decision` writes
 * `{value: 'true'}` (or `false`). Default TRUE if the caller never opted
 * out (matches the implied-consent path of "stayed on the call past the
 * disclosure"). Phase 4 will tighten this with the explicit system-tool
 * gate.
 */
function readConsentFlag(results: Record<string, unknown> | undefined): boolean {
  const raw = pickField(results, "consent_recording");
  if (raw == null) return true;
  return /^(true|yes|1|y)$/i.test(raw);
}

function readCallbackFlag(results: Record<string, unknown> | undefined): boolean {
  const raw = pickField(results, "callback_requested");
  if (raw == null) return false;
  return /^(true|yes|1|y)$/i.test(raw);
}

/**
 * Upsert one row in `voice_intake_calls`. UNIQUE(conversation_id) lets the
 * same call be re-delivered as `post_call_transcription` then
 * `post_call_audio` and converge to a single record — newer non-null fields
 * win, older fields are preserved on the second pass.
 */
export async function persistConversation(payload: PostCallPayload): Promise<PersistResult> {
  const analysis = payload.analysis ?? {};
  const metadata = payload.metadata ?? {};
  const dataResults = analysis.data_collection_results;

  const language =
    metadata.detected_language?.slice(0, 8) ?? metadata.main_language?.slice(0, 8) ?? null;
  const callSuccessful = (analysis.call_successful ?? "").slice(0, 16) || null;

  const startedAt = metadata.start_time_unix_secs
    ? new Date(metadata.start_time_unix_secs * 1000)
    : new Date();
  const endedAt =
    metadata.start_time_unix_secs && metadata.call_duration_secs
      ? new Date((metadata.start_time_unix_secs + metadata.call_duration_secs) * 1000)
      : null;

  const consentRecording = readConsentFlag(dataResults);
  const callbackRequested = readCallbackFlag(dataResults);

  // PII-safe persist (audit C1): the caller reads their SSN/DOB ALOUD, so the
  // inline transcript + collected fields would land in raw_payload unencrypted.
  // Drop the inline transcript (it stays retrievable via transcript_url with the
  // API key) and redact SSN/email/phone/card patterns from the rest + from the
  // collected fields before storing.
  const { transcript: _omitTranscript, ...payloadNoTranscript } =
    payload as unknown as Record<string, unknown>;
  const safeRawPayload = sanitizeObject(payloadNoTranscript);
  const safeDataResults = sanitizeObject((dataResults ?? {}) as Record<string, unknown>);

  const result = await query(
    `INSERT INTO voice_intake_calls (
       conversation_id, agent_id, started_at, ended_at, language, call_successful,
       evaluation_criteria_results, data_collection_results,
       transcript_url, audio_url, cost_breakdown,
       consent_recording, callback_requested, raw_payload
     )
     VALUES ($1, $2, $3, $4, $5, $6,
             $7::jsonb, $8::jsonb,
             $9, $10, $11::jsonb,
             $12, $13, $14::jsonb)
     ON CONFLICT (conversation_id) DO UPDATE SET
       ended_at = COALESCE(EXCLUDED.ended_at, voice_intake_calls.ended_at),
       language = COALESCE(EXCLUDED.language, voice_intake_calls.language),
       call_successful = COALESCE(EXCLUDED.call_successful, voice_intake_calls.call_successful),
       evaluation_criteria_results =
         CASE WHEN EXCLUDED.evaluation_criteria_results = '{}'::jsonb
              THEN voice_intake_calls.evaluation_criteria_results
              ELSE EXCLUDED.evaluation_criteria_results END,
       data_collection_results =
         CASE WHEN EXCLUDED.data_collection_results = '{}'::jsonb
              THEN voice_intake_calls.data_collection_results
              ELSE EXCLUDED.data_collection_results END,
       transcript_url = COALESCE(EXCLUDED.transcript_url, voice_intake_calls.transcript_url),
       audio_url = COALESCE(EXCLUDED.audio_url, voice_intake_calls.audio_url),
       cost_breakdown =
         CASE WHEN EXCLUDED.cost_breakdown = '{}'::jsonb
              THEN voice_intake_calls.cost_breakdown
              ELSE EXCLUDED.cost_breakdown END,
       consent_recording = EXCLUDED.consent_recording,
       callback_requested = EXCLUDED.callback_requested,
       raw_payload = EXCLUDED.raw_payload,
       updated_at = NOW()
     RETURNING id`,
    [
      payload.conversation_id,
      payload.agent_id,
      startedAt,
      endedAt,
      language,
      callSuccessful,
      JSON.stringify(analysis.evaluation_criteria_results ?? {}),
      JSON.stringify(safeDataResults),
      payload.transcript_url ?? null,
      payload.audio_url ?? null,
      JSON.stringify(metadata.cost ?? {}),
      consentRecording,
      callbackRequested,
      JSON.stringify(safeRawPayload),
    ]
  );

  const callId = result.rows[0]?.id as string;
  return { callId, language, callSuccessful, consentRecording, callbackRequested };
}

/**
 * Normalize a phone string to a loose E.164 shape (`+<digits>`).
 *
 * Rules:
 *   - Leading `+` in the input is honored — caller explicitly typed a country
 *     code, so we keep their digits as-is. Stripping then re-adding `+`
 *     mis-prefixed 10-digit international numbers (eg `+4520123456`) with
 *     a bogus `+1`.
 *   - No leading `+`: strip non-digits. 10 digits → assume US (+1); anything
 *     else → prepend `+` to the digits we have.
 *
 * Deliberately permissive — validation/canonicalization (eg libphonenumber)
 * happens at the downstream approve step. The column is `VARCHAR(20)`, so
 * the looseness is tolerated.
 */
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export interface ApproveOptions {
  callId: string;
  propertyId: string;
  actorId: string;
}

/**
 * Promote a reviewed voice intake into an `applications` row.
 *
 * Called from the PM console Approve action — never from the webhook,
 * because `applications.property_id` is NOT NULL and the caller has not
 * picked a property yet at intake time. The Approve route supplies the
 * property the PM selected from the property picker.
 *
 * Side effects (all idempotent on call_id):
 *   - INSERT applications row with source='voice', voice_call_id set
 *   - UPDATE voice_intake_calls.applicant_id back-reference
 *   - STAMP VOICE_INTAKE_DECISION (HUD 4350.3 Ch. 4-6 audit anchor)
 *   - SMS magic-link to the phone-of-record (doc-upload handoff)
 *
 * Throws if the call has already been promoted (idempotency guard via the
 * back-reference); callers should treat "already promoted" as a 409.
 */
export async function promoteIntakeToApplication(
  opts: ApproveOptions
): Promise<{ applicationId: string }> {
  const callRes = await query(
    `SELECT data_collection_results, applicant_id
       FROM voice_intake_calls WHERE id = $1`,
    [opts.callId]
  );
  const call = callRes.rows[0];
  if (!call) throw new Error("voice intake call not found");
  if (call.applicant_id) {
    throw Object.assign(new Error("already promoted"), { code: "ALREADY_PROMOTED" });
  }

  const data = (call.data_collection_results ?? {}) as Record<string, unknown>;
  const name = pickField(data, "name") ?? "Unknown Caller";
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(" ") || "—";
  const phone = normalizePhone(pickField(data, "phone"));
  const currentCity = pickField(data, "current_city");

  // Household + income are captured but stored verbatim — we don't do any AMI
  // math here (Frank's prompt forbids it). The PM does the eligibility math.
  const householdRaw = pickField(data, "household");
  const householdSize = householdRaw ? parseInt(householdRaw, 10) || null : null;
  const incomeRaw = pickField(data, "monthly_income");
  const monthlyIncome = incomeRaw ? Number(incomeRaw.replace(/[^0-9.]/g, "")) : null;
  const annualIncome = monthlyIncome ? monthlyIncome * 12 : null;

  const inserted = await query(
    `INSERT INTO applications (
       property_id, first_name, last_name, phone, current_city,
       household_size, annual_income, status,
       source, voice_call_id, submitted_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'voice', $8, $9)
     RETURNING id`,
    [
      opts.propertyId,
      firstName ?? "Unknown",
      lastName,
      phone,
      currentCity,
      householdSize,
      annualIncome,
      opts.callId,
      opts.actorId,
    ]
  );
  const applicationId = inserted.rows[0].id as string;

  await query(
    `UPDATE voice_intake_calls SET applicant_id = $1, updated_at = NOW() WHERE id = $2`,
    [applicationId, opts.callId]
  );

  void stampTape({
    kind: "VOICE_INTAKE_DECISION",
    actor: opts.actorId,
    sessionId: opts.callId,
    payload: {
      callId: opts.callId,
      applicationId,
      decision: "approved",
      propertyId: opts.propertyId,
      phone,
      currentCity,
      householdSize,
    },
  });

  // Doc-upload handoff via SMS — reuses the magic-link transport so the same
  // 15-min TTL / Twilio path applies. Fire-and-forget per the existing
  // magic-link-service contract; failures are logged, not surfaced.
  if (phone) {
    sendMagicLinkSms(phone, buildDocUploadLink(applicationId));
  } else {
    logger.warn("voice intake approve — no phone on record, doc-upload SMS skipped", {
      callId: opts.callId,
      applicationId,
    });
  }

  return { applicationId };
}

function buildDocUploadLink(applicationId: string): string {
  const base = process.env.TENANT_PORTAL_URL || "http://localhost:5174";
  return `${base}/apply/${applicationId}/documents`;
}

export interface RejectOptions {
  callId: string;
  actorId: string;
  reason: string;
}

export async function rejectIntake(opts: RejectOptions): Promise<void> {
  void stampTape({
    kind: "VOICE_INTAKE_DECISION",
    actor: opts.actorId,
    sessionId: opts.callId,
    payload: { callId: opts.callId, decision: "rejected", reason: opts.reason },
  });

  // Soft-reject: keep the row for audit, mark callback_requested=false so it
  // drops out of the queue. A future schema iteration could add an explicit
  // `rejected_at`; for now the tape stamp is the source of truth.
  await query(
    `UPDATE voice_intake_calls SET callback_requested = FALSE, updated_at = NOW() WHERE id = $1`,
    [opts.callId]
  );
}
