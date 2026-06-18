import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WIZARD_STEP_TO_GUIDED,
  reportCobrowseField,
  __resetCobrowseReporterForTests,
} from '../useCobrowseStep';

/**
 * Tier 1 guided co-pilot client reporter. We test the pure mapping + the
 * fire-and-forget posting contract (only step keys leave the browser; no-op
 * without the co-browse query params; deduped).
 */

const realFetch = global.fetch;

function setUrl(search: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(`https://portal.test/apply${search}`),
    writable: true,
  });
}

describe('WIZARD_STEP_TO_GUIDED', () => {
  it('maps wizard milestones to guided keys and leaves field steps to focus', () => {
    expect(WIZARD_STEP_TO_GUIDED['1']).toBe('contact');
    expect(WIZARD_STEP_TO_GUIDED.verify).toBe('verify_email');
    expect(WIZARD_STEP_TO_GUIDED['2']).toBe('address');
    expect(WIZARD_STEP_TO_GUIDED.payment).toBe('pay');
    expect(WIZARD_STEP_TO_GUIDED.confirm).toBe('submit');
    // Non-coached wizard steps are absent (Frank stays quiet on these).
    expect(WIZARD_STEP_TO_GUIDED.pick).toBeUndefined();
    expect(WIZARD_STEP_TO_GUIDED.claim).toBeUndefined();
  });
});

describe('reportCobrowseField', () => {
  beforeEach(() => {
    __resetCobrowseReporterForTests();
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('no-ops without the cobrowse query params', () => {
    setUrl('');
    reportCobrowseField('income');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts only the step key (never values) when in a co-browse session', () => {
    setUrl('?cobrowse=sess-1&vt=tok-abc');
    reportCobrowseField('income');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/cobrowse/sess-1/step');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ step: 'income', vt: 'tok-abc' });
  });

  it('dedupes repeated reports of the same field', () => {
    setUrl('?cobrowse=sess-1&vt=tok-abc');
    reportCobrowseField('ssn');
    reportCobrowseField('ssn');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
