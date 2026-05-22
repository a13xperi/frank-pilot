// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  acceptAll,
  rejectAll,
  setCategory,
  clearAndReprompt,
  getConsentSnapshot,
  _rehydrateForTests,
} from '../consent';

describe('consent store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    _rehydrateForTests();
  });

  it('uses storage key fp.consent.v1', () => {
    expect(CONSENT_STORAGE_KEY).toBe('fp.consent.v1');
  });

  it('starts with recordedAt=null (banner should show)', () => {
    const s = getConsentSnapshot();
    expect(s.recordedAt).toBeNull();
    expect(s.essential).toBe(true);
    expect(s.functional).toBeUndefined();
    expect(s.analytics).toBeUndefined();
    expect(s.marketing).toBeUndefined();
  });

  it('acceptAll() turns every category on and records timestamp', () => {
    acceptAll();
    const s = getConsentSnapshot();
    expect(s.essential).toBe(true);
    expect(s.functional).toBe(true);
    expect(s.analytics).toBe(true);
    expect(s.marketing).toBe(true);
    expect(s.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('acceptAll() persists to localStorage', () => {
    acceptAll();
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.functional).toBe(true);
    expect(parsed.essential).toBe(true);
    expect(typeof parsed.recordedAt).toBe('string');
  });

  it('rejectAll() leaves essential on but turns others off', () => {
    rejectAll();
    const s = getConsentSnapshot();
    expect(s.essential).toBe(true);
    expect(s.functional).toBe(false);
    expect(s.analytics).toBe(false);
    expect(s.marketing).toBe(false);
    expect(s.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('setCategory updates a single category and records', () => {
    setCategory('analytics', true);
    expect(getConsentSnapshot().analytics).toBe(true);
    expect(getConsentSnapshot().functional).toBeUndefined();
    expect(getConsentSnapshot().recordedAt).not.toBeNull();
  });

  it('clearAndReprompt resets state so banner shows again', () => {
    acceptAll();
    expect(getConsentSnapshot().recordedAt).not.toBeNull();
    clearAndReprompt();
    expect(getConsentSnapshot().recordedAt).toBeNull();
    expect(getConsentSnapshot().functional).toBeUndefined();
  });

  it('rehydrates from pre-seeded localStorage (smoke-guard pattern)', () => {
    const seeded = {
      essential: true,
      functional: true,
      analytics: false,
      marketing: false,
      recordedAt: '2026-05-22T00:00:00.000Z',
    };
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(seeded));
    _rehydrateForTests();
    const s = getConsentSnapshot();
    expect(s.functional).toBe(true);
    expect(s.analytics).toBe(false);
    expect(s.recordedAt).toBe('2026-05-22T00:00:00.000Z');
  });

  it('ignores malformed localStorage gracefully', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'not-json{');
    _rehydrateForTests();
    expect(getConsentSnapshot().recordedAt).toBeNull();
  });
});
