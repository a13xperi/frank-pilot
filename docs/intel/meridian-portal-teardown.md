# Global Meridian Portal — full competitive teardown

_Snapshot: 2026-06-12. Passive recon only (public bundle + HTTP headers + one
unauthenticated endpoint) plus the authenticated screenshot from Jun 11.
Extends [meridian-portal-comparison.md](meridian-portal-comparison.md) with the
architecture/infra layer. No auth was bypassed — the login endpoint is
rate-limited and was not probed beyond a single unauthenticated GET._

## TL;DR — verdict

Meridian is a **manager operations-briefing overlay on top of RealPage**, built
by GPMG's IT department on a **self-hosted Plesk/nginx Next.js stack**. It is a
read-only reporting skin, not a system of record: it ingests RealPage and
re-presents a daily manager briefing. Architecturally it is a small,
single-box, IT-grade deployment — not cloud-scale infrastructure. It competes
with **one slice** of Frank-Pilot (the manager dashboard, which we now also
ship — PR #295) and with **none** of the rest (intake, screening, approvals,
ledger, lease, compliance tape, tenant portal, voice).

## Architecture & infrastructure (newly established)

| Signal | Evidence | What it implies |
|---|---|---|
| **Self-hosted on Plesk/Linux** | `x-powered-by: PleskLin`, `server: nginx` | Runs on a traditional Plesk-managed VPS/shared host, not Vercel/Railway/cloud. Single-box, IT-department-grade ops. No obvious horizontal scale story. |
| **Next.js App Router + RSC** | `x-powered-by: Next.js`; `vary: rsc, next-router-state-tree, next-router-prefetch`; Turbopack chunks | Modern React Server Components app. Page data arrives as auth-gated RSC payloads — which is exactly why a headless crawl sees only the loader shell. |
| **NextAuth for auth** | `nextauth` / `next-auth` strings in the bundle | Session auth via NextAuth.js (not Supabase Auth, not enterprise SSO). |
| **Supabase-shaped data layer** | `.from(...)` calls seen in the first recon pass (no project URL/key exposed) | Likely a Supabase Postgres behind NextAuth-gated server routes. Credentials are not leaked client-side (decent opsec). |
| **Login rate-limiting** | `GET /api/login-state` → `{"rateLimited":false,"retryAfterSec":0,"remaining":10}` | A 10-attempt login throttle exists. Basic brute-force protection — a thoughtful touch for an IT build. |
| **Manager-centric design** | React context `HeadManagerContext`; "Property Management Portal"; briefing/agenda UI | The whole app is built around the property manager's daily view — not applicants, not tenants, not compliance staff. |
| **Cross-tab coordination** | `SharedWorker` in the bundle | Some shared client state / possibly a realtime or polling worker shared across tabs. |
| **Cosmetic "uplink" theming** | "Establishing uplink…", lat/long `36.17°N 115.14°W`, "Agenda incomplete" pill | Mission-control styling over a CRUD app. Presentation-forward. |

**Read:** this is a competent but small build — one Plesk box, Next.js + NextAuth +
Supabase, manager-only scope. It is the kind of thing a capable internal IT team
ships in a few weeks. It is not a platform play and shows no sign of the
compliance, financial, or applicant-facing machinery that the Global business
actually runs on.

## Feature surface (from the authenticated screenshot)

- **Daily briefing loop** — "Continue Meridian briefing," Briefing History of dated
  sessions logged with response counts and `SKIPPED` states. A morning-standup
  product for managers.
- **Operations KPI tiles** — Open Work Orders, Overdue Follow-ups, Active Turns,
  Delinquent Households, Past-Due Rent ($). All sourced from a "fact packet."
- **RealPage ingest** — explicit ("No RealPage ingest note supplied"). RealPage is
  the source of truth; Meridian reads from it.
- **Property snapshot** + **Items needing manager attention** — both empty without a
  fact packet ("No property rows in today's fact packet").
- **Assistant** — an "Assistant" affordance + "Ask Gemini" in the chrome (Google
  Gemini, not their own agent).
- Sidebar of ~10 nav icons (dashboard, tasks, chat, phone, lists, people, folder,
  calendar, contacts) — most unexplored behind auth.

Every data card in the captured session was **empty** — the briefing fact packet
hadn't been generated. The product's value is entirely downstream of a working
RealPage ingest that, in the captured state, wasn't running.

## Head-to-head vs Frank-Pilot

| Capability | Meridian | Frank-Pilot |
|---|---|---|
| Manager briefing + ops dashboard | ✅ its entire product | ✅ shipped (PR #295) reading the live SOR, not a RealPage ingest |
| Source of truth | ❌ RealPage (it's an overlay) | ✅ is the SOR |
| Application intake + FCRA/HUD screening | ❌ | ✅ |
| Tiered approvals + separation of duties | ❌ | ✅ |
| Immutable hash-chained compliance tape | ❌ | ✅ |
| Lease generation + e-signature | ❌ | ✅ |
| Tenant portal (pay / maintenance / ledger) | ❌ | ✅ |
| Wait-list + outbound voice (Frank) | ❌ | ✅ |
| Recert / renewal / eviction / move-out | ❌ | ✅ |
| AI assistant | ✅ Gemini, manager-facing | ✅ Frank voice + housing-QA, tenant-facing |
| Infra | Self-hosted Plesk box, NextAuth | Cloud (Railway/Vercel), full RBAC, audit log |

## Strengths / weaknesses of their approach

**Strengths**
- Ships the one surface managers ask for first (the daily briefing) with low effort.
- Sensible auth hygiene (NextAuth + login throttle), no leaked client secrets.
- Modern stack (Next.js App Router / RSC).

**Weaknesses / risks**
- **Wholly dependent on RealPage.** No ingest → empty dashboard, which is the state
  we captured. It owns no data and can act on nothing.
- **Single Plesk box.** No evident scale, DR, or compliance posture for PII.
- **Manager-only.** Nothing for applicants, tenants, or compliance — i.e. none of
  the workflows that generate Global's actual obligations.
- **Strategic conflict with the 023 decision.** It quietly implements "operations-
  only, RealPage stays SOR" (DM-FRANK-023 Option A) — and demonstrates that path's
  ceiling: a pretty dashboard with no operating system underneath.

## What we still can't see (and how to get it)

Passive recon stops at the NextAuth wall; RSC page payloads require a session.
To capture the real route map + data model (no auth-bypass needed — just the
user's own logged-in session):
1. **Session cookie**: DevTools → Application → Cookies on the logged-in portal →
   copy the `next-auth.session-token` → `curl` the RSC routes / `/api/*` with it.
2. **RSC payloads**: DevTools → Network → filter `?_rsc=` requests → each one is the
   server-rendered data for a route; paste a few and the feature set resolves.
3. **Supabase introspection**: if the project URL + anon key appear in any authed
   network request, the table list comes from the REST root the way we read Sage.

## Recommendation

Treat Meridian as **validation, not threat**. It proves managers want the briefing
surface (now shipped in Frank, PR #295) and it is a live demonstration of the
operations-only path the CFO is weighing — with its ceiling visible: an empty,
RealPage-dependent dashboard on a single box. The talking point writes itself:
*"the briefing view your IT team built is the front porch; Frank is the house —
and Frank can also generate the leases, hold the compliance record, and answer the
phone."*
