import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import {
  claimNextCall,
  recordCallOutcome,
  resetClaim,
  type SageApplicant,
} from "./sage-client";
import { campaignFor } from "./campaigns";

/**
 * Outbound waitlist-validation dialer (DM-FRANK-029).
 *
 * One tick = at most one dial. Concurrency 1 is structural: the cron fires
 * every few minutes, and a tick refuses to dial while a tracked call is still
 * in flight. ElevenLabs native Twilio outbound does the telephony; the
 * post-call webhook (outcome.ts) closes the loop on Sage.
 *
 * Every gate is fail-closed and observable: the tick returns a TickResult
 * naming exactly why it did or didn't dial, and that result is what both the
 * scheduler log line and the manual admin endpoint surface.
 */

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

// A dialed call that hasn't produced a post-call webhook after this long is
// presumed lost (failed dial, webhook outage). The sweeper records no_answer
// so the Sage row re-queues instead of sticking in in_progress forever.
export const IN_FLIGHT_TIMEOUT_MINUTES = 30;

export interface TickResult {
  action:
    | "disabled"
    | "not_configured"
    | "outside_window"
    | "in_flight"
    | "batch_limit"
    | "paced"
    | "queue_empty"
    | "dry_run"
    | "dialed"
    | "dial_failed";
  applicantId?: string;
  conversationId?: string;
  detail?: string;
}

function flag(name: string): string {
  return process.env[name] ?? "";
}

function isEnabled(): boolean {
  return flag("FRANK_OUTBOUND_ENABLED") === "true";
}

function isDryRun(): boolean {
  return flag("FRANK_OUTBOUND_DRY_RUN") === "true";
}

function batchLimit(): number {
  const n = Number(flag("FRANK_OUTBOUND_BATCH_LIMIT"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function paceMinutes(): number {
  const n = Number(flag("FRANK_OUTBOUND_PACE_MINUTES"));
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/**
 * Optional building scope for a campaign run. Unset/empty = all buildings (the
 * historical global behavior). Set to a property code (e.g. "donna-louise-2") to
 * dial ONLY that building's waitlist — this is how DL2 runs as an isolated batch.
 */
function targetProperty(): string | null {
  const p = flag("FRANK_OUTBOUND_PROPERTY").trim();
  return p || null;
}

/** Hour-of-day in America/Los_Angeles (handles DST via Intl, no deps). */
export function pacificHour(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  }).format(now);
  // Intl yields "24" for midnight in some ICU versions; normalize.
  return Number(hour) % 24;
}

/** Calling window: 9:00am–7:59pm Pacific (TCPA-safe with margin). */
export function isWithinCallWindow(now: Date = new Date()): boolean {
  const h = pacificHour(now);
  return h >= 9 && h < 20;
}

/**
 * Dynamic variables handed to the ElevenLabs agent. Everything the call
 * script's {{placeholders}} reference, plus applicant_id as a passthrough
 * fallback mapping key for the post-call webhook.
 */
export function buildDynamicVariables(a: SageApplicant): Record<string, string> {
  const propNames = a.properties
    .map((p) => (p === "donna-louise-1" ? "Donna Louise 1" : p === "donna-louise-2" ? "Donna Louise 2" : p))
    .join(" and ");
  const aptLabel = (t: string) =>
    t === "studio" ? "studio" : t.replace(/^(\d)br$/, "$1 bedroom");
  const campaign = campaignFor(a.properties);
  return {
    applicant_id: a.id,
    applicant_name: a.full_name,
    // First name only — the opener should greet "Hi Janet", not "Hi Janet Smith".
    // Falls back to the full name if there's no whitespace to split on.
    applicant_first_name: a.full_name.trim().split(/\s+/)[0] || a.full_name,
    property_names: propNames || "Donna Louise Apartments",
    apt_types: a.apt_types.map(aptLabel).join(", ") || "an apartment",
    date_needed: a.asap
      ? "as soon as possible"
      : a.date_needed ?? "no specific date",
    shared_with: a.phone_shared_with ?? "",
    // Per-building campaign framing (see campaigns.ts). DL2 = "brand new";
    // existing buildings = "a unit opened". The script reads {{availability_note}}.
    availability_note: campaign.availabilityNote,
    unit_types_available: campaign.unitTypesAvailable ?? "",
  };
}

/** Fire one outbound call through ElevenLabs' native Twilio integration. */
export async function initiateOutboundCall(
  toNumber: string,
  dynamicVariables: Record<string, string>
): Promise<{ conversationId: string | null; callSid: string | null }> {
  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  const agentId = process.env.ELEVENLABS_OUTBOUND_AGENT_ID ?? "";
  const phoneNumberId = process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID ?? "";
  if (!apiKey || !agentId || !phoneNumberId) {
    throw new Error(
      "ElevenLabs outbound not configured (ELEVENLABS_API_KEY / ELEVENLABS_OUTBOUND_AGENT_ID / ELEVENLABS_AGENT_PHONE_NUMBER_ID)"
    );
  }
  const res = await fetch(`${ELEVENLABS_API}/convai/twilio/outbound-call`, {
    signal: AbortSignal.timeout(10000), // audit #10: never hang on a dead vendor/EL/Sage socket
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: toNumber,
      conversation_initiation_client_data: {
        dynamic_variables: dynamicVariables,
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs outbound-call failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    conversation_id?: string;
    callSid?: string;
    call_sid?: string;
  };
  return {
    conversationId: body.conversation_id ?? null,
    callSid: body.callSid ?? body.call_sid ?? null,
  };
}

async function hasInFlightCall(): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM outbound_validation_calls
      WHERE status = 'dialed'
        AND dialed_at > NOW() - ($1 || ' minutes')::interval
      LIMIT 1`,
    [String(IN_FLIGHT_TIMEOUT_MINUTES)]
  );
  return result.rows.length > 0;
}

/** Real dials today, Pacific calendar day (dry runs excluded; test calls count). */
async function dialsToday(): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM outbound_validation_calls
      WHERE status <> 'dry_run'
        AND (dialed_at AT TIME ZONE 'America/Los_Angeles')::date
            = (NOW() AT TIME ZONE 'America/Los_Angeles')::date`,
    []
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function minutesSinceLastDial(): Promise<number | null> {
  const result = await query(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(dialed_at))) / 60 AS mins
       FROM outbound_validation_calls
      WHERE status <> 'dry_run'`,
    []
  );
  const mins = result.rows[0]?.mins;
  return mins == null ? null : Number(mins);
}

function last4(phone: string): string {
  return phone.replace(/\D/g, "").slice(-4);
}

/**
 * TCPA PEWC audit anchor (grafted from the voice-outbound review-queue
 * design): EVERY dial attempt — dry runs included — stamps the compliance
 * tape, so "we attempted to call this applicant under this consent basis"
 * is durable even when no conversation ever happens.
 */
function stampAttempt(
  applicant: SageApplicant,
  toNumber: string,
  opts: { dryRun: boolean; testCall: boolean; conversationId?: string | null; failed?: boolean }
): void {
  void stampTape({
    kind: "VOICE_INTAKE_OUTBOUND_ATTEMPTED",
    actor: "outbound-validation-dialer",
    sessionId: opts.conversationId ?? `${opts.dryRun ? "dry" : opts.failed ? "fail" : "dial"}:${applicant.id}:${Date.now()}`,
    payload: {
      applicantId: applicant.id,
      toLast4: last4(toNumber),
      dryRun: opts.dryRun,
      testCall: opts.testCall,
      conversationId: opts.conversationId ?? null,
      failed: opts.failed ?? false,
      consentSource: applicant.consent_source ?? null,
    },
  });
}

/** Initials-only name for logs — full PII stays in Sage. */
function logName(a: SageApplicant): string {
  return a.full_name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

export async function runDialerTick(
  opts: { trigger: "cron" | "manual" } = { trigger: "cron" }
): Promise<TickResult> {
  if (!isEnabled()) return { action: "disabled" };
  if (!isWithinCallWindow()) return { action: "outside_window" };

  if (await hasInFlightCall()) return { action: "in_flight" };

  const todayCount = await dialsToday();
  if (todayCount >= batchLimit()) {
    return { action: "batch_limit", detail: `${todayCount}/${batchLimit()} dials today` };
  }

  const sinceLast = await minutesSinceLastDial();
  if (sinceLast != null && sinceLast < paceMinutes()) {
    return { action: "paced", detail: `${sinceLast.toFixed(1)}m since last dial` };
  }

  const applicant = await claimNextCall("frank", targetProperty());
  if (!applicant) return { action: "queue_empty" };

  const vars = buildDynamicVariables(applicant);
  const testNumber = flag("FRANK_OUTBOUND_TEST_NUMBER").trim();
  const toNumber = testNumber || applicant.phone_e164 || "";

  if (isDryRun()) {
    await query(
      `INSERT INTO outbound_validation_calls
         (applicant_id, to_number_last4, test_call, status, dynamic_variables)
       VALUES ($1, $2, $3, 'dry_run', $4::jsonb)`,
      [applicant.id, last4(toNumber), Boolean(testNumber), JSON.stringify(vars)]
    );
    await resetClaim(applicant.id);
    stampAttempt(applicant, toNumber, { dryRun: true, testCall: Boolean(testNumber) });
    logger.info("Outbound validation DRY RUN — would dial", {
      trigger: opts.trigger,
      applicant: logName(applicant),
      applicantId: applicant.id,
      toLast4: last4(toNumber),
      vars: { ...vars, applicant_name: logName(applicant) },
    });
    return { action: "dry_run", applicantId: applicant.id, detail: `would dial …${last4(toNumber)}` };
  }

  if (!toNumber) {
    // Shouldn't happen (the queue view filters phoneless rows) but fail safe.
    await recordCallOutcome({
      applicantId: applicant.id,
      outcome: "bad_number",
      notes: "no phone number on record at dial time",
    });
    return { action: "dial_failed", applicantId: applicant.id, detail: "no phone number" };
  }

  try {
    const { conversationId, callSid } = await initiateOutboundCall(toNumber, vars);
    await query(
      `INSERT INTO outbound_validation_calls
         (applicant_id, conversation_id, call_sid, to_number_last4, test_call, status, dynamic_variables)
       VALUES ($1, $2, $3, $4, $5, 'dialed', $6::jsonb)`,
      [
        applicant.id,
        conversationId,
        callSid,
        last4(toNumber),
        Boolean(testNumber),
        JSON.stringify(vars),
      ]
    );
    if (testNumber) {
      // Test call dialed a test number, not the applicant. Release the claim now so
      // the real applicant returns to 'pending' and is never held in_progress or
      // dispositioned by this call (the post-call webhook also skips Sage for test calls).
      // This runs AFTER the dial already succeeded, so its own failure is post-dial
      // cleanup, not a dial failure: isolate it in its own try/catch (log a warning)
      // so it can never fall into the dial-failure catch below and record a bogus
      // no_answer on the real applicant.
      try {
        await resetClaim(applicant.id);
      } catch (resetErr) {
        logger.warn("Outbound validation test-call reset claim failed (claim left in_progress; sweeper/Sage TTL recovers)", {
          applicantId: applicant.id,
          error: (resetErr as Error).message,
        });
      }
    }
    stampAttempt(applicant, toNumber, {
      dryRun: false,
      testCall: Boolean(testNumber),
      conversationId,
    });
    logger.info("Outbound validation call dialed", {
      trigger: opts.trigger,
      applicant: logName(applicant),
      applicantId: applicant.id,
      conversationId,
      toLast4: last4(toNumber),
      testCall: Boolean(testNumber),
    });
    return {
      action: "dialed",
      applicantId: applicant.id,
      conversationId: conversationId ?? undefined,
    };
  } catch (err) {
    const message = (err as Error).message;
    await query(
      `INSERT INTO outbound_validation_calls
         (applicant_id, to_number_last4, test_call, status, dynamic_variables, error)
       VALUES ($1, $2, $3, 'dial_failed', $4::jsonb, $5)`,
      [applicant.id, last4(toNumber), Boolean(testNumber), JSON.stringify(vars), message.slice(0, 500)]
    );
    if (!testNumber) {
      // Consume an attempt so the Sage row re-queues (24h) instead of wedging
      // in in_progress; three dial failures roll it to unreachable. NEVER do this
      // for a test call: it dialed a test number, so the claimed applicant's row was
      // only borrowed to build the script — recording an outcome would corrupt a real
      // applicant (mirrors the !test_call guard in outcome.ts). The test-call claim is
      // released non-destructively in the success path (or recovered by the Sage TTL).
      await recordCallOutcome({
        applicantId: applicant.id,
        outcome: "no_answer",
        notes: `dial failed: ${message.slice(0, 200)}`,
      });
    }
    stampAttempt(applicant, toNumber, {
      dryRun: false,
      testCall: Boolean(testNumber),
      failed: true,
    });
    logger.error("Outbound validation dial failed", {
      applicantId: applicant.id,
      error: message,
    });
    return { action: "dial_failed", applicantId: applicant.id, detail: message };
  }
}

/**
 * Expire in-flight calls that never produced a post-call webhook. Records
 * no_answer on Sage (bounded by its 3-attempt state machine) and marks the
 * local row expired.
 *
 * Idempotent under a failing Sage write: each stuck row is recorded on Sage
 * FIRST and only marked 'expired' once that succeeds. If recordCallOutcome
 * throws for a row, the row is left 'dialed' so the next sweep retries it,
 * rather than being stranded expired-but-never-recorded (which wedges the
 * applicant: the local row no longer re-queues and Sage never consumed the
 * attempt). The expire UPDATE is itself guarded on `status='dialed'` so a row
 * a concurrent webhook just completed is never clobbered to 'expired'.
 */
export async function sweepStuckCalls(): Promise<{ expired: number; failed: number }> {
  if (!isEnabled()) return { expired: 0, failed: 0 };
  // Select (don't mutate) the stuck rows; status flips only after Sage records.
  const stuck = await query(
    `SELECT id, applicant_id, conversation_id
       FROM outbound_validation_calls
      WHERE status = 'dialed'
        AND dialed_at < NOW() - ($1 || ' minutes')::interval`,
    [String(IN_FLIGHT_TIMEOUT_MINUTES)]
  );
  let expired = 0;
  let failed = 0;
  for (const row of stuck.rows) {
    try {
      await recordCallOutcome({
        applicantId: row.applicant_id as string,
        outcome: "no_answer",
        notes: `call result not received within ${IN_FLIGHT_TIMEOUT_MINUTES}m (conv:${row.conversation_id ?? "none"})`,
      });
    } catch (err) {
      // Leave the row 'dialed' so the next sweep retries; don't strand it expired.
      failed += 1;
      logger.error("Outbound validation sweep: outcome record failed (row left dialed for retry)", {
        applicantId: row.applicant_id,
        error: (err as Error).message,
      });
      continue;
    }
    // Sage recorded — now safe to retire the local row. Guard on still-'dialed'
    // so a concurrent post-call webhook that just completed it isn't reverted.
    await query(
      `UPDATE outbound_validation_calls
          SET status = 'expired', completed_at = NOW()
        WHERE id = $1 AND status = 'dialed'`,
      [row.id as string]
    );
    expired += 1;
  }
  if (expired > 0) {
    logger.warn("Outbound validation sweep expired stuck calls", { expired });
  }
  if (failed > 0) {
    logger.error("Outbound validation sweep: stuck calls left dialed after Sage failure", { failed });
  }
  return { expired, failed };
}
