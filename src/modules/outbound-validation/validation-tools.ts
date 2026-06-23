import { logger } from "../../utils/logger";
import { recordVerifiedPhone } from "../caller-history/service";
import { TwilioService } from "../integrations/twilio";
import { normalizePhone } from "../voice-intake/service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";

/**
 * Phase 3 voice tools: `send_pin` + `verify_pin` — the SMS-verify keystone for
 * caller memory.
 *
 * Before Frank reads back anything we remembered about a caller, he has to
 * prove the person on the line controls the number on file. Mid-call he fires
 * `send_pin` → we text a one-time code to the E.164 phone; the caller reads it
 * back and the agent fires `verify_pin`. On a match the phone is a verified
 * channel for this conversation and the memory layer is allowed to speak.
 *
 * Backed by **Twilio Verify** (service TWILIO_VERIFY_SERVICE_SID). Twilio
 * generates the code, sends the SMS, and owns the code's TTL + attempt limits
 * server-side. This is deliberate: a raw `messages.create` from an unregistered
 * local 10-digit number is blocked by A2P 10DLC (error 30034), which is exactly
 * what killed the first cut. Verify is purpose-built for OTP and carrier-exempt,
 * so the code actually lands. We never see, generate, or store the code — there
 * is no PIN table and no local crypto anymore.
 *
 * Mirrors send-app-link.ts / verify-name.ts exactly:
 *   - same handler signature (parameters, context) => Promise<ToolCallbackResult>
 *   - one-time idempotent registration helper (registerValidationPinHandlers)
 *   - context.conversationId is authoritative; a conversation_id parameter is
 *     accepted as a belt-and-suspenders fallback only.
 *
 * SECURITY discipline:
 *   - the code is owned end-to-end by Twilio Verify; it never enters our DB,
 *     our logs, or our process memory.
 *   - phones are masked to last-4 in every log line; the full E.164 never logs.
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED with the
 * ok/handler outcome. We do NOT double-stamp.
 *
 * Returns ToolCallbackResult:
 *   send_pin   → { ok: true,  result: { sent: true }, message: 'Code sent.' } | { ok: false, message }
 *   verify_pin → { ok: true,  result: { matched: boolean }, message } | { ok: false, message }
 */

export async function sendPinHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const conversationId = resolveConversationId(parameters, context);
  const phone = normalizePhone(pickString(parameters, "phone_e164") ?? pickString(parameters, "phone"));

  if (!phone) {
    logger.warn("send_pin missing phone", { conversationId });
    return {
      ok: false,
      message: "I didn't catch your phone number. Can you say it once more, slowly?",
    };
  }

  const sms = await getTwilioService().startVerification(phone);
  if (!sms.sent) {
    logger.error("send_pin Verify not sent", {
      conversationId,
      phoneMasked: maskPhone(phone),
    });
    return {
      ok: false,
      message:
        "Sorry, I'm having trouble texting that code right now. Could you try again in a moment?",
    };
  }

  logger.info("send_pin issued", {
    conversationId,
    phoneMasked: maskPhone(phone),
  });

  return { ok: true, result: { sent: true }, message: "Code sent." };
}

export async function verifyPinHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const conversationId = resolveConversationId(parameters, context);
  const phone = normalizePhone(pickString(parameters, "phone_e164") ?? pickString(parameters, "phone"));
  const readBack = pickString(parameters, "read_back_pin") ?? pickString(parameters, "readBackPin");

  if (!phone) {
    logger.warn("verify_pin missing phone", { conversationId });
    return {
      ok: false,
      message: "I didn't catch your phone number. Can you say it once more, slowly?",
    };
  }
  if (!readBack) {
    logger.warn("verify_pin missing code", { conversationId, phoneMasked: maskPhone(phone) });
    return {
      ok: false,
      message: "I didn't catch the code. Can you read me those four digits again?",
    };
  }

  const { matched, exhausted } = await getTwilioService().checkVerification(phone, readBack);

  if (matched) {
    // Drop the verification receipt the caller-memory gate reads. Best-effort:
    // a failed write never blocks the caller — they're verified on the line.
    await recordVerifiedPhone(phone, conversationId);
    logger.info("verify_pin verified", {
      conversationId,
      phoneMasked: maskPhone(phone),
    });
    return { ok: true, result: { matched: true }, message: "Verified." };
  }

  logger.info("verify_pin mismatch", {
    conversationId,
    phoneMasked: maskPhone(phone),
    exhausted: Boolean(exhausted),
  });

  return {
    ok: true,
    result: { matched: false },
    message: exhausted
      ? "That code didn't match, and we've used up the tries. Let me text you a new one."
      : "That code didn't match. Can you read me those four digits once more?",
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * context.conversationId is the authoritative thread id (the dispatcher derives
 * it from the signed payload). A conversation_id parameter is accepted only as
 * a fallback when, somehow, the context value is empty.
 */
function resolveConversationId(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): string {
  return context.conversationId || pickString(parameters, "conversation_id") || "";
}

/**
 * Last-4-digits masking for log lines. Never log the full E.164. `null` phone
 * renders as "****".
 */
function maskPhone(phone: string | null): string {
  if (!phone || phone.length <= 4) return "****";
  return `***${phone.slice(-4)}`;
}

let twilioService: TwilioService | null = null;
function getTwilioService(): TwilioService {
  if (!twilioService) twilioService = new TwilioService();
  return twilioService;
}

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once; tests can also call it
 * after clearToolHandlersForTests() to re-wire.
 */
export function registerValidationPinHandlers(): void {
  if (registered) return;
  registerToolHandler("send_pin", sendPinHandler);
  registerToolHandler("verify_pin", verifyPinHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
