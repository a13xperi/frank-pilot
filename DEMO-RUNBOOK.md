# Demo Ops Runbook — Frank/CPA/Chase (Jun 11)

**This worktree is the parallel demo track.** Pinned at commit `fe23dc3` — dev work on
`main` cannot move it. Own database (docker container `frank-pilot-demo-db`, port
**5433**, db `frank_pilot_demo`, own volume), own ports (**API :3010**, **client
:5180**). Nothing here reads or writes production (`api-production-ed89.up.railway.app`
is untouched). Runs fully offline — venue wifi is irrelevant; HDMI is the only
dependency (Craig owns cable + TV).

## Morning boot (~60s)

```bash
cd ~/code/frank-pilot-demo && ./demo-up.sh
```

→ **Demo URL: http://localhost:5180** — open in an incognito window, 100% zoom,
close every other tab.

## Logins (password: `password123`)

| Email | Role | Used for |
|---|---|---|
| `regional@cdpc.test` | Regional Manager | **Primary demo driver** — ledger, evictions, audit log, compliance |
| `agent@cdpc.test` | Leasing Agent | Role-scoping beat (sees less nav) |
| `senior@cdpc.test` | Senior Manager | Screening + Tier-1 |
| `asset@cdpc.test` | Asset Manager | Renewals, move-outs, Tier-3 |
| `admin@cdpc.test` | System Admin | Demo Controls (Post Rent / Process Late Fees) — only if asked |

## The five Round-2 beats → exact clicks

*(Talk track per beat lives in the Notion "Ledger Demo — Script + Leave-Behind" §3.)*

| Beat | Where | Clicks |
|---|---|---|
| 1 · A tenant acts | **Maintenance** | "+ New Work Order" → property: any, title: "Bathroom sink leaking", priority: urgent → Create. (3 seeded work orders incl. 1 emergency already visible.) |
| 2 · The ledger writes | **Audit Log** | Open page — the work order you just created is the **top entry**, timestamped, actor-attributed. "That record can't be edited after the fact." |
| 3 · Unit-level file | **Applications → Tomasz Kowalski** | Full history in one view: $1,950 delinquent ledger, late fees, eviction trigger, 7-day notice, move-out + deposit calc. Or **Keisha Williams** for the clean tenant (renewal $1,300→$1,339). |
| 4 · Verification | **Screening (as senior@)** | "Screen" on **Priya Patel** → green/red chips live (background, credit, AMI, fraud). Or show **Elena Vasquez** income pre-verified → Generate Lease → Onboard. |
| 5 · The block, re-priced | **The Ledger** (new showcase, top of sidebar) | The one-screen close: **299 evidence records · 26 units · 17 properties · 85% current**, the live tape (your beat-1 work order at the top), and Proof-by-Property. "Stack thousands of verified unit-events and the discount collapses — same book, provable." Leave this screen up through the asks. Backup: Rent Ledger (4-row ladder) + Properties as rehearsed. |

### "The Ledger" showcase (added Jun 10, ~11pm — commit f28f38d)

New top sidebar item (senior_manager+; the renamed **"Rent Ledger"** is the ops page).
Read-only aggregate at `/api/ledger/showcase`: stat band, live tape (newest first —
tenant names open the unit file), Proof by Property. Evidence metrics only, no pricing.
Verified: endpoint + typecheck + live-tape catch + original beats re-pass. If anything
looks off in the room: it's additive — skip it and run beat 5 on Rent Ledger + Properties
exactly as twice-rehearsed.

### The populated book (enrichment seed — added after the ledger looked empty in rehearsal)

`npm run seed:demo:ledger` (wired into `demo-reset.sh`) adds **24 onboarded tenants across
the portfolio with 6 months of charge/payment history each** — current payers, slow payers
with late fees, and a 3-tenant delinquency ladder alongside Tomasz. Drill-down rule:
**click into Tomasz only** (his record is fully scripted: eviction, notice, move-out).
The enrichment tenants make the dashboard and per-tenant ledgers look like a living
system of record; their `daysOverdue` all read ~71d because the app dates overdue from
the first rent charge — uniform and plausible, but don't invite a forensic read of a
specific enrichment tenant.

### Bonus beat (OPTIONAL) — "Frank answers your own FAQ" (added Jun 10, ~11pm — commit fdd2c43)

Only if the room is warm and time allows — the 5 rehearsed beats stay the spine.

- **Where:** http://localhost:5174 (tenant app) → chat widget / "Talk to Frank" pill.
  Boots with `./demo-up.sh` (proxied to the demo API; keyless via the claude CLI).
- **The line for Frank Hawkins:** "We loaded your 500-question GPMG tenant FAQ into
  Frank today — every answer below is grounded in YOUR document, with citations."
- **Rehearsed questions** (all verified tonight, answers cite `(Tenant FAQ #N)`):
  1. "Do food stamps count as income?" → No, SNAP excluded `(#63)`
  2. "Can I ask for a live-in aide?" → reasonable accommodation, income excluded `(#118–120, #29, #30)`
  3. "How much is the application fee?" → **$35.95 per adult** from platform facts (never the doc's old range)
- **Latency: 13–16s per answer, measured (CLI path)** — it LOOKS like nothing is
  happening. Ask the question, then immediately turn to the room and narrate
  ("it's retrieving from your FAQ corpus and citing sources — watch for the
  citation numbers") and let the answer interrupt you. Never stare at the screen
  waiting. If the room is cold or time is tight, skip this beat entirely — the
  five-beat spine carries the meeting without it.
- **Rate limit:** 20 questions / 10 min per IP — plenty, but don't crowd-source rapid-fire.

## Reset to pristine (after every rehearsal, ~90s)

```bash
cd ~/code/frank-pilot-demo && ./demo-reset.sh
```

The reset **stops and restarts the API itself** (dropping the DB under a live API
crashes it — found in rehearsal) and exits only after `/health` is green again.

> ⚠️ **After every reset: log out and log back in** (or open a fresh incognito
> window). The reset rebuilds users with new IDs — a pre-reset browser session
> still *reads* fine but its writes can fail, which looks like "the system is
> broken." It isn't; the session is stale.
>
> 📋 **The Audit Log is EMPTY in pristine state — by design.** Audit entries are
> created by live actions only (the seeded ledger history is historical data and
> intentionally generates none). Beat 1 (create a work order) is what makes the
> first entry appear — emptiness-then-instant-entry is the demo moment itself.

Mid-meeting lighter option: **"Load Demo" button on the login page** re-seeds
applications without a full reset (`POST /api/demo/seed`).

## Rehearsal findings (Jun 10, ~9:45pm — full run: 9/9 PASS)

- All five beats verified live, plus role-scoping (agent → 403 on audit log) and
  Keisha's renewal offer. Screening on Priya returns background/credit/compliance
  chips in ~1s.
- **`ENCRYPTION_KEY` must stay pinned in `.env`** (it is — do not delete the line).
  Unset, every process invents a random key: seeds encrypt SSNs the API can't
  decrypt and the scripted "Screen Priya Patel" moment dies with
  "Unsupported state or unable to authenticate data." If screening ever throws
  that error: `./demo-reset.sh` re-encrypts everything consistently.

## Do-not-touch list (tonight is not the night)

- **Compliance-tape "Verify" button** on Audit Log — backed by a dark flag
  (`COMPLIANCE_TAPE_V2_ENABLED=false`); will error. Stay on the standard audit view.
- All dark feature flags stay **false** (identity verification, CRA screening,
  auto-screening, pre-adverse window) — they ship dark pending credentials.
- Don't demo from the production URLs. The parallel track exists so prod and dev
  can't surprise you.
- **Late-fee open decision** (flagged in DEMO-SCRIPT.md): engine uses $50 + $10/day
  (GPMGLV lease); HUD standard for subsidized LIHTC is $5 + $1/day max $30. If it
  comes up: "that's a config decision we've flagged for Frank — the engine takes
  either." Do not present $50 as the compliant number to a LIHTC CPA.

## If something breaks in the room

1. Page won't load → rerun `./demo-up.sh` (idempotent; reuses what's alive).
2. Data looks wrong → login page → "Load Demo" (10s) or `./demo-reset.sh` (60s).
3. API dead, no time → narrate over the **Adinkra recap + Notion script** (the
   leave-behind is designed to carry the pitch without screens).
4. Logs: `/tmp/frank-demo-api.log`, `/tmp/frank-demo-client.log`, `/tmp/frank-demo-tenant.log`.

## Tonight's checklist (before sleep)

- [ ] `./demo-up.sh` → green READY
- [ ] One full rehearsal of the 5 beats (≤10 min)
- [ ] `./demo-reset.sh` → pristine
- [ ] Laptop: disable sleep-on-lid-close + notifications/DND for the morning
- [ ] Craig: HDMI + TV confirmed; Frank attendance confirmed
- [ ] Decide DM-SAGE-OC-016 (benefits-only vs admin screens) — this runbook works for both: benefits-only = beats 1–5 narrated; admin-screens = same beats, shown
