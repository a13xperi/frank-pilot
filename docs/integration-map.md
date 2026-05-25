# Frank-Pilot — Full Integration Map

_Generated 2026-05-25. Status badges are memory-asserted unless marked **[verified]**._

**Legend:** ✅ wired & live · 🟡 built/merged, NOT live (needs deploy or config) · 🔵 in-progress (uncommitted/contested) · 🔴 missing or broken-via-path

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — COORDINATION  (multi-session machinery)                              │
│                                                                                │
│  session_locks(Supabase) ✅   Wire msg bus ✅   briefing-gen ✅                 │
│        │ auto-register hook        │ inbox hook       │                         │
│        ├── file-lock enforce ✅     │                  │                         │
│        ├── session-reaper(age>4h) ✅ launchd                                    │
│        ├── expire-sessions(hb>30m) ✅ cron                                      │
│        ├── idle-session-reaper(idle>20m) ✅ launchd  ◀── shipped 2026-05-25     │
│        ├── A/B/C account rotation ✅   build-ledger→Mission Control ✅           │
│        ├── named-directive discipline 🟡 (6 of 7 sessions register "unnamed")   │
│        ├── Mobile-QA session 🔵 (prompt ready, not launched)                    │
│        └── cheap engines in briefing 🔴 (Codex/Gemini/MiniMax run headless,     │
│                                          invisible to session_locks)            │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     │ sessions act on ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — FRANK-PILOT PRODUCT  (the app + external services)                   │
│                                                                                │
│  Railway API ✅live ──┬── Vercel tenant ✅live (manual deploy 🟡, no auto)       │
│  (manual deploy)      ├── PM console ✅live    ├── client-acq ✅live             │
│                       │                                                        │
│  External services:                                                            │
│   • Resend email      🟡 TEST-MODE only (owner inbox; DEMO_LINK echo workaround)│
│   • Twilio SMS magic  🟡 PR#149 merged — needs creds + A2P 10DLC + Railway env  │
│   • Stripe (BP-08)    🟡 prod migration + charge.refunded webhook re-reg pending│
│   • Supabase guest    🔵 saved-shortlist on feat/saved-shortlist (unmerged)     │
│   • Discover map      ✅live (hybrid 352/17) but 🔵 contested (≈5 worktrees)     │
│   • Demo harness      ✅live [verified] — /api/qa/demo gated, SECRET set   │
│   • Geo coords        🔴 NOT backfilled                                         │
│   • NAU 'lost'        ✅live [verified] — /api/recertifications/:id/nau-lost 401              │
│   • i18n EN/ES gate ✅   branch protection (6 checks) ✅                          │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     │ ops/meta managed by ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — HARNESS / INFRA  (meta-ops)                                          │
│                                                                                │
│  OpenClaw bridge ✅ (cc sync→CLAUDE.md)   Paperclip ✅ (7 agents)               │
│  token-watch capacity ✅   build_ledger ✅   reapers ✅ (×3 now)                 │
│  SAGE         🟡 Plan C decided, agents pending                                 │
│  Hermes MCP   🟡 fetch live · firecrawl dormant (no key)                        │
│      └─ shim drops OpenAI `tools` 🔴 → web_extract unreachable by LLM (dead)    │
│  Notion brain 🟡 integration caps UI-only (insert-comment/upload gated)         │
└──────────────────────────────────────────────────────────────────────────────┘
```

## What's stubbed — the work, by lane

| # | System | Status | What's blocking it |
|---|--------|--------|--------------------|
| **Product — gates a real demo** ||||
| 1 | Stripe BP-08 | 🟡 ⚠️ | `STRIPE_LIVE_ENABLED=true` but keys are `*_test` → reconcile flag/keys; `charge.refunded` subscription unverified (dashboard check) |
| 2 | Resend email | 🟡 | still test-mode (owner-only); needs domain verify to send to real tenants |
| 3 | Twilio SMS magic-link | 🟡 | creds + A2P 10DLC registration + Railway env before any prod SMS |
| 4 | NAU 'lost' lifecycle | ✅ | **[verified] deployed** — `/api/recertifications/:id/nau-lost` → 401 |
| 5 | Demo usability harness | ✅ | **[verified] deployed + gated** — `/api/qa/demo` → 401, `DEMO_LINK_SECRET` set |
| 6 | Geo coords | 🔴 | backfill never run |
| 7 | Saved-shortlist / guest_sessions | 🔵 | building on `feat/saved-shortlist`, unmerged/unreviewed |
| 8 | Discover map rail | 🔵 | live but contested across ~5 worktrees (the mobile-QA fix routes here) |
| **Coordination** ||||
| 9 | Engine visibility | 🔴 | Codex/Gemini/MiniMax dispatches don't register in `session_locks` → invisible in briefing |
| 10 | Named-directive discipline | 🟡 | 6/7 sessions are "unnamed"; only new (prompt-fixed) sessions self-name |
| 11 | Mobile-QA session | 🔵 | prompt + memory ready; not launched |
| **Infra** ||||
| 12 | Hermes shim | 🔴 | `claude_cli_proxy.py` drops the `tools` array → web_extract dead-code via LLM until rebuilt |
| 13 | SAGE agents | 🟡 | Plan C chosen; agents not stood up |
| 14 | Firecrawl MCP | 🟡 | dormant pending `FIRECRAWL_API_KEY` |

## Dependency-ordered finish sequence

```
STEP 0  Confirm deploy truth ──────────────────────────────────────────────┐
        Many 🟡 may already be live. Verify Railway + Vercel + Stripe state  │
        BEFORE doing anything — avoid re-shipping done work.                 │
                                                                             ▼
STEP 1  Frank "fully-live demo" critical path (product, highest value)
        ✗ 1a NAU 'lost' deploy        — DONE [verified], dropped
        ✗ —  Demo harness deploy      — DONE [verified], dropped
        ├─ 1b Stripe: reconcile LIVE_ENABLED vs test keys (1-line env) +
        │      confirm charge.refunded subscription in dashboard   (cheapest now)
        ├─ 1c Resend: verify sending domain → exit test-mode
        └─ 1d Twilio: A2P 10DLC reg → env → enable SMS channel
              (1b/1c/1d are independent → parallelize)

STEP 2  Discover de-contention (unblocks the mobile-QA rail fix)
        merge-train the ~5 discover-* worktrees → land PropertyList.tsx fix

STEP 3  Coordination hardening (meta — makes Steps 1-2 legible)
        ├─ 3a engine-registration shim: Codex/Gemini write a session_locks row
        └─ 3b auto-name sessions (directive on launch, harness-side)

STEP 4  Infra unblocks (lower urgency)
        ├─ 4a rebuild Hermes shim to pass `tools` → web_extract live
        └─ 4b SAGE agent standup (Plan C)
```

**Critical path to a clean live tenant demo = Step 1** (4 deploys/configs, mostly independent). Everything else is enabling work.

## Step-0 verification results

_Probed live 2026-05-25 against Railway API `api-production-ed89` + Railway env. **Several memory-asserted 🟡 statuses were stale — already live.**_

**Endpoint liveness:** all 5 return 200 — Railway API (ed89 + 9bef), Vercel tenant / PM-console / acq.

**Route canaries** (404 = not deployed · 401 = deployed + auth-gated):

| System | Map said | Live reality | Verdict |
|--------|----------|--------------|---------|
| NAU 'lost' | 🟡 not deployed | `POST /api/recertifications/:id/nau-lost` → **401** (mount is `recertifications`, *plural*; lives in the recert module, not acquisitions) | ✅ **already deployed** |
| Demo harness | 🟡 migration + env pending | `GET /api/qa/demo` → **401**; `DEMO_LINK_SECRET` set in Railway | ✅ **already deployed + gated** |
| Resend email | 🟡 test-mode | `RESEND_API_KEY` set; send-mode not probeable from here | 🟡 unchanged (still owner-only until domain verify) |
| Twilio SMS | 🟡 needs creds + env | **no** `TWILIO*`/`A2P`/`MESSAGING_SERVICE` env present | 🟡 confirmed — accurate, not configured |
| Stripe BP-08 | 🟡 webhook re-reg pending | `STRIPE_WEBHOOK_SECRET` set (endpoint exists); event subscription not CLI-verifiable | 🟡 + ⚠️ see below |

**⚠️ Stripe config mismatch (flag, not a fix):** `STRIPE_LIVE_ENABLED=true` but both keys are **test** (`pk_test_…` / `sk_test_…`). Effect: payments run test-mode regardless of the flag — the flag is misleading, not dangerous. Reconcile before any real-money demo: either set live keys, or set the flag to `false` so it reads honestly. The `charge.refunded` webhook event subscription can't be confirmed without Stripe dashboard/secret-key auth.

**Also:** `DEMO_LINK_IN_RESPONSE=false` in Railway (memory had it `true`) — the devLink-echo tenant-funnel workaround is currently **off** in prod.

**Net effect on the finish sequence:** Step 1a (deploy NAU 'lost') is **done** — drop it. Demo harness deploy is **done** — drop from Step 1. Step 1 shrinks to: Stripe key/flag reconcile (1b), Resend domain verify (1c), Twilio standup (1d). The cheapest win is now 1b — a one-line env correction, not a deploy.
