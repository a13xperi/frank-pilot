import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";
import {
  MAX_CALL_SECS,
  WRAP_REMAINING_SECS,
  SOFT_REMAINING_SECS,
  minutesPhrase,
  pickElapsed,
  classifyTime,
} from "./call-time-core";

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
 * The arithmetic lives in call-time-core (shared with the dispatch-layer nudge);
 * this handler just turns the phase into a spoken instruction so Frank knows
 * whether to keep going, land the current step, or wrap + schedule a follow-up.
 */

export async function checkCallTimeHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const elapsed = pickElapsed(parameters);

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

  const { phase, remainingSecs } = classifyTime(elapsed);
  const remaining = remainingSecs ?? 0;
  let message: string;

  if (phase === "wrap") {
    message =
      `You have ${minutesPhrase(remaining)} left before the line drops. ` +
      "Tell the caller you want to make sure you don't get cut off, then call schedule_followup to book a callback to continue — pass a checkpoint of exactly where you are in the process so you pick up right here — and wrap up warmly now. Do NOT start a new long step.";
  } else if (phase === "soft") {
    message =
      `Heads up — ${minutesPhrase(remaining)} left. ` +
      "Finish the current step and don't begin anything long. If what's left won't fit, offer to schedule a callback to continue.";
  } else {
    message = `Plenty of time — ${minutesPhrase(remaining)} left. Keep going.`;
  }

  return {
    ok: true,
    result: {
      elapsed_secs: Math.round(elapsed),
      remaining_secs: remaining,
      max_secs: MAX_CALL_SECS,
      phase,
      should_wrap: phase === "wrap",
    },
    message,
  };
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
