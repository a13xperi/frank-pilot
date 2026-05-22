/**
 * Analytics initialisation gate (gpmglv wedge #15 — deferred work).
 *
 * Analytics is consent-gated: `initAnalytics()` is a no-op unless the user
 * has accepted the `analytics` consent category.  Calling it on every consent
 * change (via the `useEffect` in App.tsx) means a user who accepts after page
 * load gets instrumented without a reload.
 *
 * Vendor selection is controlled by `VITE_ANALYTICS_VENDOR`.  Currently only
 * `'plausible'` and `'none'` (default) are handled.  Add new cases here when
 * a tracker is adopted — consent gating stays in place automatically.
 */

import { getConsentSnapshot, subscribe } from '@/state/consent';

type Vendor = 'plausible' | 'none';

let initialised = false;

function resolveVendor(): Vendor {
  const raw = (import.meta.env.VITE_ANALYTICS_VENDOR ?? 'none').trim();
  if (raw === 'plausible') return 'plausible';
  return 'none';
}

/**
 * Initialise the analytics vendor, but only when the user has accepted the
 * `analytics` consent category.  Safe to call multiple times — subsequent
 * calls after a successful init are no-ops.
 */
export function initAnalytics(): void {
  const consent = getConsentSnapshot();
  if (consent.analytics !== true) return;
  if (initialised) return;

  const vendor = resolveVendor();
  switch (vendor) {
    case 'plausible':
      // When a real Plausible snippet is added, replace this stub with the
      // actual script-injection / `window.plausible` setup.
      console.info('[analytics] plausible would init now');
      initialised = true;
      break;
    case 'none':
    default:
      // No vendor configured — intentional no-op.
      break;
  }
}

/**
 * Track a named event with optional properties.
 *
 * No-ops silently if analytics was never initialised (vendor = 'none', or
 * the user has not accepted analytics).
 */
export function trackEvent(
  name: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (!initialised) return;

  const vendor = resolveVendor();
  switch (vendor) {
    case 'plausible':
      // Replace with `window.plausible(name, { props })` once the real
      // snippet is injected.
      console.info('[analytics] trackEvent', name, props);
      break;
    default:
      break;
  }
}

/**
 * Subscribe to consent changes so analytics is initialised as soon as the
 * user accepts, without requiring a page reload.  Returns an unsubscribe fn.
 *
 * Called once from App.tsx; exported for testing.
 */
export function watchConsentAndInit(): () => void {
  return subscribe(() => {
    initAnalytics();
  });
}
