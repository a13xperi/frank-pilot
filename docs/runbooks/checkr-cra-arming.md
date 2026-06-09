# Runbook — Arming the consumer-report flow (Checkr + TransUnion ShareAble)

**Status:** Both CRA adapters are built, merged, and **dark**.

| Vendor | Domain | PR | On `main` | In prod |
|---|---|---|---|---|
| **Checkr** | background | #276 (`a19b5b0`) | ✅ | ✅ deployed dark 2026-06-09 (host `api-production-ed89.up.railway.app`) |
| **TransUnion ShareAble** | credit + eviction | #277 (`21c75a2`) | ✅ | ❌ **not yet deployed** — prod sits at `046d23e` (Checkr only) |

Currently inert: `CONSUMER_REPORT_ENABLED` is unset, so `submit()` takes the
legacy synchronous `runCheck()` path, byte-identical to pre-CRA.

This runbook flips the real Checkr **and** TransUnion ShareAble consumer-report
flow live, **together**. There is one master flag for both vendors, so arming is
all-or-nothing across the pair. **Read the blockers first — you cannot safely
flip the master flag today.**

---

## What "armed" means

When `CONSUMER_REPORT_ENABLED=true`, application `submit()` stops auto-screening
synchronously and instead:

1. Captures / honors the FCRA §1681b authorization (no consent ⇒ 400 + disclosure, no pull).
2. Creates **two** report orders in parallel — Checkr background **and** TransUnion
   ShareAble credit+eviction — and parks the app in `awaiting_consumer_report`,
   returning the hosted invitation / exam URL(s).
3. The applicant completes Checkr's hosted invitation (collects full SSN/DOB
   directly — we never send it) and ShareAble's hosted KBA exam (collects full SSN
   + identity-quiz — we only ever hold `ssnLast4`).
4. Each vendor posts events to `POST /api/webhooks/cra`; the receiver HMAC-verifies
   per-vendor, maps **categorical-only** fields, and persists the verdict.
5. Once **both** reports land, the app advances `awaiting_consumer_report → screening`
   (and the pipeline runs only if `SCREENING_ON_SUBMIT_ENABLED=true`).

```
submit() ─[consent ok]─> Checkr.createReport  (candidate→invitation)    ┐
                         TU.createReport       (applicant→screening-req) ├─ Promise.all ─> awaiting_consumer_report
                                                                        ┘                        │
   applicant completes Checkr invitation + ShareAble KBA exam ──────────────────────────────────┤
                                                                                                 ▼
   Checkr   webhook ─[X-Checkr-Signature   HMAC]─> dispatch ─> persist categorical bg verdict
   ShareAble webhook ─[X-ShareAble-Signature HMAC]─> dispatch ─> persist categorical credit verdict
                                                                                                 │
                              both background + credit completed_at set? ───────────────────────┤
                                                       no ─> wait ◀──────────────────────────────┘
                                                       yes ─> advance ─> screening
                                                                (kicks pipeline iff
                                                                 SCREENING_ON_SUBMIT_ENABLED)
   terminal status (canceled/suspended) OR invitation/exam expired/failed
        └─> HOLD in screening_review (never an auto-pass)
   report.disputed (either vendor) ─> 200 ack, NO HOLD  (FCRA §1681i reinvestigation, #277)
```

---

## ⛔ Blockers — do NOT flip the prod flag until these are cleared

### B0. Prod is behind `main` — TU isn't deployed yet (deploy is coupled)

Prod (`046d23e`) has the Checkr adapter (#276) but **not** the TransUnion adapter
(#277). Arming both requires deploying `main` to prod first. That same deploy also
ships everything that landed after `046d23e` — notably **#278, the Stripe major
bump 17.7 → 22.2** (a real, non-CRA payments change, dark-neutral but behavioral).

**⇒ Treat the deploy as a coupled decision.** Deploy `main` from the prod-linked
`fp-deploy` worktree, then smoke the payment path (`/health`, a webhook/payment
round-trip) **before** touching any arming flag. #278 shipped with its own updated
payment tests green in CI, but confirm in prod after the version jump.

### B1. Arming is all-or-nothing across BOTH vendors — RESOLVED in code, gated on keys

There is **one** master gate (`CONSUMER_REPORT_ENABLED`), no per-vendor flag.
`submit()` creates both orders together:

```ts
// src/modules/application/service.ts:377
const [background, credit] = await Promise.all([
  new BackgroundCheckService().createReport({...}),   // Checkr     — real (#276)
  new CreditCheckService().createReport({...}),        // TransUnion — real (#277)
]);
```

As of #277 **both** `createReport()`s are real implementations (the credit half is
no longer a throw-stub). Each one **fail-louds when keyless**: Checkr throws with
no `CHECKR_API_KEY`; ShareAble throws `"TransUnion ShareAble credit report
integration not yet configured"` with no `TRANSUNION_SHAREABLE_API_KEY`
(`credit-check.ts:92`). `Promise.all` rejects on either → the `catch` logs and
leaves the app in `submitted` (fail-loud, never a silent screening skip). And
`advanceIfBothReportsIn` requires **both** `*_completed_at` set, so a
single-vendor app would sit in `awaiting_consumer_report` forever.

**⇒ The flag and BOTH vendors' credentials must go together.** Flipping
`CONSUMER_REPORT_ENABLED=true` with only one vendor's key set breaks every
consented submission. No code change is needed — the resolution is operational:
provision **both** key sets (Checkr + ShareAble) before the flip. This is exactly
"arm both together."

> **In-flight hardening — PR #283 (open, mergeable):** adds an atomic readiness
> preflight. `submit()` checks `BackgroundCheckService.isConfigured()` **and**
> `CreditCheckService.isConfigured()` (real key predicates, the exact complement of
> each `createReport()` keyless gate) *before* creating any order — so a half-armed
> deploy short-circuits cleanly (app stays `submitted`) instead of orphaning a
> Checkr candidate or emailing a half-armed invitation. Land #283 before arming so
> a missing key is a no-op, not a partial order. With #283, B1 is enforced in code,
> not just by operator discipline.

### B2. Report shapes are unverified vs live sandboxes (fail-OPEN risk) — both vendors

**Checkr.** `mapCheckrReportToResponse` (`background-check.ts:261`,
`TODO(credentialing)`) reads nested records straight off the webhook event object
(`sex_offender_search.records`, `national_criminal_search.records/.charges`,
`county_criminal_searches[].records/.charges`); `translateCheckrEvent`
(`cra-webhook.ts`) sets `report = body.data.object` with no fetch/expansion.
Checkr's `report.completed` commonly carries **references** (IDs/URIs) to its
component screenings, **not** inline expanded records. If so, every lookup
resolves to `[]` → `felonies:0, sexOffenses:false` → a **false-clean PASS**.

**TransUnion ShareAble.** The **entire shape is ASSUMED** — endpoints
(`/v1/applicants`, `/v1/screening-requests`), Bearer auth, the
`X-ShareAble-Signature` header/digest, the event vocabulary
(`report.completed`/`screening.completed`/`exam.failed`/…), the request-id and
exam-url fields, and the `mapShareAbleReportToResponse` field paths
(`creditScore`, `publicRecords.evictions`, `bankruptcies`, …;
`credit-check.ts:142`) are all flagged `TODO(credentialing)` and unverified
against a live ShareAble sandbox.

**⇒ Before arming, validate BOTH against live sandboxes.** Confirm each webhook
object actually contains the inline categorical records; if a vendor sends
references, add the report-expansion fetch before mapping. Verify a known
sandbox felony / sex-offender fixture (Checkr) and an eviction / bankruptcy /
low-score fixture (ShareAble) each map to the correct **non-clean** verdict, not a
false-clean 0.

---

## Environment variables

Set on Railway: `frank-pilot-api` → **production** → `api` service. (`railway
variables` defaults to prod regardless of link — always pass `-e production`.)

| Var | Read at | Required | Notes |
|---|---|---|---|
| `CONSUMER_REPORT_ENABLED` | `application/service.ts:307` | **the switch** | `true` arms the flow. Flip **last**, only after both vendors' keys are set and B0/B1/B2 cleared. |
| **Checkr (background)** | | | |
| `CHECKR_API_KEY` | `background-check.ts:106` | **yes** | Checkr secret key. Basic auth = `base64(key + ":")`. Also the fallback webhook secret. Never `changeme`/empty (keeps it dormant, fail-loud). |
| `CHECKR_PACKAGE` | `background-check.ts:123` | **yes** | Account-specific package slug. Default `tasker_standard` is a guess — set the real provisioned package. |
| `CHECKR_API_URL` | `background-check.ts:120` | sandbox only | Defaults to `https://api.checkr.com`. Point at the Checkr **sandbox** base during Phase 1. |
| `CHECKR_WEBHOOK_SECRET` | `cra-webhook.ts` (Checkr branch) | **yes** | HMAC key for `X-Checkr-Signature`. Falls back to `CHECKR_API_KEY`. Missing/`changeme` ⇒ webhook 503 fail-closed (the dark canary). |
| **TransUnion ShareAble (credit + eviction)** | | | |
| `TRANSUNION_SHAREABLE_API_KEY` | `credit-check.ts:92` | **yes** | ShareAble secret key. **Bearer** auth (not Basic). Also the fallback webhook secret. Missing/`changeme` ⇒ `createReport` throws (fail-loud, dark). |
| `TRANSUNION_SHAREABLE_PRODUCT_BUNDLE` | `credit-check.ts:112` | recommended | Product/bundle slug. Default `credit_eviction` — set the real provisioned bundle. |
| `TRANSUNION_SHAREABLE_API_URL` | `credit-check.ts:107` | sandbox only | Defaults to `https://api.shareable.com`. Point at the ShareAble **sandbox** base during Phase 1. |
| `TRANSUNION_SHAREABLE_WEBHOOK_SECRET` | `cra-webhook.ts:659` | **yes** | HMAC key for `X-ShareAble-Signature`. Falls back to `TRANSUNION_SHAREABLE_API_KEY`. Missing/`changeme` ⇒ ShareAble webhook 503 fail-closed. |
| **Shared** | | | |
| `SCREENING_ON_SUBMIT_ENABLED` | `cra-webhook.ts:394`, `service.ts:462` | **yes (to screen)** | If not `true`, the app advances to `screening` after both reports land but the **pipeline never runs** — it rests un-adjudicated. Set `true` so verdicts are evaluated. |
| `CRA_NAME` | `adverse-action/service.ts:28` | **yes (FCRA)** | Names the CRA in the §1681m adverse-action notice. Default `"Acme Background & Credit Services"` is a placeholder — **must** be the real CRA identity or the notice is non-compliant. With two CRAs, set the identity required by your adverse-action policy (or the controlling reseller). |
| `CRA_ADDRESS` | `adverse-action/service.ts:29` | **yes (FCRA)** | Real CRA mailing address. Default is a placeholder. |
| `CRA_PHONE` | `adverse-action/service.ts:30` | **yes (FCRA)** | Real CRA toll-free number. Default is a placeholder. |

> **No new migration.** The schema (`awaiting_consumer_report` status,
> `consumer_report_*_status`, `background_report_id`/`credit_report_id`,
> `cra_processed_events`, `cra_webhook_dlq`, `consumer_report_authorizations`,
> `consumer_report_authorized` audit value) is already in prod from the 2026-06-02
> reconcile (`src/db/migrations/2026-06-01-applications-consumer-report.sql`,
> `2026-06-01-fcra-consent.sql`). Nothing to run.

---

## Procedure

### Phase 0 — Prerequisites (off-platform)

- [ ] **Checkr** account: signed CRA agreement, **sandbox** + production API keys, a
      real **package** slug, and the webhook signing secret (or confirm Checkr
      signs with the API key).
- [ ] **TransUnion ShareAble** account: signed CRA/reseller agreement, **sandbox** +
      production API keys, the product **bundle** slug, and the webhook signing
      secret (or confirm ShareAble signs with the API key).
- [ ] Real CRA contact identity (name / address / phone) for adverse-action notices.

### Phase 1 — Sandbox validation, both vendors (clears B2; no prod flag, do this now)

Runs entirely against vendor sandboxes; does **not** touch the prod master flag.

1. In a staging/sandbox env set both vendors' sandbox keys + URLs + bundle/package +
   webhook secrets, plus `CONSUMER_REPORT_ENABLED=true`,
   `SCREENING_ON_SUBMIT_ENABLED=true`.
2. Register sandbox webhooks for **both** vendors → `https://<staging-api>/api/webhooks/cra`.
3. Drive a submit with consent → confirm a Checkr candidate+invitation **and** a
   ShareAble applicant+screening-request are created, and the app parks in
   `awaiting_consumer_report`.
4. Complete both hosted flows with sandbox fixtures, including a **felony** +
   **sex-offender** (Checkr) and an **eviction** / **bankruptcy** / **low-score**
   (ShareAble).
5. **B2 assertion:** confirm each maps to the correct non-clean verdict, **not** a
   false-clean 0. If clean, the webhook object lacks inline records — add the
   report/screening expansion fetch (see B2) and re-test.
6. Verify signature handling **per vendor**: tampered body / wrong secret → 401;
   missing secret → 503; valid → processed. Verify terminal events
   (`report.suspended`, `exam.failed`, etc.) HOLD in `screening_review`. Verify
   `report.disputed` → **200 ack, no HOLD** (§1681i — the #277 fix).
7. Verify PII discipline: `*_check_details.rawResponse` and the audit log hold
   categorical fields only — no charge narratives, tradeline detail, account
   numbers, addresses, full SSN/DOB.

### Phase 2 — Deploy `main` to prod (clears B0)

The code is built and merged; this ships it. Deploy from the prod-linked worktree;
it carries TU (#277) **and** the Stripe v22 major bump (#278) and the docs/cron
chores (#279–#281).

```bash
cd /Users/a13xperi/projects/fp-deploy        # prod-linked worktree (→ prod)
git fetch origin && git checkout origin/main # advance from 046d23e
railway up --detach --service api            # api does NOT auto-deploy main
```

Then **before any arming flag**: `curl …/health` → 200, and smoke a payment
round-trip to confirm the Stripe v22 upgrade is healthy in prod. Everything stays
dark (flag unset), so the new TU webhook path returns **503 fail-closed** without
its secret — the expected dark state and the new-route liveness canary.

### Phase 3 — Production arming (flip both vendors together)

1. Set the production env vars for **both** vendors + FCRA contact + screening,
   then `CONSUMER_REPORT_ENABLED` **last**.
   ```bash
   cd /Users/a13xperi/projects/fp-deploy   # prod-linked worktree
   railway variables -e production --service api \
     --set CHECKR_API_KEY=... \
     --set CHECKR_PACKAGE=... \
     --set CHECKR_WEBHOOK_SECRET=... \
     --set TRANSUNION_SHAREABLE_API_KEY=... \
     --set TRANSUNION_SHAREABLE_PRODUCT_BUNDLE=... \
     --set TRANSUNION_SHAREABLE_WEBHOOK_SECRET=... \
     --set SCREENING_ON_SUBMIT_ENABLED=true \
     --set CRA_NAME='...' --set CRA_ADDRESS='...' --set CRA_PHONE='...'
   # then, only after verifying the above took effect:
   railway variables -e production --service api --set CONSUMER_REPORT_ENABLED=true
   ```
   (A var change triggers a redeploy; if not, `railway redeploy --service api`.)
2. Register **both** production webhooks → `https://api-production-ed89.up.railway.app/api/webhooks/cra`:
   - **Checkr**: `report.completed`, `report.canceled`/`report.cancelled`,
     `report.suspended`, `invitation.expired`, `invitation.deleted`
     (`report.disputed` is a harmless 200 no-op).
   - **ShareAble**: `report.completed`/`screening.completed`,
     `report.canceled`/`report.cancelled`/`screening.canceled`, `report.suspended`,
     `exam.expired`, `exam.failed` (others are harmless 200s).

### Phase 4 — Post-arm verification

- [ ] `curl https://api-production-ed89.up.railway.app/health` → 200, `db:ok`.
- [ ] Both canaries are now **armed**: a `POST /api/webhooks/cra` with a *bad*
      `X-Checkr-Signature` → **401** (was 503 when dark), and with a *bad*
      `X-ShareAble-Signature` → **401**. A valid test event → 200.
- [ ] One real end-to-end: submit with consent → **both** invitation + exam issued →
      complete both → both `report.completed` events → app advances to `screening`
      → verdict adjudicated → categorical-only persistence + audit log.
- [ ] `cra_webhook_dlq` empty (no dispatch failures); `cra_processed_events` shows
      both events (idempotency).

---

## Webhook reference

- **Route:** `POST /api/webhooks/cra` (mounted raw-body, before `express.json()`).
- **Three receive paths, selected by header** (synthetic is TEST-ONLY,
  `NODE_ENV=test`, → 404 in any deployed env).

**Checkr** — `X-Checkr-Signature` = HMAC-SHA256 (hex, optional `sha256=` prefix) of
the raw body, keyed by `CHECKR_WEBHOOK_SECRET` (or `CHECKR_API_KEY`).
Join key: `data.object.candidate_id` → `applications.background_report_id`.

| Checkr event | Internal status | Effect |
|---|---|---|
| `report.completed` | `complete` | Map + persist verdict; advance if both reports in |
| `report.canceled` / `report.cancelled` | `canceled` | **HOLD** screening_review |
| `report.suspended` | `suspended` | **HOLD** |
| `invitation.expired` / `invitation.deleted` | `canceled` | **HOLD** (never completed) |
| `report.disputed` | — | **200 ack, no HOLD** (§1681i reinvestigation, #277) |
| anything else | — | 200 ack, no-op |

**TransUnion ShareAble** — `X-ShareAble-Signature` = HMAC-SHA256 (hex, optional
`sha256=` prefix) of the raw body, keyed by `TRANSUNION_SHAREABLE_WEBHOOK_SECRET`
(or `TRANSUNION_SHAREABLE_API_KEY`). Join key: `data.object` screening-request id →
`applications.credit_report_id` (`SELECT id FROM applications WHERE credit_report_id = $1`).

| ShareAble event | Internal status | Effect |
|---|---|---|
| `report.completed` / `screening.completed` | `complete` | Map + persist verdict; advance if both reports in |
| `report.canceled` / `report.cancelled` / `screening.canceled` | `canceled` | **HOLD** |
| `report.suspended` | `suspended` | **HOLD** |
| `exam.expired` / `exam.failed` | (terminal) | **HOLD** (applicant didn't pass KBA) |
| `report.disputed` | — | **200 ack, no HOLD** (§1681i, #277) |
| anything else | — | 200 ack, no-op |

Fail-safe invariants (already enforced): terminal failures HOLD, never auto-pass;
idempotency via `cra_processed_events`; dispatch errors park a **categorical-only**
envelope in `cra_webhook_dlq` (never the raw report — the M1 audit fix) and still
return 200 (a CRA is never 5xx'd on a dispatch fault).

---

## Rollback / disarm

1. `railway variables -e production --service api --set CONSUMER_REPORT_ENABLED=false`
   (or remove it). `submit()` reverts to the legacy synchronous path immediately.
2. **In-flight apps**: any app already in `awaiting_consumer_report` is now
   stranded (no new webhook will advance it once disarmed, and submit no longer
   creates orders) — and it may be waiting on **either or both** vendors. Either
   re-arm to let pending reports land, or manually transition those apps
   (`awaiting_consumer_report → screening`/`submitted`) and reconcile. Enumerate
   them first: `SELECT id, background_report_id, credit_report_id FROM applications WHERE status = 'awaiting_consumer_report';`
3. To hard-close a receiver, unset that vendor's webhook secret (and don't fall
   back) — its branch returns 503 fail-closed. (Leaving the route up but 401-ing
   bad sigs is fine; vendors retry, so prefer re-arming over dropping events.)

---

## Monitoring

- **Logs** (`railway logs --service api`): `Failed to create consumer-report orders
  on submit` (B1 symptom — a vendor key missing/invalid), `CRA * verdict ignored —
  app not awaiting consumer report` (late/duplicate, benign), `Post-consumer-report
  screening pipeline failed`.
- **`cra_webhook_dlq`**: any rows = dispatch failures to triage (categorical only —
  safe to read).
- **Stuck apps**: `awaiting_consumer_report` rows older than the expected
  invitation+report turnaround = applicants who didn't finish one of the two hosted
  flows, or a webhook delivery gap on one vendor.

---

## File index

| Concern | Location |
|---|---|
| Dark gate + dual order creation | `src/modules/application/service.ts:307`, `:377` |
| Checkr outbound (candidate→invitation, Basic auth) | `src/modules/screening/background-check.ts:105`–`151` |
| Checkr report mapper (B2 field-paths) | `src/modules/screening/background-check.ts:261`, `:325` |
| TU ShareAble outbound (applicant→screening-request, Bearer auth) | `src/modules/screening/credit-check.ts:65`–`152` |
| TU ShareAble report mapper (B2 field-paths) | `src/modules/screening/credit-check.ts:142` |
| Webhook receiver (3-path, per-vendor HMAC, dispatch) | `src/modules/screening/cra-webhook.ts` |
| Checkr event translation + join key | `src/modules/screening/cra-webhook.ts` (`translateCheckrEvent`) |
| ShareAble event translation + join key | `src/modules/screening/cra-webhook.ts:288`–`345` |
| Advance-when-both-in | `src/modules/screening/cra-webhook.ts` (`advanceIfBothReportsIn`) |
| §1681i `report.disputed` → no-HOLD | `src/modules/screening/cra-webhook.ts` (`isTerminalFailure`, both status maps) |
| FCRA consent capture | `src/modules/screening/consumer-report-consent.ts` |
| Adverse-action notice (CRA contact env) | `src/modules/adverse-action/service.ts:28`–`30` |
| Schema (already in prod) | `src/db/migrations/2026-06-01-applications-consumer-report.sql`, `2026-06-01-fcra-consent.sql` |
