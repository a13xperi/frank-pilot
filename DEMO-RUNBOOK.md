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

### Bonus beat — ❌ CUT for Jun 11 (kill switch flipped ~12:45am)

**Do not demo the tenant chat/voice assistant.** Verified leak on a direct
question: it answers from the **statewide HUD-LIHTC dataset** ("all 14 Carson
City properties") and names internal routes/systems ("/discover map",
"Frank-Pilot") — unacceptable in front of a CPA/banker, and a real product gap
for tenants. Both entry points (HousingChatWidget + TalkToFrankPill) are now
hidden behind `VITE_ENABLE_FAQ_CHAT` (default off; unit tests unaffected via
the MODE==='test' carve-out). Re-enable only after the proper scope fix
(`fix/housing-qa-tenant-scope` PR on main) lands and is re-verified. If AI
comes up in the room: *"we stress-tested our own assistant last night, caught
it over-answering, and pulled it until the scope guard ships — that's the
discipline the ledger sells."* The five-beat spine is unaffected.

**Update ~1:00am — CHAT path scope fix landed + verified on this branch; beat
stays CUT.** `POST /api/housing-qa` now defaults to **tenant scope**: tenant-FAQ
corpus + platform facts only — the statewide property index is structurally
unreachable (not prompted away), and the tenant prompt carries no internal
system/dataset/step names. Property retrieval requires an explicit
`scope:"full"` opt-in; unknown scope 400s. Verified through the real widget
path (`:5174/api/housing-qa`): the "test" repro now stays in FAQ scope (no
Carson City card, no dataset names), and all three rehearsed questions still
answer with citations. Pinned by `src/__tests__/housing-qa-tenant-scope.test.ts`
(54/54 housing-qa tests green). **Why the switch stays off anyway:**
`VITE_ENABLE_FAQ_CHAT` gates BOTH entry points, and the **voice pill
(TalkToFrankPill) has the same leak through a separate, unfixed pipeline**
(ElevenLabs agent — not bounded by the housing-qa fix). Do not flip the flag
for Jun 11. Post-demo: split the flag or fix the voice agent's grounding, then
re-verify and restore the beat below.

<details><summary>Original beat — for when it returns post-fix</summary>

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

</details>

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

## Rehearsal findings (Jun 11, ~00:45am — automated Playwright run, all 5 beats)

- **Beat 1 — the modal requires Description.** The exact-clicks above say title +
  priority + property, but Create stays disabled until **Description** is filled.
  Type anything ("Tenant reports a steady leak under the bathroom sink.").
- **Beat 1 login:** works as agent@ ONLY after the seed fix (81efa08) — scoped
  roles previously had no property assignments (deny-all: empty Maintenance,
  create 403'd). `demo-reset.sh` now seeds agent@/senior@ with all 17 properties.
- **Beat 4 needs `MOCK_MODE=1` in `.env`** (set Jun 11, survives resets — it's
  the documented screening stub gate). Without it every Screen comes back
  orange "Could Not Screen" HOLDs; with it Priya goes green "Screening Passed"
  and lands in Completed (~5s). The screening events land on The Ledger's live
  tape immediately — nice segue into beat 5.
- **Beat 5 numbers drift per seed run** (evidence 289–298 observed). Say
  "~300 evidence records · 26 units · 17 properties · 85% current" — don't
  quote 299 exactly.
- `demo-reset.sh` wipes the beat-1 work order (by design — DB drop). Don't
  reset between beats 1 and 5; the tape/audit beats build on it.

## Rehearsal findings (Jun 10, ~9:45pm — full run: 9/9 PASS)

- All five beats verified live, plus role-scoping (agent → 403 on audit log) and
  Keisha's renewal offer. Screening on Priya returns background/credit/compliance
  chips in ~1s.
- **`ENCRYPTION_KEY` must stay pinned in `.env`** (it is — do not delete the line).
  Unset, every process invents a random key: seeds encrypt SSNs the API can't
  decrypt and the scripted "Screen Priya Patel" moment dies with
  "Unsupported state or unable to authenticate data." If screening ever throws
  that error: `./demo-reset.sh` re-encrypts everything consistently.

## Re-rehearsal findings (Jun 11, ~00:45 — full API-level run: all beats PASS)

- **Stub gate must stay open in `.env`** (`ALLOW_STUB_SCREENING=1` and `MOCK_MODE=1`
  — both set, do not delete). Without it, keyless screening throws STUB_GATE_ERROR
  and every "Screen" click lands in could_not_screen → screening_review: Beat 4 dies
  with no chips. The 9:45pm pass masked this — that API process still carried the
  pre-rewrite env; the ~23:00 restart exposed it. If Screen ever HOLDs everyone:
  check these two lines, then `./demo-reset.sh`.
- Beat 5 stat band reads live counts (**297** evidence records at reset, not the
  scripted 299) — read the number off the screen or say "~300".
- Pristine seeds **4** work orders (1 emergency), not the 3 in the beat table.
- Frank FAQ answer latency measured ~17s on Q1 (not 5–10s) — narrate over the wait.
- State left pristine (audit 0, Priya `submitted`, Tomasz delinquent, QA tabs live).

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
