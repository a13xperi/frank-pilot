import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { TwilioService } from "../integrations/twilio";
import { pickField, normalizePhone, type PostCallPayload } from "./service";

/**
 * INBOUND post-call notifications (Phase 2).
 *
 * The shared post-call webhook receiver (signature verification, idempotency,
 * DLQ — see webhook.ts) stays the single front door. After the existing
 * `persistConversation` lands the intake row, the dispatcher hands events whose
 * agent_id matches the LIVE inbound agent (the 725 front desk) to
 * `handleInboundPostCall`, which fires two best-effort SMS:
 *
 *   1. TEAM ALERT — if the call is a Care-Line report (or otherwise high /
 *      emergency severity), text the on-call team a short alert so a human can
 *      pick it up. Sender = the 725 line (TWILIO_PHONE_NUMBER), recipient =
 *      TEAM_ALERT_NUMBER.
 *
 *   2. CALLER CALLBACK LINK — text the CALLER (their captured phone) a short
 *      message + a link to schedule a callback / book a time.
 *
 * Mirrors the OUTBOUND sibling (../outbound-validation/outcome.ts
 * handleOutboundPostCall) in shape: agent-id gate + a single best-effort side
 * effect that NEVER throws back into the webhook path (the caller invokes this
 * fire-and-forget with `.catch(log)`, and every branch in here is additionally
 * try/caught).
 *
 * EVERYTHING here is DARK by default behind FRANK_INBOUND_NOTIFY_ENABLED, with
 * a FRANK_INBOUND_NOTIFY_DRY_RUN that logs the exact SMS it WOULD send without
 * dialing Twilio — same rollout-gate style as FRANK_OUTBOUND_ENABLED /
 * FRANK_OUTBOUND_DRY_RUN.
 */

// The 725 front-desk inbound intake agent. The canonical env var is
// ELEVENLABS_AGENT_ID (already read by browser-session.ts); we fall back to the
// live agent id so a deploy that hasn't set the env still routes correctly
// (the notify side effects stay dark behind their own flag regardless).
const DEFAULT_INBOUND_AGENT_ID = "agent_8001ksp9ar8cf8ct2x70kacxr8qq";

// data_collection_results keys we read. ElevenLabs shapes each as
// {value, rationale, ...}; pickField() returns the trimmed string value.
const FIELD_INCIDENT_CATEGORY = "incident_category";
const FIELD_INCIDENT_SEVERITY = "incident_severity";
const FIELD_UNIT = "unit";
const FIELD_NAME = "name";
const FIELD_PHONE = "phone";
const FIELD_SUMMARY = "call_summary";

// Keyword fallbacks when the agent didn't populate the structured incident
// fields (older prompt / partial extraction). Matched case-insensitively
// against the call summary + the transcript text.
const CARE_KEYWORDS =
  /\b(maintenance|repair|leak|leaking|flood|water|noise|unsafe|broken|mold|pest|roach|infestation|no\s+(heat|hot\s+water|power|electric)|outage|gas\s+smell|smoke|fire|hazard|emergency|urgent)\b/i;
const URGENT_KEYWORDS =
  /\b(emergency|urgent|flood|flooding|gas\s+smell|smoke|fire|no\s+(heat|hot\s+water|power|electric)|unsafe|hazard|injur|danger)\b/i;

type Severity = "emergency" | "high" | "medium" | "low";

export interface InboundNotifyDecision {
  isCareReport: boolean;
  severity: Severity;
  category: string;
  unit: string;
  reporter: string;
  callerPhone: string | null;
  /** True when the team alert should fire (care report OR high/emergency). */
  shouldAlertTeam: boolean;
}

let twilioService: TwilioService | null = null;
function getTwilioService(): TwilioService {
  if (!twilioService) twilioService = new TwilioService();
  return twilioService;
}

/** Resolve the inbound intake agent id (env override, else the live default). */
function inboundAgentId(): string {
  return (process.env.ELEVENLABS_AGENT_ID || "").trim() || DEFAULT_INBOUND_AGENT_ID;
}

/**
 * True when this post-call event belongs to the LIVE inbound intake agent.
 * The outbound branch is matched FIRST in webhook.ts (isOutboundValidationEvent),
 * so by the time we get here an outbound event has already been routed away;
 * this is the positive match for the inbound front desk.
 */
export function isInboundIntakeEvent(payload: PostCallPayload): boolean {
  return Boolean(payload.agent_id) && payload.agent_id === inboundAgentId();
}

/** Concatenate the transcript turns into one lowercase blob for keyword scans. */
function transcriptText(payload: PostCallPayload): string {
  return (payload.transcript ?? [])
    .map((t) => t.message ?? "")
    .join(" ")
    .toLowerCase();
}

function normalizeSeverity(raw: string | null): Severity | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (/(emergenc|critical|life)/.test(v)) return "emergency";
  if (/(high|urgent|severe)/.test(v)) return "high";
  if (/(low|minor|routine|cosmetic)/.test(v)) return "low";
  if (/(med|moderate|normal)/.test(v)) return "medium";
  return null;
}

/**
 * Classify the call: is it a care/maintenance report, and how severe?
 *
 *   - Structured first: `incident_category` present ⇒ it's a care report.
 *     `incident_severity ∈ {high, emergency}` (normalized) ⇒ escalate.
 *   - Keyword fallback: if the structured fields are absent, scan the summary
 *     + transcript for maintenance/safety language; urgent language ⇒ high.
 *
 * Team alert fires when it's a care report OR severity is high/emergency.
 */
export function classifyInbound(payload: PostCallPayload): InboundNotifyDecision {
  const data = payload.analysis?.data_collection_results;

  const category = pickField(data, FIELD_INCIDENT_CATEGORY);
  const severityRaw = pickField(data, FIELD_INCIDENT_SEVERITY);
  const unit = pickField(data, FIELD_UNIT) ?? "unit n/a";
  const reporter = pickField(data, FIELD_NAME) ?? "caller";
  const callerPhone = normalizePhone(pickField(data, FIELD_PHONE));
  const summary = pickField(data, FIELD_SUMMARY) ?? "";

  const haystack = `${summary} ${transcriptText(payload)}`;

  // Care-report detection.
  const structuredCare = Boolean(category);
  const keywordCare = !structuredCare && CARE_KEYWORDS.test(haystack);
  const isCareReport = structuredCare || keywordCare;

  // Severity: structured value wins; else infer from urgent keywords.
  let severity: Severity = normalizeSeverity(severityRaw) ?? "medium";
  if (!severityRaw && URGENT_KEYWORDS.test(haystack)) severity = "high";

  const shouldAlertTeam =
    isCareReport || severity === "high" || severity === "emergency";

  return {
    isCareReport,
    severity,
    category: category ?? (isCareReport ? "general maintenance" : "general inquiry"),
    unit,
    reporter,
    callerPhone,
    shouldAlertTeam,
  };
}

/**
 * Build the booking / callback link the caller is texted.
 *
 * NOTE: there is no dedicated booking route in the app yet. We deep-link to the
 * tenant portal (same base the magic-link + doc-upload flows use,
 * TENANT_PORTAL_URL) with a `callback` intent + the conversation id so the
 * eventual page can self-link the request to this call.
 *
 * TODO(phase-2.1): replace with a real scheduling/booking route (e.g.
 * `/callback/new` backed by a callback_requests table, or a Cal.com/Calendly
 * embed) once the booking surface lands. The env override below lets ops point
 * at an external scheduler in the meantime without a code change.
 */
export function buildCallbackLink(conversationId: string): string {
  const explicit = (process.env.FRANK_CALLBACK_BOOKING_URL || "").trim();
  if (explicit) {
    const sep = explicit.includes("?") ? "&" : "?";
    return `${explicit}${sep}ref=${encodeURIComponent(conversationId)}`;
  }
  const base = process.env.TENANT_PORTAL_URL || "http://localhost:5174";
  return `${base}/callback?ref=${encodeURIComponent(conversationId)}`;
}

/** Compose the team alert SMS body. Severity is upper-cased for scannability. */
export function buildTeamAlertMessage(
  d: InboundNotifyDecision,
  conversationId: string
): string {
  const kind = d.isCareReport ? "care report" : "call";
  return (
    `Frank ${kind} (${d.severity.toUpperCase()}): ` +
    `${d.category} · ${d.unit} · ${d.reporter} · ${conversationId}`
  );
}

/** Last-4 masking — never log a full E.164. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `***${phone.slice(-4)}`;
}

function isEnabled(): boolean {
  return process.env.FRANK_INBOUND_NOTIFY_ENABLED === "true";
}

function isDryRun(): boolean {
  return process.env.FRANK_INBOUND_NOTIFY_DRY_RUN === "true";
}

/**
 * Fire the team alert (when warranted). Best-effort: swallow + log any failure.
 */
async function maybeAlertTeam(
  d: InboundNotifyDecision,
  conversationId: string
): Promise<void> {
  if (!d.shouldAlertTeam) return;

  const teamNumber = (process.env.TEAM_ALERT_NUMBER || "").trim();
  if (!teamNumber) {
    // Documented no-op: the flag is on but no recipient is configured.
    logger.warn("inbound-notify: TEAM_ALERT_NUMBER unset — team SMS skipped", {
      conversationId,
      severity: d.severity,
    });
    return;
  }

  const msg = buildTeamAlertMessage(d, conversationId);

  if (isDryRun()) {
    logger.info("inbound-notify[dry-run]: would send team alert", {
      conversationId,
      to: maskPhone(teamNumber),
      severity: d.severity,
      isCareReport: d.isCareReport,
      messagePreview: msg.slice(0, 80),
    });
    return;
  }

  try {
    const res = await getTwilioService().sendSMS(teamNumber, msg);
    void stampTape({
      kind: "VOICE_TOOL_INVOKED",
      actor: "inbound-post-call",
      sessionId: conversationId,
      payload: {
        tool: "team_care_alert",
        phase: "inbound_post_call",
        severity: d.severity,
        isCareReport: d.isCareReport,
        category: d.category,
        sent: res.sent,
      },
    });
    logger.info("inbound-notify: team alert sent", {
      conversationId,
      severity: d.severity,
      sent: res.sent,
    });
  } catch (err) {
    logger.error("inbound-notify: team alert failed", {
      conversationId,
      error: (err as Error).message,
    });
  }
}

/**
 * Text the caller a callback/booking link. Best-effort: swallow + log any
 * failure (a text failure must never affect the already-persisted intake).
 */
async function maybeTextCallerCallback(
  d: InboundNotifyDecision,
  conversationId: string
): Promise<void> {
  if (!d.callerPhone) {
    logger.info("inbound-notify: no caller phone on record — callback SMS skipped", {
      conversationId,
    });
    return;
  }

  const link = buildCallbackLink(conversationId);

  if (isDryRun()) {
    logger.info("inbound-notify[dry-run]: would text caller callback link", {
      conversationId,
      to: maskPhone(d.callerPhone),
      link,
    });
    return;
  }

  try {
    const res = await getTwilioService().notifyCallbackQueued(d.callerPhone, link);
    void stampTape({
      kind: "VOICE_TOOL_INVOKED",
      actor: "inbound-post-call",
      sessionId: conversationId,
      payload: {
        tool: "caller_callback_link",
        phase: "inbound_post_call",
        sent: res.sent,
      },
    });
    logger.info("inbound-notify: caller callback link sent", {
      conversationId,
      phoneMasked: maskPhone(d.callerPhone),
      sent: res.sent,
    });
  } catch (err) {
    logger.error("inbound-notify: caller callback link failed", {
      conversationId,
      error: (err as Error).message,
    });
  }
}

/**
 * Entry point wired into webhook.ts dispatch() AFTER persistConversation, for
 * inbound-agent events only. Dark behind FRANK_INBOUND_NOTIFY_ENABLED.
 *
 * Returns void and never throws — both side effects are independently
 * try/caught, and the caller invokes this fire-and-forget with `.catch(log)`.
 */
export async function handleInboundPostCall(payload: PostCallPayload): Promise<void> {
  if (!isEnabled()) {
    logger.info("inbound-notify: disabled (FRANK_INBOUND_NOTIFY_ENABLED off)", {
      conversationId: payload.conversation_id,
    });
    return;
  }

  const decision = classifyInbound(payload);
  logger.info("inbound-notify: classified post-call", {
    conversationId: payload.conversation_id,
    isCareReport: decision.isCareReport,
    severity: decision.severity,
    shouldAlertTeam: decision.shouldAlertTeam,
    hasCallerPhone: Boolean(decision.callerPhone),
    dryRun: isDryRun(),
  });

  // Run both side effects; never let one's failure stop the other.
  await Promise.allSettled([
    maybeAlertTeam(decision, payload.conversation_id),
    maybeTextCallerCallback(decision, payload.conversation_id),
  ]);
}

// Exposed for the unit harness — lets the spec exercise classification + body
// composition without spinning up Express or Twilio.
export const __test = {
  classifyInbound,
  buildTeamAlertMessage,
  buildCallbackLink,
  isInboundIntakeEvent,
};
