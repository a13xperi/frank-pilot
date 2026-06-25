/**
 * frankVoiceBridge — a tiny decoupled channel so any surface (the housing chat,
 * an "I'm stuck" affordance, etc.) can hand off to the live Talk-to-Frank voice
 * call without prop-threading or a shared store. The TalkToFrankPill is the sole
 * listener; it owns the ElevenLabs session. This is the "tap Frank anywhere"
 * fail-safe rung: stuck in text → one tap → talking to Frank.
 *
 * Why an event, not context: the pill and the chat widget are independent
 * floating siblings mounted at the App root. A custom DOM event keeps them
 * decoupled (no shared provider) and is trivially testable.
 */
export const FRANK_START_VOICE_EVENT = 'frank:start-voice';

/** Ask the Talk-to-Frank pill to start a voice call (fire-and-forget). */
export function requestFrankVoice(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FRANK_START_VOICE_EVENT));
}

/** Subscribe the pill to voice-start requests. Returns an unsubscribe fn. */
export function onFrankVoiceRequest(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const fn = (): void => handler();
  window.addEventListener(FRANK_START_VOICE_EVENT, fn);
  return () => window.removeEventListener(FRANK_START_VOICE_EVENT, fn);
}

/**
 * Only offer the bridge when the voice pill can actually answer it (its flag is
 * on, or we're in test). Mirrors TalkToFrankPill's own gate so a stuck applicant
 * never sees a "Talk to Frank" button that leads nowhere.
 */
export function isVoicePillEnabled(): boolean {
  return (
    import.meta.env.VITE_ENABLE_VOICE_PILL === 'true' ||
    import.meta.env.MODE === 'test'
  );
}

/**
 * Does this message read like the person wants a human / is stuck? Deterministic
 * keyword match on the USER's own text (no answer-confidence guessing) so the
 * chat can proactively surface the voice hand-off when it matters most.
 */
const HUMAN_INTENT =
  /\bhuman\b|\bcall me\b|\bstuck\b|\bhelp me\b|\breal person\b|\b(talk|speak)\b[^.?!]*\b(person|someone|agent|rep|frank)\b/i;
export function wantsHuman(text: string): boolean {
  return HUMAN_INTENT.test(text);
}
