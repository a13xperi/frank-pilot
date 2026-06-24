import { logger } from "../../utils/logger";
import { isWithinCallWindow } from "../outbound-validation/dialer";
import {
  claimNextDueFollowUp,
  markFollowUpDialed,
  buildContextPacket,
} from "./service";

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
  dynamicVariables: Record<string, string>
): Promise<{ conversationId: string | null; callSid: string | null }> {
  const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
  const agentId = process.env.FRANK_FOLLOWUP_AGENT_ID ?? "";
  const phoneNumberId = process.env.FRANK_FOLLOWUP_PHONE_NUMBER_ID ?? "";
  if (!apiKey || !agentId || !phoneNumberId) {
    throw new Error(
      "Follow-up callbacks not configured (ELEVENLABS_API_KEY / FRANK_FOLLOWUP_AGENT_ID / FRANK_FOLLOWUP_PHONE_NUMBER_ID)"
    );
  }
  const res = await fetch(`${ELEVENLABS_API}/convai/twilio/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: toNumber,
      conversation_initiation_client_data: { dynamic_variables: dynamicVariables },
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
function packetToDynamicVars(reason: string, packet: Awaited<ReturnType<typeof buildContextPacket>>): Record<string, string> {
  return {
    is_followup: "true",
    callback_reason: reason,
    caller_rapport: packet?.rapport ?? "",
    application_status: packet?.application?.status ?? "",
    open_followups: String(packet?.open_followups?.length ?? 0),
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
    const { conversationId } = await placeFollowupCallback(fu.phoneE164, packetToDynamicVars(fu.reason, packet));
    await markFollowUpDialed(fu.id, conversationId);
    logger.info("follow-up dialed", { id: fu.id, conversationId });
    return { action: "dialed", id: fu.id, conversationId };
  } catch (err) {
    const error = (err as Error).message;
    logger.error("follow-up dial failed", { id: fu.id, error });
    return { action: "dial_failed", id: fu.id, error };
  }
}
