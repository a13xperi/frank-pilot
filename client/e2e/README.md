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

Seed accounts (password `password123`):

| Email             | Role           | Fixture      |
| ----------------- | -------------- | ------------ |
| `agent@cdpc.test` | leasing_agent  | `agentPage`  |
| `senior@cdpc.test`| senior_manager | `seniorPage` |
| `admin@cdpc.test` | system_admin   | `adminPage`  |

Fixtures sign in via `POST /api/auth/login`, then plant `frank_token` /
`frank_user` in localStorage (the keys the SPA's `AuthProvider` reads) so the
app boots already authenticated. `auth.spec.ts` still exercises the real login
form. `seedDemoData(page)` (admin-only) loads applications across every
pipeline stage for tests that need a populated table.

## Layout

```
e2e/
  fixtures.ts            # signIn helper + per-role page fixtures + seedDemoData
  scenarios/
    auth.spec.ts         # login form + route protection
    dashboard.spec.ts    # 5 clickable stat cards
    applications.spec.ts # column set + row → detail + tab filter
    navigation.spec.ts   # core pages load; work-order priority enum
```
