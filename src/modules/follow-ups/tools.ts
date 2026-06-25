import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";
import {
  createFollowUp,
  getOpenFollowUpsByPhone,
  buildContextPacket,
} from "./service";
import { recordLedgerEntry } from "../relationship/ledger";

/**
 * Follow-up voice tools.
 *   schedule_followup  — Frank schedules a callback (bad time / DL2 not-yet-open /
 *                        needs info) instead of "a manager will call you back".
 *   get_followups      — read the caller's open loop.
 *   get_call_context   — the warm re-entry: who they are + where they stand +
 *                        their open follow-ups, so Frank picks up seamlessly.
 */

export async function scheduleFollowupHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phone = pickString(parameters, "phone_e164") ?? pickString(parameters, "phone");
  const reason = pickString(parameters, "reason") ?? "callback_requested";
  // A time-cutoff or "call me right back / in a few minutes" callback continues
  // right away — it isn't a "what day works" booking. Schedule it for now so the
  // dialer rings on its next tick, ignoring any time the LLM may have passed.
  const isImmediate = /cutoff|right now|right back|immediately|in a (minute|moment|sec|few)|shortly|soon/i.test(reason);
  let whenIso = pickString(parameters, "scheduled_for_iso") ?? pickString(parameters, "scheduled_for");
  if (isImmediate) whenIso = new Date().toISOString();
  // Guard against the LLM's date math — it has produced past/garbage timestamps
  // (e.g. a 2025 date for "9:44pm today"), which drop the callback into a dead
  // slot. If the given time is in the past or absurdly far out, fall back to now
  // so the dialer still rings; a correctly-parsed near-future time is kept as-is.
  if (whenIso) {
    const when = new Date(whenIso).getTime();
    const now = Date.now();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    if (Number.isNaN(when) || when < now - 60_000 || when > now + NINETY_DAYS) {
      logger.warn("schedule_followup got an unusable time — scheduling now", {
        conversationId: context.conversationId,
        given: whenIso,
      });
      whenIso = new Date().toISOString();
    }
  }
  const notes = pickString(parameters, "notes");
  // Structured "exactly where we are in the process" so the callback resumes
  // here instead of starting over (the call-time wrap path fills this).
  const checkpoint = pickString(parameters, "checkpoint");

  if (!phone) {
    return { ok: false, message: "I didn't catch your number — what's the best one for Frank to call you back on?" };
  }
  if (!whenIso) {
    return { ok: false, message: "When works best for the callback?" };
  }

  const fu = await createFollowUp({
    phoneE164: phone,
    reason,
    scheduledForIso: whenIso,
    voiceCallId: context.conversationId,
    notes,
    checkpoint,
    source: "voice_intake",
    // The caller asked Frank to call them back — that request IS the consent to
    // the outbound callback, so the auto-dialer may place it. (Frank only fires
    // this tool when offering/confirming a callback the caller wants.)
    consentOutbound: true,
  });
  if (!fu) {
    logger.warn("schedule_followup invalid input", { conversationId: context.conversationId });
    return { ok: false, message: "I couldn't get that time down — can you give me a day and time again?" };
  }

  void recordLedgerEntry({
    phoneE164: phone,
    eventType: "callback_scheduled",
    channel: "voice",
    direction: "outbound",
    summary: `Callback scheduled (${reason})`,
    ref: fu.id,
  });
  logger.info("schedule_followup created", { conversationId: context.conversationId, id: fu.id });
  return {
    ok: true,
    result: { followup_id: fu.id, scheduled_for: fu.scheduled_for },
    message: "Done — I've got Frank scheduled to call you back, and he'll have everything from today right in front of him. No more bouncing around.",
  };
}

export async function getFollowupsHandler(
  parameters: Record<string, unknown>,
  _context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phone = pickString(parameters, "phone_e164") ?? pickString(parameters, "phone");
  if (!phone) return { ok: false, message: "What number should I look up?" };
  const open = await getOpenFollowUpsByPhone(phone);
  return {
    ok: true,
    result: { open_followups: open },
    message: open.length
      ? `You've got ${open.length} callback${open.length > 1 ? "s" : ""} scheduled.`
      : "You don't have any callbacks scheduled right now.",
  };
}

export async function getCallContextHandler(
  parameters: Record<string, unknown>,
  _context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phone = pickString(parameters, "phone_e164") ?? pickString(parameters, "phone");
  if (!phone) return { ok: false, message: "What number should I pull up?" };
  const packet = await buildContextPacket(phone);
  if (!packet) return { ok: false, message: "I couldn't pull up that number." };

  const parts: string[] = [];
  if (packet.rapport) parts.push(packet.rapport);
  if (packet.application) parts.push(`application status: ${packet.application.status}`);
  if (packet.open_followups.length) parts.push(`${packet.open_followups.length} open callback(s)`);
  // Lead with where they left off so Frank resumes at the exact step.
  if (packet.resume_checkpoint) parts.unshift(`pick up exactly here — ${packet.resume_checkpoint}`);
  const summary = parts.length ? parts.join("; ") : "No prior history on this number.";

  return { ok: true, result: packet as unknown as Record<string, unknown>, message: summary };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

let registered = false;
export function registerFollowUpHandlers(): void {
  if (registered) return;
  registerToolHandler("schedule_followup", scheduleFollowupHandler);
  registerToolHandler("get_followups", getFollowupsHandler);
  registerToolHandler("get_call_context", getCallContextHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
