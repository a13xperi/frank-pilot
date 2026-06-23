import crypto from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
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
 * `send_pin` → we text a one-time 4-digit code to the E.164 phone; the caller
 * reads it back and the agent fires `verify_pin`. On a match the phone is a
 * verified channel for this conversation and the memory layer is allowed to
 * speak.
 *
 * Mirrors send-app-link.ts / verify-name.ts exactly:
 *   - same handler signature (parameters, context) => Promise<ToolCallbackResult>
 *   - one-time idempotent registration helper (registerValidationPinHandlers)
 *   - context.conversationId is authoritative; a conversation_id parameter is
 *     accepted as a belt-and-suspenders fallback only.
 *
 * SECURITY discipline:
 *   - the PIN is NEVER stored in plaintext. We persist a per-row random salt
 *     and sha256(salt + ":" + pin) only.
 *   - verification is a CONSTANT-TIME compare (crypto.timingSafeEqual) against
 *     the recomputed salted hash — no early-exit string compare, no timing
 *     oracle on the code.
 *   - phones are masked to last-4 in every log line; the full E.164 and the
 *     code never hit the logs.
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED with the
 * ok/handler outcome. We do NOT double-stamp.
 *
 * Returns ToolCallbackResult:
 *   send_pin   → { ok: true,  message: 'Code sent.' } | { ok: false, message }
 *   verify_pin → { ok: true,  result: { matched: boolean }, message } | { ok: false, message }
 */

const PIN_TTL_MINUTES = 10;
const DEFAULT_MAX_ATTEMPTS = 5;

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

  // 4-digit code, uniformly distributed across the full 0000-9999 range.
  // randomInt is cryptographically strong and avoids modulo bias.
  const pin = String(crypto.randomInt(0, 10000)).padStart(4, "0");
  const salt = crypto.randomBytes(16).toString("hex");
  const pinHash = hashPin(salt, pin);
  const expiresAt = new Date(Date.now() + PIN_TTL_MINUTES * 60 * 1000);

  await query(
    `INSERT INTO validation_pins (
       phone_e164, conversation_id, pin_hash, pin_salt,
       status, attempt_count, max_attempts, expires_at
     )
     VALUES ($1, $2, $3, $4, 'pending', 0, $5, $6)`,
    [phone, conversationId, pinHash, salt, DEFAULT_MAX_ATTEMPTS, expiresAt]
  );

  const sms = await getTwilioService().sendSMS(
    phone,
    `Your Frank verification code is ${pin}. Read it back when Frank asks.`
  );
  if (!sms.sent) {
    logger.error("send_pin SMS not sent", {
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

  // Latest pending, non-expired row for this phone. Newest first so a re-sent
  // code supersedes an earlier one; the WHERE clause fails closed on expiry.
  const found = await query(
    `SELECT id, pin_hash, pin_salt, attempt_count, max_attempts
       FROM validation_pins
      WHERE phone_e164 = $1
        AND status = 'pending'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone]
  );

  if (found.rows.length === 0) {
    logger.info("verify_pin no live code", {
      conversationId,
      phoneMasked: maskPhone(phone),
    });
    return {
      ok: true,
      result: { matched: false },
      message: "I don't have a live code for that number. Want me to text you a fresh one?",
    };
  }

  const row = found.rows[0];
  const matched = verifyPinHash(row.pin_salt as string, readBack, row.pin_hash as string);

  if (matched) {
    await query(
      `UPDATE validation_pins
          SET status = 'verified', verified_at = NOW()
        WHERE id = $1`,
      [row.id]
    );
    logger.info("verify_pin verified", {
      conversationId,
      phoneMasked: maskPhone(phone),
    });
    return { ok: true, result: { matched: true }, message: "Verified." };
  }

  // Miss: burn an attempt. When the bumped count reaches max_attempts, retire
  // the row so a brute-force can't keep guessing the same code.
  const attemptCount = Number(row.attempt_count) + 1;
  const maxAttempts = Number(row.max_attempts) || DEFAULT_MAX_ATTEMPTS;
  const exhausted = attemptCount >= maxAttempts;

  await query(
    `UPDATE validation_pins
        SET attempt_count = attempt_count + 1,
            status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'failed' ELSE status END
      WHERE id = $1`,
    [row.id]
  );

  logger.info("verify_pin mismatch", {
    conversationId,
    phoneMasked: maskPhone(phone),
    attemptCount,
    exhausted,
  });

  return {
    ok: true,
    result: { matched: false },
    message: exhausted
      ? "That code didn't match, and we've used up the tries. Let me text you a new one."
      : "That code didn't match. Can you read me those four digits once more?",
  };
}

/**
 * Salted sha256 of a PIN. Salt is per-row so two callers with the same code
 * never share a hash, and a leaked table can't be rainbow-tabled.
 */
function hashPin(salt: string, pin: string): string {
  return crypto.createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

/**
 * Constant-time comparison of a read-back PIN against the stored salted hash.
 * timingSafeEqual requires equal-length buffers; sha256 hex is always 64 chars
 * so the recomputed and stored digests match width by construction.
 */
function verifyPinHash(salt: string, readBack: string, storedHash: string): boolean {
  const candidate = hashPin(salt, readBack);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
