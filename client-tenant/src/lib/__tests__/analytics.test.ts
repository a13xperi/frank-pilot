import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We re-import the module fresh between tests so module-level state
// (`initialised`) resets correctly.
async function loadAnalytics() {
  vi.resetModules();
  return await import('../analytics');
}

// ── Consent store helpers ────────────────────────────────────────────────────
// We mock the consent store so tests don't depend on localStorage.

vi.mock('@/state/consent', () => {
  let analyticsConsent: boolean | undefined = undefined;
  const listeners = new Set<() => void>();

  return {
    getConsentSnapshot: () => ({ analytics: analyticsConsent }),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // test helpers (not exported by the real module, only used here)
    __setAnalyticsConsent: (v: boolean | undefined) => {
      analyticsConsent = v;
      for (const l of listeners) l();
    },
  };
});

// Grab the test helper from the mocked module
async function setAnalyticsConsent(v: boolean | undefined) {
  const mod = await import('@/state/consent');
  (mod as { __setAnalyticsConsent: (v: boolean | undefined) => void }).__setAnalyticsConsent(v);
}

describe('analytics — consent gate', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('initAnalytics()', () => {
    it('is a no-op when analytics consent is undefined (unset)', async () => {
      await setAnalyticsConsent(undefined);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { initAnalytics } = await loadAnalytics();

      initAnalytics();

      expect(console.info).not.toHaveBeenCalled();
    });

    it('is a no-op when analytics consent is false (rejected)', async () => {
      await setAnalyticsConsent(false);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { initAnalytics } = await loadAnalytics();

      initAnalytics();

      expect(console.info).not.toHaveBeenCalled();
    });

    it('initialises the plausible stub when consent is true and vendor = plausible', async () => {
      await setAnalyticsConsent(true);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { initAnalytics } = await loadAnalytics();

      initAnalytics();

      expect(console.info).toHaveBeenCalledWith('[analytics] plausible would init now');
    });

    it('is a no-op when vendor = none even if consent is true', async () => {
      await setAnalyticsConsent(true);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'none');
      const { initAnalytics } = await loadAnalytics();

      initAnalytics();

      expect(console.info).not.toHaveBeenCalled();
    });

    it('does not init twice if called multiple times', async () => {
      await setAnalyticsConsent(true);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { initAnalytics } = await loadAnalytics();

      initAnalytics();
      initAnalytics();

      expect(console.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('trackEvent()', () => {
    it('is a no-op before init (no consent)', async () => {
      await setAnalyticsConsent(undefined);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { trackEvent } = await loadAnalytics();

      trackEvent('page_view', { path: '/apply' });

      expect(console.info).not.toHaveBeenCalled();
    });

    it('logs event info after init with plausible', async () => {
      await setAnalyticsConsent(true);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { initAnalytics, trackEvent } = await loadAnalytics();

      initAnalytics();
      vi.mocked(console.info).mockClear(); // clear the init log

      trackEvent('page_view', { path: '/dashboard' });

      expect(console.info).toHaveBeenCalledWith(
        '[analytics] trackEvent',
        'page_view',
        { path: '/dashboard' },
      );
    });
  });

  describe('watchConsentAndInit()', () => {
    it('calls initAnalytics when consent changes to accepted', async () => {
      await setAnalyticsConsent(undefined);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { watchConsentAndInit } = await loadAnalytics();

      const unsubscribe = watchConsentAndInit();

      // Simulate user accepting analytics consent
      await setAnalyticsConsent(true);

      expect(console.info).toHaveBeenCalledWith('[analytics] plausible would init now');

      unsubscribe();
    });

    it('returns an unsubscribe function that stops future calls', async () => {
      await setAnalyticsConsent(undefined);
      vi.stubEnv('VITE_ANALYTICS_VENDOR', 'plausible');
      const { watchConsentAndInit } = await loadAnalytics();

      const unsubscribe = watchConsentAndInit();
      unsubscribe();

      // Even though consent is now accepted, unsubscribed so no init
      await setAnalyticsConsent(true);

      expect(console.info).not.toHaveBeenCalled();
    });
  });
});
