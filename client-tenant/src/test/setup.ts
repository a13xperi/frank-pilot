import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// Node 25's built-in `localStorage` shadows jsdom's and is missing methods
// like .getItem / .clear when run without --localstorage-file. Install a
// minimal in-memory polyfill so api/client + i18n behave normally.
function installLocalStorage() {
  const w: { localStorage?: Storage } =
    typeof window !== 'undefined' ? (window as unknown as { localStorage?: Storage }) : {};
  const probe = w.localStorage ?? (globalThis as unknown as { localStorage?: Storage }).localStorage;
  if (probe && typeof probe.getItem === 'function' && typeof probe.clear === 'function') return;

  const store = new Map<string, string>();
  const polyfill: Storage = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(k: string) { return store.has(k) ? store.get(k)! : null; },
    key(i: number) { return Array.from(store.keys())[i] ?? null; },
    removeItem(k: string) { store.delete(k); },
    setItem(k: string, v: string) { store.set(k, String(v)); },
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = polyfill;
  if (typeof window !== 'undefined') {
    try {
      Object.defineProperty(window, 'localStorage', { value: polyfill, configurable: true });
    } catch { /* ignore */ }
  }
}

installLocalStorage();

beforeEach(() => {
  installLocalStorage();
  try { localStorage.clear(); } catch { /* ignore */ }
  vi.restoreAllMocks();
});
