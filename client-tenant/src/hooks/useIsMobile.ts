/**
 * useIsMobile — reactive `matchMedia` hook tracking the Tailwind `md`
 * breakpoint (768px). Returns true when the viewport is < md (mobile).
 *
 * SSR-safe: returns `false` until first paint. Subscribes to viewport
 * changes so the wizard re-flows when the user rotates a tablet or
 * resizes a dev window.
 *
 * Lives outside `MobileApplyShell` so steps and tests can probe the
 * breakpoint without pulling in the whole shell.
 */
import { useEffect, useState } from 'react';

// Tailwind `md` breakpoint — must match the existing `lg:hidden` /
// `md:` literals already used across Apply.tsx and the step files.
const MOBILE_QUERY = '(max-width: 767.98px)';

export function useIsMobile(): boolean {
  // SSR / very-early-paint: assume desktop so the heavy mobile shell
  // doesn't flash on a fast network before matchMedia is available.
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Newer browsers — addEventListener; Safari ≤ 13 fallback shim is
    // unneeded since the dev portal targets ES2020.
    mql.addEventListener('change', handler);
    // Sync once on mount in case the SSR-shaped initial state was stale.
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export default useIsMobile;
