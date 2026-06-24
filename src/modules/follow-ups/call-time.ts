import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";

/**
 * check_call_time — gives Frank the clock he otherwise lacks.
 *
 * The LLM cannot track elapsed wall-clock time on its own. ElevenLabs DOES know
 * it: the reserved system dynamic variable `system__call_duration_secs` is
 * populated server-side on every (Twilio-bridged) call. We bind that variable
 * into THIS tool's `call_duration_secs` parameter — see
 * scripts/wire-checkcalltime.sh, which uses the same dynamic_variable binding
 * proven on send_pin/verify_pin (scripts/wire-callerid.sh) — so ElevenLabs
 * injects the live elapsed seconds and the LLM never guesses the number.
 *
 * The handler does the arithmetic deterministically (LLMs are weak at it) and
 * returns a phase + a spoken instruction so Frank knows whether to keep going,
 * start landing the current step, or wrap + schedule a follow-up before the cut.
 *
 * MAX_CALL_SECS MUST equal conversation_config.conversation.max_duration_seconds
 * on the agent (set by scripts/wire-callduration.sh). Both read one number via
 * FRANK_CALL_MAX_SECS so they can't drift — if you bump the cap, set the env.
 */
const MAX_CALL_SECS = numFromEnv("FRANK_CALL_MAX_SECS", 900);
/** Remaining-time threshold at which Frank must warn + schedule_followup + wrap. */
const WRAP_REMAINING_SECS = numFromEnv("FRANK_CALL_WRAP_SECS", 180);
/** Earlier heads-up: finish the current step, don't start anything long. */
const SOFT_REMAINING_SECS = numFromEnv("FRANK_CALL_SOFT_SECS", 300);

function numFromEnv(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function minutesPhrase(secs: number): string {
  const m = Math.round(secs / 60);
  if (m <= 0) return "less than a minute";
  return `about ${m} minute${m === 1 ? "" : "s"}`;
}

export async function checkCallTimeHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const elapsed =
    pickNumber(parameters, "call_duration_secs") ??
    pickNumber(parameters, "elapsed_secs") ??
    pickNumber(parameters, "system__call_duration_secs");

  // If the dynamic-variable binding didn't fill the elapsed value, fail SOFT —
  // never block the call on a missing clock. ok:true + 200 keeps ElevenLabs'
  // auto-disable budget intact (10 consecutive non-2xx disables the webhook).
  if (elapsed === null) {
    logger.warn("check_call_time missing elapsed seconds", {
      conversationId: context.conversationId,
    });
    return {
      ok: true,
      result: { phase: "unknown", should_wrap: false },
      message:
        "I couldn't read the call clock just now — keep going, but if it feels like we've been on a while, offer to schedule a quick callback so we don't get cut off.",
    };
  }

  const remaining = Math.max(0, MAX_CALL_SECS - elapsed);
  let phase: "ok" | "soft" | "wrap";
  let message: string;

  if (remaining <= WRAP_REMAINING_SECS) {
    phase = "wrap";
    message =
      `You have ${minutesPhrase(remaining)} left before the line drops. ` +
      "Tell the caller you want to make sure you don't get cut off, then call schedule_followup to book a callback to continue — pass a checkpoint of exactly where you are in the process so you pick up right here — and wrap up warmly now. Do NOT start a new long step.";
  } else if (remaining <= SOFT_REMAINING_SECS) {
    phase = "soft";
    message =
      `Heads up — ${minutesPhrase(remaining)} left. ` +
      "Finish the current step and don't begin anything long. If what's left won't fit, offer to schedule a callback to continue.";
  } else {
    phase = "ok";
    message = `Plenty of time — ${minutesPhrase(remaining)} left. Keep going.`;
  }

  return {
    ok: true,
    result: {
      elapsed_secs: Math.round(elapsed),
      remaining_secs: Math.round(remaining),
      max_secs: MAX_CALL_SECS,
      phase,
      should_wrap: phase === "wrap",
    },
    message,
  };
}

function pickNumber(parameters: Record<string, unknown>, key: string): number | null {
  const v = parameters[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

let registered = false;
export function registerCallTimeHandler(): void {
  if (registered) return;
  registerToolHandler("check_call_time", checkCallTimeHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}

export const __config = { MAX_CALL_SECS, WRAP_REMAINING_SECS, SOFT_REMAINING_SECS };
