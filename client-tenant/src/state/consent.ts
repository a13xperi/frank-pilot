/**
 * Consent store (gpmglv wedge #15).
 *
 * Frank-Pilot collects sensitive applicant data (AMI tier, household
 * composition, income, identity). Affordable-housing tenants are a
 * protected class — privacy posture matters.
 *
 * Versus the gpmglv.com competitor:
 *   - gpmglv sets no observable cookies on crawl
 *   - gpmglv has a thin privacy policy
 *   - Frank-Pilot ships a real consent banner backed by this store
 *
 * Categories (GDPR-style):
 *   - essential — auth/session storage (frank_tenant_token). Can't be
 *                 disabled; the app simply doesn't work without it.
 *   - functional — language preference (i18nextLng) and similar
 *                  UX-personalisation storage.
 *   - analytics — usage instrumentation. Nothing wired today.
 *   - marketing — ad/conversion pixels. Off by default. Nothing wired today.
 *
 * Storage:
 *   - localStorage key `fp.consent.v1` (versioned so we can invalidate
 *     when categories change).
 *   - `recordedAt = null` means the user has not made a choice yet, so
 *     the banner should be shown.
 *
 * No external deps — uses React's `useSyncExternalStore` so we don't
 * pull in zustand for one tiny store.
 */

import { useSyncExternalStore } from 'react';

export const CONSENT_STORAGE_KEY = 'fp.consent.v1';

export type ConsentCategory = 'functional' | 'analytics' | 'marketing';

export interface ConsentState {
  /** Auth/session cookies — always on, can't be disabled. */
  essential: true;
  /** Language preference and similar UX personalisation. */
  functional: boolean | undefined;
  /** Usage instrumentation. */
  analytics: boolean | undefined;
  /** Ad/conversion pixels. Off by default. */
  marketing: boolean | undefined;
  /** ISO timestamp of when the user recorded their choice, or null. */
  recordedAt: string | null;
}

const INITIAL_STATE: ConsentState = {
  essential: true,
  functional: undefined,
  analytics: undefined,
  marketing: undefined,
  recordedAt: null,
};

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readFromStorage(): ConsentState {
  const ls = safeLocalStorage();
  if (!ls) return { ...INITIAL_STATE };
  try {
    const raw = ls.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return { ...INITIAL_STATE };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...INITIAL_STATE };
    return {
      essential: true,
      functional:
        typeof parsed.functional === 'boolean' ? parsed.functional : undefined,
      analytics:
        typeof parsed.analytics === 'boolean' ? parsed.analytics : undefined,
      marketing:
        typeof parsed.marketing === 'boolean' ? parsed.marketing : undefined,
      recordedAt:
        typeof parsed.recordedAt === 'string' && parsed.recordedAt
          ? parsed.recordedAt
          : null,
    };
  } catch {
    return { ...INITIAL_STATE };
  }
}

function writeToStorage(state: ConsentState): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full / private mode — best-effort.
  }
}

// ── Pub/sub store ────────────────────────────────────────────────────
let current: ConsentState = readFromStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Subscribe to consent state changes.  Exported so non-hook code (e.g.
 * `lib/analytics.ts` for the wedge #15 analytics gate) can react to the
 * user accepting/rejecting categories mid-session without subscribing via
 * React.  Returns an unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ConsentState {
  return current;
}

/**
 * Server-side snapshot for SSR / hydration — must be a stable identity
 * to satisfy React's `useSyncExternalStore` contract.
 */
const SERVER_SNAPSHOT: ConsentState = Object.freeze({ ...INITIAL_STATE });
function getServerSnapshot(): ConsentState {
  return SERVER_SNAPSHOT;
}

function setState(next: ConsentState): void {
  current = next;
  writeToStorage(next);
  emit();
}

// ── Actions ──────────────────────────────────────────────────────────

/** Accept all consent categories. Sets `recordedAt`. */
export function acceptAll(): void {
  setState({
    essential: true,
    functional: true,
    analytics: true,
    marketing: true,
    recordedAt: new Date().toISOString(),
  });
}

/**
 * Reject all non-essential categories. `essential` is still true (we
 * literally can't run the app without it). Sets `recordedAt` so the
 * banner stops showing.
 */
export function rejectAll(): void {
  setState({
    essential: true,
    functional: false,
    analytics: false,
    marketing: false,
    recordedAt: new Date().toISOString(),
  });
}

/** Update a single non-essential category. Sets `recordedAt`. */
export function setCategory(category: ConsentCategory, value: boolean): void {
  const next: ConsentState = {
    ...current,
    [category]: value,
    recordedAt: new Date().toISOString(),
  };
  setState(next);
}

/**
 * Wipe the recorded consent so the banner shows again. Used when the
 * user explicitly asks to revisit their choice from the footer link.
 */
export function clearAndReprompt(): void {
  setState({ ...INITIAL_STATE });
}

/**
 * Test-only helper. Re-reads from storage (useful when a test seeds
 * localStorage directly and wants the store to pick it up).
 */
export function _rehydrateForTests(): void {
  current = readFromStorage();
  emit();
}

// ── React hook ───────────────────────────────────────────────────────

export interface UseConsentResult extends ConsentState {
  /** True until the user has clicked Accept / Reject / Save. */
  needsChoice: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  setCategory: (category: ConsentCategory, value: boolean) => void;
  clearAndReprompt: () => void;
}

export function useConsent(): UseConsentResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...state,
    needsChoice: state.recordedAt === null,
    acceptAll,
    rejectAll,
    setCategory,
    clearAndReprompt,
  };
}

// Convenience export so non-hook code (e.g. i18n init) can query state
// without subscribing.
export function getConsentSnapshot(): ConsentState {
  return current;
}
