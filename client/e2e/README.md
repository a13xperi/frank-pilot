# PM Console E2E (Playwright)

End-to-end tests for the staff / PM console ("CDPC Compliance Hub").

## Running

```bash
cd client
npm install
npm run e2e:install   # one-time: download the chromium browser
npm run e2e           # boots the full stack + this app, runs the suite
npm run e2e:ui        # interactive UI mode
```

`npm run e2e` boots two servers automatically (both idempotent — they reuse
anything already listening):

1. **Backend stack** via the repo-root `npm run e2e:up` — Postgres (Docker or a
   local install on :5432) + `migrate` + `seed` + the Express API on **:3002**.
2. **This console's Vite dev server** on **:5176** (proxies `/api` → :3002).

Ports are chosen so the harness coexists with a normal `npm run dev` (:5173)
and the tenant-portal e2e harness (:5175).

### Against a deployed environment

```bash
E2E_BASE_URL=https://frank-pilot-client.vercel.app npm run e2e
```

Setting `E2E_BASE_URL` skips the local server boot. The target must share the
seed accounts and reach the same API.

## Auth

Seed accounts (password `password123`), one per RBAC tier:

| Email                | Role             | Fixture        |
| -------------------- | ---------------- | -------------- |
| `agent@cdpc.test`    | leasing_agent    | `agentPage`    |
| `senior@cdpc.test`   | senior_manager   | `seniorPage`   |
| `regional@cdpc.test` | regional_manager | `regionalPage` |
| `asset@cdpc.test`    | asset_manager    | `assetPage`    |
| `admin@cdpc.test`    | system_admin     | `adminPage`    |

Fixtures sign in via `POST /api/auth/login`, then plant `frank_token` /
`frank_user` in localStorage (the keys the SPA's `AuthProvider` reads) so the
app boots already authenticated. `auth.spec.ts` still exercises the real login
form. **All role fixtures wrap the same underlying page**, so a given test must
use exactly one role.

## Seeding & write coverage

`seedDemoData(page)` (admin-only) calls `POST /api/demo/seed` — idempotent, it
loads 13 applicants across every pipeline stage plus work orders,
recertifications, a renewal, a move-out, a violation+notice, inspections, and
ledger entries. Write specs seed via `seedDemo(browser, baseURL)` in a
`beforeEach`, which uses a throwaway admin context so it never collides with the
test's own role page.

Mutating tests (create / lifecycle transitions) assert real status changes, but
they run **only against an ephemeral CI or local Postgres — never a remote
deployment**. The `SKIP_WRITES` flag is true only when `E2E_BASE_URL` points at a
non-localhost host (e.g. `*.vercel.app`); it guards every write `describe` with
`test.skip(SKIP_WRITES, …)` and short-circuits `seedDemo`, so a prod-targeted run
is strictly read-only. CI sets `E2E_BASE_URL` to a localhost Vite (just to skip
the `e2e:up` boot), so writes still run there against the ephemeral DB.

## Layout

```
e2e/
  fixtures.ts                # signIn + 5 per-role page fixtures + seedDemo / SKIP_WRITES
  scenarios/
    auth.spec.ts             # login form + route protection
    dashboard.spec.ts        # 5 clickable stat cards
    navigation.spec.ts       # core pages load; work-order priority enum
    applications.spec.ts     # column set + row → detail + tab filter
    rbac.spec.ts             # full nav matrix per role + deep-link denials + gated buttons
    screening.spec.ts        # queue render + screen-decision write
    approvals.spec.ts        # tier visibility per role + tier1 approve/deny write
    applications-detail.spec.ts  # detail shell + role-gated detail actions
    maintenance.spec.ts      # KPIs + create → assign → start → complete + gating
    properties.spec.ts       # list render + asset_manager create
    users.spec.ts            # roster + admin create + create gating
    ledger.spec.ts           # delinquency overview + admin Post Rent + gating
    inspections.spec.ts      # KPIs + schedule → complete
    workflows.spec.ts        # renewals / move-outs / evictions / recerts: render + 1 write each
    compliance-audit.spec.ts # compliance report + audit log + tape + QA bundles (regional+)
```
