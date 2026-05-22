/**
 * BP-08 Stripe boot-time guardrail.
 *
 * Extracted to a pure function so it's unit-testable without booting the
 * Express app. The contract:
 *
 *   - If `STRIPE_LIVE_ENABLED !== "true"` → no-op. The existing PaymentService
 *     stub path stays valid; nothing in the BP-08 live route is reachable.
 *
 *   - If `STRIPE_LIVE_ENABLED === "true"` → the three required keys must be
 *     present AND must not be the `.env.example` placeholder values. Missing
 *     or placeholder keys cause `process.exit(1)`. Crashing at boot is
 *     preferable to silently issuing fake PaymentIntents or, much worse,
 *     accepting unsigned webhooks because the secret was empty.
 */

const PLACEHOLDERS = new Set([
  "",
  "sk_test_changeme",
  "sk_live_changeme",
  "whsec_changeme",
  "pk_test_changeme",
  "pk_live_changeme",
]);

const REQUIRED_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PUBLISHABLE_KEY",
] as const;

export type StripeRequiredKey = (typeof REQUIRED_KEYS)[number];

export interface StripeBootGuardResult {
  enabled: boolean;
  missing: StripeRequiredKey[];
}

export function checkStripeProdConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): StripeBootGuardResult {
  const enabled = env.STRIPE_LIVE_ENABLED === "true";
  if (!enabled) return { enabled: false, missing: [] };

  const missing = REQUIRED_KEYS.filter((k) => {
    const v = env[k];
    return v === undefined || PLACEHOLDERS.has(v);
  });

  return { enabled: true, missing };
}

/**
 * Boot-side adapter. Side-effecty (process.exit). Tests should drive
 * `checkStripeProdConfig` directly.
 */
export function assertStripeProdConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): void {
  const result = checkStripeProdConfig(env);
  if (!result.enabled) return;
  if (result.missing.length === 0) return;
  console.error(
    `STRIPE_LIVE_ENABLED=true but keys missing/placeholder: ${result.missing.join(", ")}`
  );
  process.exit(1);
}
