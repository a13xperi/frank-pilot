import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Re-import the module fresh after stubbing env so the module-scoped ENV_RAW
// object is rebuilt against the current import.meta.env snapshot.
async function loadFlags() {
  vi.resetModules();
  return await import('../flags');
}

describe('useFlag — env override mechanism', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('default-on flags (PROPERTY_DL2_ENABLED, MOBILE_APPLY_ENABLED)', () => {
    it('returns true when env var is unset (default-on)', async () => {
      const { useFlag } = await loadFlags();
      expect(useFlag('PROPERTY_DL2_ENABLED')).toBe(true);
      expect(useFlag('MOBILE_APPLY_ENABLED')).toBe(true);
    });

    it('returns false when env var is explicitly "false"', async () => {
      vi.stubEnv('VITE_PROPERTY_DL2_ENABLED', 'false');
      const { useFlag } = await loadFlags();
      expect(useFlag('PROPERTY_DL2_ENABLED')).toBe(false);
    });

    it('returns true for any non-"false" value (true, 1, garbage)', async () => {
      vi.stubEnv('VITE_PROPERTY_DL2_ENABLED', 'true');
      let mod = await loadFlags();
      expect(mod.useFlag('PROPERTY_DL2_ENABLED')).toBe(true);

      vi.stubEnv('VITE_PROPERTY_DL2_ENABLED', 'garbage');
      mod = await loadFlags();
      expect(mod.useFlag('PROPERTY_DL2_ENABLED')).toBe(true);
    });
  });

  describe('default-off flags (PAYMENT_WIZARD_ENABLED)', () => {
    it('returns false when env var is unset (default-off)', async () => {
      const { useFlag } = await loadFlags();
      expect(useFlag('PAYMENT_WIZARD_ENABLED')).toBe(false);
    });

    it('returns true ONLY when env var is exactly "true"', async () => {
      vi.stubEnv('VITE_PAYMENT_WIZARD_ENABLED', 'true');
      const { useFlag } = await loadFlags();
      expect(useFlag('PAYMENT_WIZARD_ENABLED')).toBe(true);
    });

    it('returns false for "false" or any non-"true" value', async () => {
      vi.stubEnv('VITE_PAYMENT_WIZARD_ENABLED', 'false');
      let mod = await loadFlags();
      expect(mod.useFlag('PAYMENT_WIZARD_ENABLED')).toBe(false);

      vi.stubEnv('VITE_PAYMENT_WIZARD_ENABLED', '1');
      mod = await loadFlags();
      expect(mod.useFlag('PAYMENT_WIZARD_ENABLED')).toBe(false);
    });
  });

  // Regression: `echo "true" | vercel env add` stores trailing newlines.
  describe('whitespace handling (Vercel CLI artifact)', () => {
    it('trims trailing newline before comparing — default-off flag', async () => {
      vi.stubEnv('VITE_PAYMENT_WIZARD_ENABLED', 'true\n');
      const { useFlag } = await loadFlags();
      expect(useFlag('PAYMENT_WIZARD_ENABLED')).toBe(true);
    });

    it('trims trailing newline before comparing — default-on flag', async () => {
      vi.stubEnv('VITE_PROPERTY_DL2_ENABLED', 'false\n');
      const { useFlag } = await loadFlags();
      expect(useFlag('PROPERTY_DL2_ENABLED')).toBe(false);
    });

    it('handles leading/trailing spaces and tabs', async () => {
      vi.stubEnv('VITE_PAYMENT_WIZARD_ENABLED', '  true  ');
      const { useFlag } = await loadFlags();
      expect(useFlag('PAYMENT_WIZARD_ENABLED')).toBe(true);
    });
  });
});
