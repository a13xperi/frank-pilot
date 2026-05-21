# BP-03b — Client smoke tests

Vitest + @testing-library/react land with Lane A's BP-00 substrate. Once Lane A merges:

- `Position.test.tsx` — renders, shows position fallback when API fails, ES translation when `?lng=es`.
- `FasterList.test.tsx` — renders three option cards, each with working CTA route.
- `MagicLinkSent.test.tsx` — reads `?email=` from query, resend button calls `requestMagicLink`, error states render.

These tests are intentionally not authored yet because the test runner is not installed. The server-side tape stamp integration tests at `src/__tests__/tape/bp03b-stamps.test.ts` cover the compliance-critical behavior end-to-end (7 tests, all green).
