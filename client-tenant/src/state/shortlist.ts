/**
 * Shortlist store — the saved-property "wishlist" (feat/saved-shortlist).
 *
 * A guest's saves live server-side, keyed to an httpOnly `uh_guest` cookie
 * (set on first save, migrated onto the user on magic-link conversion). This
 * store is the in-memory mirror that keeps every UI affordance in sync:
 *
 *   - the ♥ SaveButton on each property card + the detail header
 *   - the saved-count badge in the /discover header
 *   - the /saved shortlist page
 *
 * Design mirrors `state/consent.ts`: a tiny pub/sub store consumed via
 * `useSyncExternalStore`, no zustand. We track the set of saved *slugs* (what
 * /discover renders by) so a heart can read its state in O(1) without
 * re-fetching. The first `useShortlist()` consumer triggers a one-shot
 * `GET /api/saved` load; saves/unsaves are optimistic and reconciled (or
 * rolled back) against the API result.
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  getShortlist,
  saveProperty,
  unsaveProperty,
} from '@/api/saved';

interface ShortlistStoreState {
  /** Set of saved property slugs — the source of truth for ♥ state. */
  slugs: Set<string>;
  /** True once the initial GET /api/saved has settled (success or failure). */
  loaded: boolean;
}

let state: ShortlistStoreState = { slugs: new Set(), loaded: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: ShortlistStoreState): void {
  state = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ShortlistStoreState {
  return state;
}

// Stable server snapshot for SSR / hydration (useSyncExternalStore contract).
const SERVER_SNAPSHOT: ShortlistStoreState = {
  slugs: new Set(),
  loaded: false,
};
function getServerSnapshot(): ShortlistStoreState {
  return SERVER_SNAPSHOT;
}

// ── One-shot load ─────────────────────────────────────────────────────
let loadStarted = false;

/**
 * Load the shortlist once per session. Idempotent — repeated calls after the
 * first are no-ops. Failures (e.g. no cookie yet, network) settle as an empty
 * loaded list rather than throwing; the UI just shows no saves.
 */
export async function ensureShortlistLoaded(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  try {
    const res = await getShortlist();
    const slugs = new Set<string>();
    for (const group of res.lists) {
      for (const item of group.items) slugs.add(item.propertySlug);
    }
    setState({ slugs, loaded: true });
  } catch {
    // No saves yet / unauthed guest with no cookie — treat as empty.
    setState({ slugs: new Set(), loaded: true });
  }
}

/** Force a re-fetch (used by the /saved page after destructive edits). */
export async function refreshShortlist(): Promise<void> {
  try {
    const res = await getShortlist();
    const slugs = new Set<string>();
    for (const group of res.lists) {
      for (const item of group.items) slugs.add(item.propertySlug);
    }
    setState({ slugs, loaded: true });
  } catch {
    setState({ slugs: new Set(), loaded: true });
  }
}

// ── Optimistic mutations ──────────────────────────────────────────────

function withSlug(slug: string, add: boolean): Set<string> {
  const next = new Set(state.slugs);
  if (add) next.add(slug);
  else next.delete(slug);
  return next;
}

/**
 * Optimistically add `slug` to the shortlist, then call the API. On failure
 * the optimistic add is rolled back. Returns true on success.
 */
export async function save(slug: string, listName?: string): Promise<boolean> {
  if (state.slugs.has(slug)) return true;
  setState({ ...state, slugs: withSlug(slug, true) });
  try {
    await saveProperty(slug, listName);
    return true;
  } catch {
    setState({ ...state, slugs: withSlug(slug, false) });
    return false;
  }
}

/**
 * Optimistically remove `slug`, then call the API. On failure the removal is
 * rolled back. Returns true on success.
 */
export async function unsave(slug: string, listName?: string): Promise<boolean> {
  if (!state.slugs.has(slug)) return true;
  setState({ ...state, slugs: withSlug(slug, false) });
  try {
    await unsaveProperty(slug, listName);
    return true;
  } catch {
    setState({ ...state, slugs: withSlug(slug, true) });
    return false;
  }
}

/** Test-only reset. */
export function _resetForTests(): void {
  loadStarted = false;
  setState({ slugs: new Set(), loaded: false });
}

// ── React hook ─────────────────────────────────────────────────────────

export interface UseShortlistResult {
  /** Set of saved property slugs. */
  savedSlugs: Set<string>;
  /** Number of saved properties. */
  count: number;
  /** True once the initial load has settled. */
  loaded: boolean;
  /** Whether a given slug is currently saved. */
  isSaved: (slug: string) => boolean;
  /** Optimistic save — returns true on success, false on rollback. */
  save: (slug: string, listName?: string) => Promise<boolean>;
  /** Optimistic unsave — returns true on success, false on rollback. */
  unsave: (slug: string, listName?: string) => Promise<boolean>;
  /** Force a re-fetch from the server. */
  refresh: () => Promise<void>;
}

export function useShortlist(): UseShortlistResult {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Kick the one-shot load on first mount of any consumer.
  useEffect(() => {
    void ensureShortlistLoaded();
  }, []);

  return {
    savedSlugs: snapshot.slugs,
    count: snapshot.slugs.size,
    loaded: snapshot.loaded,
    isSaved: (slug: string) => snapshot.slugs.has(slug),
    save,
    unsave,
    refresh: refreshShortlist,
  };
}
