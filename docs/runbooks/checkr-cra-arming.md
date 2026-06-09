# Runbook — Arming the Checkr CRA integration

**Status:** Built, merged, deployed **dark**. PR #276 (squash `a19b5b0`), deployed to
prod 2026-06-09 (Railway `api` / `frank-pilot-api` / production, host
`api-production-ed89.up.railway.app`). Currently inert: `CONSUMER_REPORT_ENABLED`
is unset, so `submit()` takes the legacy synchronous `runCheck()` path,
byte-identical to pre-CRA.

This runbook flips the real Checkr consumer-report flow live. **Read the two
blockers first — you cannot safely flip the master flag today.**

---

## What "armed" means

When `CONSUMER_REPORT_ENABLED=true`, application `submit()` stops auto-screening
synchronously and instead:

1. Captures / honors the FCRA §1681b authorization (no consent ⇒ 400 + disclosure, no pull).
2. Creates **two** report orders in parallel — Checkr background **and** TransUnion
   ShareAble credit — and parks the app in `awaiting_consumer_report`, returning the
   hosted invitation URL(s).
3. The applicant completes Checkr's hosted invitation (which collects full SSN/DOB
   directly — we never send it).
4. Checkr posts `report.*` events to `POST /api/webhooks/cra`; the receiver
   HMAC-verifies, maps **categorical-only** fields, and persists the verdict.
5. Once **both** reports land, the app advances `awaiting_consumer_report → screening`
   (and the pipeline runs only if `SCREENING_ON_SUBMIT_ENABLED=true`).

```
submit() ─[consent ok]─> Checkr.createReport ┐
                         TU.createReport      ├─ Promise.all ─> awaiting_consumer_report
                                              ┘                        │
   applicant completes hosted invitation ─────────────────────────────┤
                                                                       ▼
   Checkr webhook ─[X-Checkr-Signature HMAC]─> dispatch ─> persist categorical verdict
                                                                       │
                            both background + credit completed_at set? ─┤
                                                       no ─> wait ◀─────┘
                                                       yes ─> advance ─> screening
                                                                (kicks pipeline iff
                                                                 SCREENING_ON_SUBMIT_ENABLED)
   terminal status (canceled/suspended/disputed) OR invitation expired/deleted
        └─> HOLD in screening_review (never an auto-pass)
```

---

## ⛔ Blockers — do NOT flip the prod flag until both are cleared

### B1. The credit half is a stub — arming is all-or-nothing

There is **one** master gate (`CONSUMER_REPORT_ENABLED`), no per-vendor flag.
`submit()` creates both orders together:

```ts
// src/modules/application/service.ts:377
const [background, credit] = await Promise.all([
  new BackgroundCheckService().createReport({...}),   // Checkr — real
  new CreditCheckService().createReport({...}),        // TransUnion — STUB, throws
]);
```

`CreditCheckService.createReport()` throws `"TransUnion ShareAble credit report
integration not yet configured"` (`src/modules/screening/credit-check.ts:76`).
`Promise.all` rejects → the `catch` logs and leaves the app in `submitted`
(fail-loud, never fall-through). And even if it didn't throw,
`advanceIfBothReportsIn` requires **both** `*_completed_at` set, so a
background-only app would sit in `awaiting_consumer_report` forever.

**⇒ Flipping `CONSUMER_REPORT_ENABLED=true` with Checkr alone breaks every
consented submission.** Clear B1 by **either**:

- **(A) Arm both vendors** — build the TransUnion ShareAble adapter (Chunk 4) and
  arm it alongside Checkr. Preferred for product-completeness; both run as designed.
- **(B) Decouple credit (code change)** — make the credit order optional behind a
  flag/credential check (skip `TU.createReport` when unarmed) **and** relax
  `advanceIfBothReportsIn` to advance on background-only when credit was never
  ordered. Lets Checkr go live independently. Requires a small PR + the same
  audit/test bar; not a config-only change.

### B2. Report field-paths are unverified vs a live sandbox (fail-OPEN risk)

`mapCheckrReportToResponse` (`background-check.ts:261`, `TODO(credentialing)`) reads
nested records straight off the webhook event object:

```ts
report?.sex_offender_search?.records
report?.national_criminal_search?.records / .charges
report?.county_criminal_searches[].records / .charges
```

…and `translateCheckrEvent` (`cra-webhook.ts:227`) sets `report = body.data.object`
(the event payload), with no fetch/expansion.

Checkr's `report.completed` object commonly carries **references** to its component
screenings (IDs/URIs), **not** inline expanded records. If that's the case here,
every mapper lookup resolves to `[]` → `felonies:0, sexOffenses:false` → a
**false-clean PASS**. That is fail-open and unacceptable.

**⇒ Before arming, against a live Checkr sandbox, confirm the webhook object
actually contains the inline search records.** If it carries references instead,
add a `GET /v1/reports/{id}` (with the appropriate `?include=`/screening
expansion) in `translateCheckrEvent`/`dispatch` before mapping. Verify a known
sandbox felony/sex-offender fixture maps to the correct non-clean verdict (not 0).
Also confirm the charge field paths in `mapCheckrCharge` (`:325`,
`classification`/`charge`/`description`).

---

## Environment variables

Set on Railway: `frank-pilot-api` → **production** → `api` service. (`railway
variables` defaults to prod regardless of link — always pass `-e production`.)

| Var | Read at | Required | Notes |
|---|---|---|---|
| `CONSUMER_REPORT_ENABLED` | `application/service.ts:307` | **the switch** | `true` arms the flow. Flip **last**, only after everything else is set and B1/B2 cleared. |
| `CHECKR_API_KEY` | `background-check.ts:106` | **yes** | Checkr secret key. Basic auth = `base64(key + ":")`. Also the fallback webhook secret. Never `changeme`/empty (those keep it dormant, fail-loud). |
| `CHECKR_PACKAGE` | `background-check.ts:123` | **yes** | Account-specific package slug. Default `tasker_standard` is a guess — set the real provisioned package. |
| `CHECKR_API_URL` | `background-check.ts:120` | sandbox only | Defaults to `https://api.checkr.com`. Point at the Checkr **sandbox** base during Phase 1; leave default (or set prod base) when live. |
| `CHECKR_WEBHOOK_SECRET` | `cra-webhook.ts:516` | **yes** | HMAC key for `X-Checkr-Signature`. If unset, falls back to `CHECKR_API_KEY`. Missing/`changeme` ⇒ webhook 503 fail-closed (this is the dark canary). Set explicitly to whatever Checkr signs with. |
| `SCREENING_ON_SUBMIT_ENABLED` | `cra-webhook.ts:394`, `service.ts:461` | **yes (to screen)** | If not `true`, the app advances to `screening` after both reports land but the **pipeline never runs** — it rests un-adjudicated. Set `true` so verdicts are actually evaluated. |
| `CRA_NAME` | `adverse-action/service.ts:28` | **yes (FCRA)** | Names the CRA in the §1681m adverse-action notice. Default `"Acme Background & Credit Services"` is a placeholder — **must** be the real CRA identity or the notice is non-compliant. |
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

- [ ] Checkr account: signed CRA agreement, **sandbox** + production API keys.
- [ ] A real Checkr **package** slug provisioned for the tenant.
- [ ] Webhook signing secret from Checkr (or confirm Checkr signs with the API key).
- [ ] Real CRA contact identity (name / address / phone) for adverse-action notices.
- [ ] **Decide B1**: build TransUnion ShareAble (Chunk 4) **or** approve the
      decouple-credit code change.

### Phase 1 — Sandbox validation (clears B2; no prod flag, do this now)

Runs entirely against Checkr sandbox; does **not** touch the prod master flag.

1. In a staging/sandbox env set `CHECKR_API_KEY` (sandbox), `CHECKR_API_URL`
   (sandbox base), `CHECKR_PACKAGE`, `CHECKR_WEBHOOK_SECRET`,
   `CONSUMER_REPORT_ENABLED=true`, `SCREENING_ON_SUBMIT_ENABLED=true`.
2. Register the sandbox webhook → `https://<staging-api>/api/webhooks/cra`.
3. Drive a submit with consent → confirm a Checkr candidate + invitation are
   created and the app parks in `awaiting_consumer_report`.
4. Complete the hosted invitation with Checkr's sandbox fixtures, including a
   **felony** and a **sex-offender** fixture.
5. **B2 assertion:** confirm those map to the correct non-clean verdict
   (`felonies > 0` / `sexOffenses true` / lifetime-registrant), **not** a
   false-clean 0. If they map clean, the webhook object lacks inline records —
   add the report/screening expansion fetch (see B2) and re-test.
6. Verify signature handling: tampered body / wrong secret → 401; missing secret
   → 503; valid → processed. Verify terminal events (`report.suspended`, etc.)
   HOLD in `screening_review`, never pass.
7. Verify PII discipline: `background_check_details.rawResponse` and the audit log
   hold categorical fields only — no charge narratives, addresses, full SSN/DOB.

### Phase 2 — Clear B1

Ship whichever of (A) build TU ShareAble or (B) decouple-credit you decided in
Phase 0, through the normal PR + Opus audit + required-checks bar. Do not proceed
to prod arming until `submit()` can create its order set without throwing and an
app can reach `screening` end-to-end.

### Phase 3 — Production arming

1. Set the production env vars (all of the table above except, if you took path B,
   the credit-specific ones). Set `CONSUMER_REPORT_ENABLED` **last**.
   ```bash
   cd /Users/a13xperi/projects/fp-deploy   # prod-linked worktree
   railway variables -e production --service api \
     --set CHECKR_API_KEY=... \
     --set CHECKR_PACKAGE=... \
     --set CHECKR_WEBHOOK_SECRET=... \
     --set SCREENING_ON_SUBMIT_ENABLED=true \
     --set CRA_NAME='...' --set CRA_ADDRESS='...' --set CRA_PHONE='...'
   # then, only after verifying the above took effect:
   railway variables -e production --service api --set CONSUMER_REPORT_ENABLED=true
   ```
   (A var change triggers a redeploy; if not, `railway redeploy --service api`.)
2. Register the **production** Checkr webhook → `https://api-production-ed89.up.railway.app/api/webhooks/cra`,
   subscribed to `report.completed`, `report.canceled`/`report.cancelled`,
   `report.suspended`, `report.disputed`, `invitation.expired`,
   `invitation.deleted` (others are harmless no-op 200s).

### Phase 4 — Post-arm verification

- [ ] `curl https://api-production-ed89.up.railway.app/health` → 200, `db:ok`.
- [ ] Dark canary is now **armed**: a `POST /api/webhooks/cra` with
      `X-Checkr-Signature` and a *bad* signature → **401** (was 503 when dark).
      A valid Checkr test event → 200.
- [ ] One real end-to-end: submit with consent → invitation issued → complete →
      `report.completed` → app advances to `screening` → verdict adjudicated →
      categorical-only persistence + audit log.
- [ ] `cra_webhook_dlq` empty (no dispatch failures); `cra_processed_events`
      shows the event (idempotency).

---

## Webhook reference

- **Route:** `POST /api/webhooks/cra` (mounted raw-body, before `express.json()`).
- **Auth:** `X-Checkr-Signature` = HMAC-SHA256 (hex, optional `sha256=` prefix) of
  the raw body, keyed by `CHECKR_WEBHOOK_SECRET` (or `CHECKR_API_KEY`). Constant-time compare.
- **Join key:** `data.object.candidate_id` → `applications.background_report_id`
  (candidate.id persisted at create; the invitation flow has no report id yet).

| Checkr event | Internal status | Effect |
|---|---|---|
| `report.completed` | `complete` | Map + persist verdict; advance if both reports in |
| `report.canceled` / `report.cancelled` | `canceled` | **HOLD** screening_review (could_not_screen) |
| `report.suspended` | `suspended` | **HOLD** |
| `report.disputed` | `disputed` | **HOLD** |
| `invitation.expired` / `invitation.deleted` | `canceled` | **HOLD** (applicant never completed) |
| anything else (`report.created`, `invitation.created`, unknown candidate) | — | 200 ack, no-op |

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
   creates orders). Either re-arm to let pending reports land, or manually
   transition those apps (`awaiting_consumer_report → screening`/`submitted`) and
   reconcile. Enumerate them first:
   `SELECT id FROM applications WHERE status = 'awaiting_consumer_report';`
3. To hard-close the receiver, unset `CHECKR_WEBHOOK_SECRET` (and don't fall back) —
   the route returns 503 fail-closed. (Leaving the route up but 401-ing bad sigs is
   fine; Checkr will retry, so prefer re-arming over dropping events.)

---

## Monitoring

- **Logs** (`railway logs --service api`): `Failed to create consumer-report orders
  on submit` (B1 symptom), `CRA * verdict ignored — app not awaiting consumer
  report` (late/duplicate, benign), `Post-consumer-report screening pipeline failed`.
- **`cra_webhook_dlq`**: any rows = dispatch failures to triage (categorical only —
  safe to read).
- **Stuck apps**: `awaiting_consumer_report` rows older than the expected
  invitation+report turnaround = applicants who didn't finish or a webhook
  delivery gap.

---

## File index

| Concern | Location |
|---|---|
| Dark gate + dual order creation | `src/modules/application/service.ts:307`, `:377` |
| Checkr outbound (candidate→invitation, Basic auth) | `src/modules/screening/background-check.ts:105`–`151` |
| Report mapper (B2 field-paths) | `src/modules/screening/background-check.ts:261`, `:325` |
| Webhook receiver (dual-path, HMAC, dispatch) | `src/modules/screening/cra-webhook.ts` |
| Checkr event translation + join key | `src/modules/screening/cra-webhook.ts:227` |
| Advance-when-both-in | `src/modules/screening/cra-webhook.ts:364` |
| Credit stub (B1) | `src/modules/screening/credit-check.ts:65` |
| FCRA consent capture | `src/modules/screening/consumer-report-consent.ts` |
| Adverse-action notice (CRA contact env) | `src/modules/adverse-action/service.ts:28`–`30` |
| Schema (already in prod) | `src/db/migrations/2026-06-01-applications-consumer-report.sql`, `2026-06-01-fcra-consent.sql` |
