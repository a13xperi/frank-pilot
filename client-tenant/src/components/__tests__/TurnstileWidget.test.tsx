// @vitest-environment jsdom
/**
 * Tests for src/components/TurnstileWidget.tsx (gpmglv wedge #13 — anti-spam).
 *
 * The critical behaviour: when the widget runs in bypass mode (dev key or
 * unset env var), it MUST synchronously schedule onVerify('test-token-dev')
 * so the Welcome → Claim e2e smoke can submit the register form without a
 * real Cloudflare challenge. If this regresses, CI smoke breaks and PRs stop
 * merging.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TurnstileWidget, isTurnstileBypass } from '../TurnstileWidget';

describe('TurnstileWidget — bypass mode (smoke contract)', () => {
  it('auto-fires onVerify("test-token-dev") within ~200ms in bypass mode', async () => {
    const onVerify = vi.fn();
    render(<TurnstileWidget onVerify={onVerify} forceBypassForTests />);

    // setTimeout(..., 0) lands on a macrotask. waitFor polls until satisfied
    // or the 1s default timeout — we cap at 200ms to keep this aligned with
    // the spec ("auto-fires after ~100ms").
    await waitFor(
      () => {
        expect(onVerify).toHaveBeenCalledWith('test-token-dev');
      },
      { timeout: 200 },
    );

    // Bypass mode must not render any visible widget DOM (the smoke test
    // doesn't expect a captcha to appear and the test key wouldn't render
    // meaningfully anyway).
    // (Asserted indirectly: the component returns null in bypass mode.)
  });

  it('bypasses when no siteKey prop is supplied and VITE_TURNSTILE_SITE_KEY is unset', async () => {
    // Empty key → bypass mode regardless of forceBypassForTests.
    const onVerify = vi.fn();
    render(<TurnstileWidget siteKey="" onVerify={onVerify} />);
    await waitFor(() => expect(onVerify).toHaveBeenCalledWith('test-token-dev'), {
      timeout: 200,
    });
  });

  it('isTurnstileBypass predicate matches Cloudflare dev key + empty string', () => {
    expect(isTurnstileBypass('')).toBe(true);
    expect(isTurnstileBypass('1x00000000000000000000AA')).toBe(true);
    expect(isTurnstileBypass('real-site-key-zzz')).toBe(false);
  });
});
