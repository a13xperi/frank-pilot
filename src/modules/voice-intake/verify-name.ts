import { logger } from "../../utils/logger";
import { listApplicants } from "../outbound-validation/sage-client";
import { fuzzyMatchName, type RosterEntry } from "./name-matching";
import { normalizePhone } from "./service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Phase 0a voice tool: `verify_name`.
 *
 * Frank mishears surnames over the phone constantly ("Hamamona" for
 * "Hamomona"). Mid-call, after the caller spells their last name back, the
 * agent fires this tool with `{heard_name, spelled_last_name, phone?}`. We load
 * the GPM waitlist roster (full_name only — no other PII) from the Sage source
 * of truth, fuzzy-match against it, and hand the agent a confident
 * matched_name to read back — or, when confidence is low, a `needs_review`
 * flag so the agent asks the caller to confirm rather than guessing.
 *
 * Mirrors send-app-link.ts exactly:
 *   - same handler signature (parameters, context) => ToolCallbackResult
 *   - fail-closed behind VOICE_TOOLS_ENABLED (the dispatcher already 503s when
 *     disabled; this is belt-and-suspenders so a direct call also no-ops)
 *   - one-time idempotent registration helper
 *
 * Returns ToolCallbackResult:
 *   - { ok: true,  result: { matched_name, confidence, needs_review }, message }
 *   - { ok: false, message } when we can't run the match at all
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED with the
 * ok/handler outcome. We do NOT double-stamp.
 *
 * NO-PII discipline: only full_name leaves Sage here, and only the matched
 * name (which the caller just gave us) is returned. Phone is normalized for a
 * masked log line and never echoed.
 */

const HIGH_CONFIDENCE = 0.85; // at/above → confident, no human review needed

export async function verifyNameHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  if (process.env.VOICE_TOOLS_ENABLED !== "true") {
    return { ok: false, message: "Voice tools disabled" };
  }

  const heardName = pickString(parameters, "heard_name") ?? pickString(parameters, "heardName");
  const spelledLast =
    pickString(parameters, "spelled_last_name") ?? pickString(parameters, "spelledLastName");
  const phone = normalizePhone(pickString(parameters, "phone"));

  if (!heardName && !spelledLast) {
    logger.warn("verify_name missing name inputs", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I didn't catch your name. Could you say it once more, and spell your last name for me?",
    };
  }

  let roster: RosterEntry[];
  try {
    roster = (await listApplicants()).map((a) => ({ full_name: a.full_name }));
  } catch (err) {
    logger.error("verify_name roster load failed", {
      conversationId: context.conversationId,
      error: (err as Error).message,
    });
    return {
      ok: false,
      message: "Sorry, I couldn't pull up the list just now. Could you try again in a moment?",
    };
  }

  const { match, confidence } = fuzzyMatchName(heardName, spelledLast, roster);
  const matchedName = match ? match.full_name : null;
  const needsReview = !match || confidence < HIGH_CONFIDENCE;

  logger.info("verify_name matched", {
    conversationId: context.conversationId,
    matched: Boolean(match),
    confidence,
    needsReview,
    phoneMasked: maskPhone(phone),
  });

  if (!match) {
    return {
      ok: true,
      result: { matched_name: null, confidence, needs_review: true },
      message:
        "I'm not finding that name on our list yet — let's get you added. Can you tell me your full name once more?",
    };
  }

  return {
    ok: true,
    result: { matched_name: matchedName, confidence, needs_review: needsReview },
    message: needsReview
      ? `I think I have you as ${matchedName} — did I get that right?`
      : `Got it — ${matchedName}. Thanks for confirming.`,
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Last-4-digits masking for log lines. Never log the full E.164. `null` phone
 * (it's optional on this tool) renders as "****".
 */
function maskPhone(phone: string | null): string {
  if (!phone || phone.length <= 4) return "****";
  return `***${phone.slice(-4)}`;
}

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once; tests can also call it
 * after clearToolHandlersForTests() to re-wire.
 */
export function registerNameVerificationHandler(): void {
  if (registered) return;
  registerToolHandler("verify_name", verifyNameHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
