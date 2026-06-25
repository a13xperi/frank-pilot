import { logger } from "../../utils/logger";
import { createFollowUp } from "../follow-ups/service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * `escalate_to_support` — the HUMAN fail-safe rung of the onboarding ladder
 * ("if you're still stuck, a real person calls you").
 *
 * When a caller asks for a person, or Frank judges they're stuck after the
 * in-app and call-back rungs, this durably records a human-escalation follow-up
 * (so the escalations-watcher / ops queue picks it up and a real person calls
 * back) and logs a structured alert. Consent is implied — the caller asked.
 *
 * Reuse, not rebuild: the durable record is a `follow_ups` row via
 * createFollowUp() — same spine the callback dialer already drains. We keep the
 * `reason` a valid follow_ups value (`callback_requested`) and carry the
 * human-escalation marker in `source` + `notes`, so NO migration is needed.
 *
 * The human notify is a LOGGING seam today (mirrors the work-order
 * LoggingWorkOrderNotifier in scheduler.ts): a structured WARN that the
 * escalations-watcher / on-call tooling consumes. A live channel (Telegram/SMS)
 * is a separate, flag-gated change — the durable follow_up row is the source of
 * truth regardless.
 *
 * PII discipline: the recorded reason is a fixed categorical (never the caller's
 * free-text), so no personal detail lands in the row or the log.
 */

const ALLOWED_REASONS = new Set([
  "caller_requested_human",
  "stuck_after_retries",
  "accessibility",
  "complex_situation",
  "other",
]);

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const v = parameters[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Coerce any inbound reason to a safe categorical — never echo free-text PII. */
function normalizeReason(raw: string | null): string {
  const r = (raw ?? "").toLowerCase().replace(/[^a-z_]+/g, "_").replace(/^_+|_+$/g, "");
  return ALLOWED_REASONS.has(r) ? r : "caller_requested_human";
}

export async function escalateToSupportHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phone = pickString(parameters, "phone_e164") ?? pickString(parameters, "phone");
  const reason = normalizeReason(pickString(parameters, "reason"));
  const checkpoint = pickString(parameters, "checkpoint");

  if (!phone) {
    logger.warn("escalate_to_support missing phone", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I want to get a real person to call you back. What's the best number to reach you at?",
    };
  }

  const follow = await createFollowUp({
    phoneE164: phone,
    // Stays a valid follow_ups reason; the human-escalation marker lives in
    // source + notes so the dialer drains it like any callback.
    reason: "callback_requested",
    scheduledForIso: new Date().toISOString(),
    voiceCallId: context.conversationId,
    consentOutbound: true,
    source: "voice_intake_escalation",
    notes: `human_escalation: ${reason}`,
    checkpoint: checkpoint ?? null,
  });

  if (!follow) {
    logger.error("escalate_to_support createFollowUp returned null", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I'm having a little trouble on my end. Let me try that again, can you stay on the line a moment?",
    };
  }

  // Human notify seam (logging-only today; escalations-watcher consumes this +
  // the follow_ups row). No PII — categorical reason + ids only.
  logger.warn("HUMAN_ESCALATION queued", {
    followUpId: follow.id,
    conversationId: context.conversationId,
    reason,
    source: "voice_intake_escalation",
  });

  return {
    ok: true,
    result: { escalated: true, follow_up_id: follow.id },
    message:
      "Okay, I'm getting a real person to call you back. You're not on your own. Hang tight, someone will reach out shortly.",
  };
}

let registered = false;
/** Idempotent boot registration (mirrors registerVoiceToolHandlers). */
export function registerEscalationHandler(): void {
  if (registered) return;
  registerToolHandler("escalate_to_support", escalateToSupportHandler);
  registered = true;
}

/** Test-only: allow re-registration after clearToolHandlersForTests(). */
export function __resetRegistrationForTests(): void {
  registered = false;
}
