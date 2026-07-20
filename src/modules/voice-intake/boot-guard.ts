/**
 * Audit C3 boot-time guardrail: the in-call tools receiver refuses
 * static-header auth without a DEDICATED tool secret — no fallback to the
 * webhook HMAC secret, and equal values defeat the separation. Failing the
 * boot is preferable to serving 503s to every live tool call.
 *
 * Mirrors the Stripe boot-guard split (src/modules/payment/boot-guard.ts):
 * `check*` is pure and unit-tested; `assert*` is the side-effecty boot
 * adapter (console.error + process.exit) index.ts calls in production.
 */

export type VoiceToolSecretViolation = "missing" | "equals_webhook_secret";

export interface VoiceToolBootGuardResult {
  enabled: boolean;
  violation: VoiceToolSecretViolation | null;
}

export function checkVoiceToolSecretConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): VoiceToolBootGuardResult {
  if (env.VOICE_TOOLS_ENABLED !== "true") return { enabled: false, violation: null };
  if (!env.ELEVENLABS_TOOL_SECRET) return { enabled: true, violation: "missing" };
  if (env.ELEVENLABS_TOOL_SECRET === env.ELEVENLABS_WEBHOOK_SECRET) {
    return { enabled: true, violation: "equals_webhook_secret" };
  }
  return { enabled: true, violation: null };
}

/**
 * Boot-side adapter. Side-effecty (process.exit). Tests should drive
 * `checkVoiceToolSecretConfig` directly.
 */
export function assertVoiceToolSecretConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): void {
  const result = checkVoiceToolSecretConfig(env);
  if (!result.violation) return;
  console.error(
    "VOICE_TOOLS_ENABLED=true requires a dedicated ELEVENLABS_TOOL_SECRET (set, and distinct from ELEVENLABS_WEBHOOK_SECRET) in production"
  );
  process.exit(1);
}
