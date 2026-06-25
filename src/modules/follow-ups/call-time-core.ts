/**
 * call-time-core — pure call-clock math, no I/O and NO imports from voice-intake.
 *
 * Leaf module so both the check_call_time handler (call-time.ts) and the tool
 * dispatch layer (voice-intake/tool-callbacks.ts) can share the arithmetic
 * without a circular import (call-time.ts ↔ tool-callbacks.ts).
 *
 * The clock itself comes from ElevenLabs' reserved system dynamic variable
 * system__call_duration_secs, bound into each tool's params server-side
 * (scripts/wire-checkcalltime.sh + wire-timenudge.sh). The LLM can't track
 * elapsed time and EL won't speak a cap message, so every tool call carries the
 * live seconds and we do the arithmetic deterministically here.
 *
 * FRANK_CALL_MAX_SECS MUST equal conversation_config.conversation.max_duration_seconds
 * on the agent (scripts/wire-callduration.sh) so the two never drift.
 */

export const MAX_CALL_SECS = numFromEnv("FRANK_CALL_MAX_SECS", 900);
/** Remaining-time threshold at which Frank must warn + schedule_followup + wrap. */
export const WRAP_REMAINING_SECS = numFromEnv("FRANK_CALL_WRAP_SECS", 180);
/** Earlier heads-up: finish the current step, don't start anything long. */
export const SOFT_REMAINING_SECS = numFromEnv("FRANK_CALL_SOFT_SECS", 300);

export function numFromEnv(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function minutesPhrase(secs: number): string {
  const m = Math.round(secs / 60);
  if (m <= 0) return "less than a minute";
  return `about ${m} minute${m === 1 ? "" : "s"}`;
}

function pickNumber(parameters: Record<string, unknown>, key: string): number | null {
  const v = parameters[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Live elapsed seconds from whichever clock key the tool carried (or null). */
export function pickElapsed(parameters: Record<string, unknown>): number | null {
  return (
    pickNumber(parameters, "call_duration_secs") ??
    pickNumber(parameters, "elapsed_secs") ??
    pickNumber(parameters, "system__call_duration_secs")
  );
}

export type TimePhase = "ok" | "soft" | "wrap" | "unknown";

/** Deterministic phase + remaining for a given elapsed (null elapsed ⇒ unknown). */
export function classifyTime(elapsed: number | null): { phase: TimePhase; remainingSecs: number | null } {
  if (elapsed === null) return { phase: "unknown", remainingSecs: null };
  const remaining = Math.max(0, MAX_CALL_SECS - elapsed);
  if (remaining <= WRAP_REMAINING_SECS) return { phase: "wrap", remainingSecs: Math.round(remaining) };
  if (remaining <= SOFT_REMAINING_SECS) return { phase: "soft", remainingSecs: Math.round(remaining) };
  return { phase: "ok", remainingSecs: Math.round(remaining) };
}

/**
 * Piggyback time nudge: given ANY tool's parameters, if they carry the live call
 * clock and we're inside the soft/wrap window, return a compact wrap instruction
 * to append to that tool's result message. Returns null when there's no clock or
 * there's plenty of time, so the dispatch layer only nudges when it matters.
 *
 * Coverage net for the in-call warning: EL won't speak a cap message and the LLM
 * won't watch a passive prompt clock, but whenever Frank calls a tool late in
 * the call he now sees "wrap up + offer a callback" for free, no extra round
 * trip. (Pure-Q&A tails that call no tool remain a gap — the durable prompt
 * cadence rule + the post-call auto-callback cover those.)
 */
export function computeTimeNudge(
  parameters: Record<string, unknown>
): { phase: "soft" | "wrap"; remainingSecs: number; message: string } | null {
  const { phase, remainingSecs } = classifyTime(pickElapsed(parameters));
  if (phase === "wrap" && remainingSecs !== null) {
    return {
      phase,
      remainingSecs,
      message:
        `(Time check: ${minutesPhrase(remainingSecs)} left before the call cuts off. ` +
        "Wrap up now: tell the caller you don't want to get cut off and you'll call them right back to finish, then call schedule_followup with a checkpoint of exactly where you are. Don't start anything new.)",
    };
  }
  if (phase === "soft" && remainingSecs !== null) {
    return {
      phase,
      remainingSecs,
      message:
        `(Time check: ${minutesPhrase(remainingSecs)} left. Finish the current step and keep it tight; ` +
        "if what's left won't fit, offer to call them back to continue.)",
    };
  }
  return null;
}
