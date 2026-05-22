# Frank-Pilot tenant portal — Playwright harness

Autonomous Playwright-driven validation for the tenant portal. Lets you
write small per-feature `*.spec.ts` files and get the same debug bundle the
in-app camera button produces (PNG + qaBuffer JSON + rrweb replay) attached
to any failing test.

## Quick start

```bash
# 1) One-time install (downloads chromium ~150 MB)
cd client-tenant
npm install
npm run e2e:install

# 2) Run the suite
npm run e2e

# 3) Interactive runner (great for writing new scenarios)
npm run e2e:ui
```

`npm run e2e` invokes Playwright's webServer hook, which boots the full
stack via `npm run e2e:up` at the repo root. The hook is idempotent:
if Postgres / API / Vite are already running, it reuses them.

## Stack boot

`scripts/e2e-up.mjs` (repo root) does the following:

1. **Postgres** — reuses whatever is already listening on `:5432` (Homebrew /
   Postgres.app / Docker — any source works). Falls back to
   `docker compose up -d postgres` only if nothing is up. If neither
   Postgres nor Docker is present, the script exits with a clear message.
2. **Migrations** — schema is created from `src/db/schema.ts` on first run.
   On subsequent runs the schema is detected as initialized and only the
   delta migrations under `src/db/migrations/*.sql` are re-applied
   (idempotent — they use `CREATE … IF NOT EXISTS`).
3. **Seed** — `npm run seed` (always — fast, and ensures `applicantA@cdpc.test`
   plus the 17-property GPMG catalog exist).
4. **API** on `:3002` (`PORT=3002 NODE_ENV=development`).
5. **Vite** on `:5175` (defaults out of the way of the normal `npm run dev`
   on `:5174`; bind `--host 127.0.0.1` so the health probe doesn't trip
   over macOS's IPv6-only `localhost`).
6. Polls `/health` on the API and `/` on Vite before printing `READY`.

It exits when its child processes die. Hit `Ctrl-C` to tear everything
down (Postgres stays up — that's expected; it's long-lived).

**Auto-discovered DB connection.** When `DATABASE_URL` / `DB_USER` /
`.env` are all absent, the orchestrator points migrate + seed at
`localhost:5432`, database `frank_pilot`, user = current OS user. Override
any of those via the usual env vars to talk to a remote DB.

## Fixtures

Three pre-authenticated `Page` handles from `e2e/fixtures.ts`:

| Fixture | Identity | Lands on |
|---|---|---|
| `applicantPage` | fresh `qa+${Date.now()}@example.com`, registered + magic-link verified | `/apply?step=intent` |
| `seededApplicantPage` | `applicantA@cdpc.test`, past intent + claim | `/apply?step=checklist` |
| `agentPage` | `agent@cdpc.test` (staff) | `/dashboard` |

Use them like this:

```ts
import { test, expect } from "../fixtures";

test("bedroom filter narrows results", async ({ seededApplicantPage: page }) => {
  await page.goto("/discover");
  await page.getByTestId("chip-bedroom-2").click(); // chips use 'all'|'studio'|'1'|'2'|'3'
  await expect(page.getByTestId("result-count")).toContainText(/communit/);
});
```

## QA debug bundle on failure

`e2e/qaDrain.ts` is wired via `test.afterEach` in `fixtures.ts`. On any
non-passing test it grabs three files from the page and attaches them
to the Playwright HTML report (and writes them to `testInfo.outputDir`):

- **`*.json`** — last 25 fetches + JS errors + unhandled rejections (`qaBuffer`).
- **`*.replay.json`** — rrweb session-replay events, fully masked (inputs, `rr-mask`, `rr-block`, `[data-screenshot-exclude="1"]`).
- **`*.png`** — `html-to-image` snapshot of `document.body`.

Same shape as the camera-button bundle in `ScreenshotButton.tsx`. Open
`playwright-report/index.html` after a run to inspect them inline.

## Writing a new scenario

1. Drop a file under `e2e/scenarios/<feature>.spec.ts`.
2. Import `test, expect` from `../fixtures`.
3. Pick the lightest fixture that gives you the auth state you need.
4. Prefer `getByTestId` over text/role selectors — survives i18n + design churn.

## Adding a seeded fixture

`applicantA@cdpc.test` lives in `src/db/seed.ts`. Mirror that block to add
a `tenant`, `admin`, etc. — keep them additive so the smoke-apply CI gate
(`scripts/qa-apply-handoff.mjs`) stays untouched.

## Caveats

- **Single worker.** Tests share one DB; parallel writes race. Don't set `fullyParallel: true` until each test acquires its own application via API setup.
- **Single browser.** Chromium only. Mobile / WebKit projects are a follow-up.
- **DEV gating.** `window.__qa_drain` and the in-page magic-link `devLink` are gated by `import.meta.env.DEV` / `NODE_ENV === "development"`. Production bundles do not expose them.
- **No Supabase upload.** The drain writes to local disk only — never uploads to the `frank-qa-screenshots` bucket.
- **Token lift.** Auth lives in `localStorage` (`frank_tenant_token`). `signInViaDevMagicLink` lifts it onto the BrowserContext's `extraHTTPHeaders` so `page.request.*` calls authenticate the same way the SPA's `fetch` does.
- **Port choice.** Vite defaults to `:5175` to coexist with a normal `npm run dev` on `:5174`. Bump via `VITE_PORT=5174 npm run e2e:up` (and set `E2E_BASE_URL` to match) if you want to reuse the existing dev server.

## Follow-ups (not in this PR)

- `messaging.spec.ts` — needs a seeded application in `onboarded` status; mirror the seed-demo `Tomasz Kowalski` pattern under a stable email.
- Visual regression via `toHaveScreenshot()`.
- A `playwright-features` CI job that runs this suite on PRs.
- Migrating `scripts/qa-apply-handoff.mjs` into a `.spec.ts` under this harness.
