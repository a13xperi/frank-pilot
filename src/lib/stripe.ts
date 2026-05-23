import Stripe from "stripe";

// Pinned in code so a Dashboard-side API-version flip doesn't silently change
// webhook payload shapes under us. Match the value to the installed SDK's
// LatestApiVersion when bumping `stripe` (currently stripe@^17.2.0).
export const STRIPE_API_VERSION = "2025-02-24.acacia" as const;

const PLACEHOLDER_SECRET_KEYS = new Set([
  "",
  "sk_test_changeme",
  "sk_live_changeme",
]);

let cached: Stripe | null = null;

/**
 * Memoised Stripe client. Reads STRIPE_SECRET_KEY at first call.
 *
 * Throws if the key is missing or still the `.env.example` placeholder. In
 * production the boot-time guard in src/index.ts catches this first; this is
 * defense-in-depth for dev paths that accidentally exercise the live code with
 * placeholder keys.
 */
export function getStripe(): Stripe {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (PLACEHOLDER_SECRET_KEYS.has(key)) {
    throw new Error(
      "STRIPE_SECRET_KEY missing or placeholder — refusing to create Stripe client"
    );
  }

  cached = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return cached;
}

/** Test helper — drops the memoised client so a different env can be applied. */
export function resetStripeClientForTests(): void {
  cached = null;
}
