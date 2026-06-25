import { logger } from "../../utils/logger";
import { isWithinCallWindow } from "../outbound-validation/dialer";
import {
  claimNextDueFollowUp,
  markFollowUpDialed,
  buildContextPacket,
} from "./service";
import { recordLedgerEntry } from "../relationship/ledger";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

/**
 * Place a follow-up callback as FRANK (the inbound agent, with the funnel +
 * context tools) — not the validation outbound agent. Configurable so the
 * callback rides the right agent + caller-ID:
 *   FRANK_FOLLOWUP_AGENT_ID         (the frank-inbound agent)
 *   FRANK_FOLLOWUP_PHONE_NUMBER_ID  (the 725 line)
 * Throws if unset — combined with the FRANK_FOLLOWUP_ENABLED flag, the callback
 * loop stays fully dark until explicitly configured.
 */
export async function placeFollowupCallback(
  toNumber: string,
  dynamicVariables: Record<string, string>,
  firstMessageOverride?: string
): Promise<{ conversationId: string | null; callSid: string | null }> {
  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  const agentId = process.env.FRANK_FOLLOWUP_AGENT_ID ?? "";
  const phoneNumberId = process.env.FRANK_FOLLOWUP_PHONE_NUMBER_ID ?? "";
  if (!apiKey || !agentId || !phoneNumberId) {
    throw new Error(
      "Follow-up callbacks not configured (ELEVENLABS_API_KEY / FRANK_FOLLOWUP_AGENT_ID / FRANK_FOLLOWUP_PHONE_NUMBER_ID)"
    );
  }
  // Per-call first_message override opens Frank AS the caller with the specific
  // purpose (requires platform_settings.overrides...first_message=true on the
  // agent). Only set on calls that pass it, so inbound is unaffected.
  const cicd: Record<string, unknown> = { dynamic_variables: dynamicVariables };
  if (firstMessageOverride) {
    cicd.conversation_config_override = { agent: { first_message: firstMessageOverride } };
  }
  const res = await fetch(`${ELEVENLABS_API}/convai/twilio/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: toNumber,
      conversation_initiation_client_data: cicd,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`follow-up outbound-call failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as { conversation_id?: string; callSid?: string; call_sid?: string };
  return { conversationId: body.conversation_id ?? null, callSid: body.callSid ?? body.call_sid ?? null };
}

/** Flatten the context packet into dynamic variables Frank reads on the callback. */
function packetToDynamicVars(
  reason: string,
  packet: Awaited<ReturnType<typeof buildContextPacket>>,
  checkpoint?: string | null
): Record<string, string> {
  return {
    is_followup: "true",
    callback_reason: reason,
    caller_rapport: packet?.rapport ?? "",
    application_status: packet?.application?.status ?? "",
    open_followups: String(packet?.open_followups?.length ?? 0),
    // Exactly where the prior call left off — Frank opens the callback resuming
    // at this step (the claimed follow-up's checkpoint wins over the packet's).
    resume_checkpoint: checkpoint ?? packet?.resume_checkpoint ?? "",
  };
}

export type FollowupTickResult =
  | { action: "disabled" | "outside_window" | "queue_empty" }
  | { action: "no_consent"; id: string }
  | { action: "dialed"; id: string; conversationId: string | null }
  | { action: "dial_failed"; id: string; error: string };

/**
 * One follow-up tick: claim the next due callback, honor consent + the call
 * window, assemble the context packet, and dial it back as Frank. Mirrors
 * runDialerTick; flag-gated dark via FRANK_FOLLOWUP_ENABLED.
 */
export async function runFollowupTick(now: Date = new Date()): Promise<FollowupTickResult> {
  if (process.env.FRANK_FOLLOWUP_ENABLED !== "true") return { action: "disabled" };
  if (!isWithinCallWindow(now)) return { action: "outside_window" };

  const fu = await claimNextDueFollowUp();
  if (!fu) return { action: "queue_empty" };

  // Consent gate: never auto-dial a number that hasn't consented to outbound AI
  // calls. (Released back to pending so an operator can place it manually.)
  if (!fu.consentOutbound) {
    await markFollowUpDialed(fu.id, null);
    logger.warn("follow-up skipped — no outbound consent", { id: fu.id });
    return { action: "no_consent", id: fu.id };
  }

  try {
    const packet = await buildContextPacket(fu.phoneE164);
    const dvars = packetToDynamicVars(fu.reason, packet, fu.checkpoint);
    // Anti-fabrication (conv_2301): only assert an answer when research is APPROVED.
    // Otherwise the opener is honest ("following up"), never a "pulling it together"
    // placeholder that invites Frank to guess. The opener feeds the live call; the
    // *_purpose/ask vars feed the (templated) voicemail.
    const hasAnswer = fu.researchStatus === "approved" && !!fu.answer;
    const opener = hasAnswer
      ? `Hi, it's Frank calling you back with the information you asked for. ${fu.answer} Is there anything else I can help with?`
      : "Hi, it's Frank following up with you. How can I help?";
    dvars.caller_first_name = "there";
    dvars.callback_purpose = hasAnswer
      ? `I have the information you asked for. ${fu.answer}`
      : "I wanted to follow up with you.";
    dvars.callback_ask = hasAnswer
      ? "Call me back if you have any other questions."
      : "Call me back anytime and we'll take care of it.";
    const { conversationId } = await placeFollowupCallback(fu.phoneE164, dvars, opener);
    await markFollowUpDialed(fu.id, conversationId);
    // Record on the person's ledger of truth WHAT Frank called back to review, so
    // the operator sees "called back about ..." on the timeline — whether the
    // person answers or it goes to voicemail (Frank leaves a message naming the
    // same reason). Best-effort; never blocks the dial.
    void recordLedgerEntry({
      phoneE164: fu.phoneE164,
      eventType: "callback_placed",
      channel: "voice",
      direction: "outbound",
      summary: `Called back about ${fu.reason}`,
      ref: conversationId,
    });
    logger.info("follow-up dialed", { id: fu.id, conversationId });
    return { action: "dialed", id: fu.id, conversationId };
  } catch (err) {
    const error = (err as Error).message;
    logger.error("follow-up dial failed", { id: fu.id, error });
    return { action: "dial_failed", id: fu.id, error };
  }
}
