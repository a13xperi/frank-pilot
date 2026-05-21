import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@/i18n';

// Node 25 + jsdom: localStorage exists but lacks .clear/.removeItem mutability.
// Replace with an in-memory shim that satisfies the Storage interface.
function memoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    clear() { store = {}; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    key(i) { return Object.keys(store)[i] ?? null; },
    removeItem(k) { delete store[k]; },
    setItem(k, v) { store[k] = String(v); },
  };
}
Object.defineProperty(window, 'localStorage', { value: memoryStorage(), writable: true });
Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), writable: true });

afterEach(() => {
  cleanup();
});
