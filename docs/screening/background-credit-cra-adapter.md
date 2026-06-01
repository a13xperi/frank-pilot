# Background + Credit (CRA) Adapter — Build Plan

Status: Design, ready to build. Branch `feat/screening-background-credit`. Not deployed.
Owner: Frank-Pilot CDPC engineering. Audience: Frank, engineering, compliance counsel.
Created: 2026-06-01. Supersedes `custom-screening-engine.md` §7 vendor-SDK steps (see §0).

This is the next vendor adapter after Stripe Identity (#244). It covers the two
**consumer-report (FCRA-regulated) checks**: background/criminal and credit/eviction.
The vendor selection was already ratified — **Checkr** (background/criminal) and
**TransUnion ShareAble** (credit/eviction), per `custom-screening-engine.md` §3.1/§3.2.
This doc does NOT re-open vendor choice; it corrects *how* they integrate given two
things that landed after that doc was ratified: the #243 vendor seam and the #244
async template.

---

## 0. What changed since `custom-screening-engine.md` (the correction)

That doc (ratified 2026-05-27) says, in §7 "Vendor SDK implementations":

> Replace the **synchronous stub** in `background-check.ts` with the Checkr SDK call.
> Replace the **synchronous stub** in `credit-check.ts` with the TransUnion ShareAble call.

Both halves of that instruction are now wrong:

1. **#243 (vendor seam) moved the synchronous stub.** `background-check.ts` and
   `credit-check.ts` no longer contain a `throw "Production API integration not yet
   configured"` placeholder. They call `resolveVendor("background"|"credit").background|credit(input)`
   (`background-check.ts:89`, `credit-check.ts:69`). The synchronous vendor code now
   lives in `src/modules/screening/vendors/` (the `ScreeningVendor` interface,
   `types.ts:157`).

2. **More fundamental: Checkr and TU ShareAble are NOT synchronous.** They are
   **asynchronous, applicant-mediated, webhook-completion CRAs** — the same shape as
   Stripe Identity. A synchronous `background(input): Promise<BackgroundVendorResponse>`
   that returns criminal/credit *facts in one call* cannot drive an applicant who must
   authorize the pull, pass KBA identity questions, and wait minutes-to-hours for county
   criminal searches to clear. The #243 seam method signature has **no `applicationId`
   and no DB access** (`types.ts:33-48`) — it physically cannot read a webhook-delivered
   report back. So the CRA pull does **not** belong in the seam at all.

**The correct pattern is the one #244 just proved for Stripe Identity** — and note that
identity is deliberately **not** in the vendor seam (the `ScreeningVendor` interface has
`background/credit/income/nsopw/employment` methods, *no* `identity`). Async,
applicant-mediated checks live in their own service with a `create → webhook → resolve`
lifecycle, gated behind a flag, byte-identical when dark.

---

## 1. The architecture (mirror #244)

```
                                              ┌──────────── Checkr / TransUnion (hosted) ───────────┐
 applicant submits        server             │                                                      │
 ──────────────►  submit()  ──────────────►  createReport(applicationId)  ── invitation url ──►  applicant
                    │  (armed path)            CRA report/order created          authorizes + KBA + (pays)
                    │                                                                   │              │
        status: submitted ─► awaiting_consumer_report                                  ▼              │
                                                       report.completed / order.fulfilled (WEBHOOK)    │
                                                                     │                                 │
                       POST /api/screening/cra-webhook  ◄────────────┘  (NEW raw-body verified route)  │
                                  │  map report → BackgroundVendorResponse / CreditVendorResponse-shaped │
                                  │  persist categorical verdict + report ref onto application row       │
                                  ▼                                                                      │
                  awaiting_consumer_report ─► screening   ──►  runFullScreening()                        │
                                                              background.resolve(applicationId) = READ ──┘
                                                              credit.resolve(applicationId)     = READ
                                                              (no report yet / pending → could_not_screen HOLD)
                                                                       │
                                                                       ▼
                                       criminal records[] → hud-criminal-decision.ts (#245, CRIMINAL_DECISION_ENGINE_ENABLED)
                                       any fail → screening_failed → adverse-action (§1681m, EXISTING)
```

- **Chosen:** create-at-submit · applicant-mediated authorization on the CRA's hosted
  flow · webhook lands the report · screening **reads** the persisted verdict. Identical
  to #244, extended to two reports.
- **Rejected:** server-side synchronous pull (decrypt `ssn_encrypted`, POST full PII to
  the CRA, block on the response). It (a) fits the seam but criminal county searches are
  async anyway so it would still churn `could_not_screen`, (b) forces us to transmit and
  hold full-SSN + raw consumer-report PII — directly against our PII rule and a far larger
  FCRA/security burden, and (c) requires us to build standalone FCRA disclosure +
  authorization capture ourselves. The applicant-mediated flow puts disclosure +
  authorization + identity (KBA) on the CRA's compliant hosted flow.
- **New state(s):** one of `awaiting_consumer_report` (between `submitted` and `screening`)
  — analogous to `awaiting_identity` (`2026-06-01-applications-identity-session.sql:25`).
  If identity and CRA both gate submit, the order is `submitted → awaiting_identity →
  awaiting_consumer_report → screening`; a single combined `awaiting_screening` state is an
  acceptable simplification (decide at build time — see §8 open items).

### Why background and credit are ONE effort but TWO reports

Checkr (background) and TU ShareAble (credit) are separate vendors with separate
webhooks and separate report references, but they share: the same new state, the same
submit-time "create both reports" step, the same consent capture, and the same resolve
pattern. Build them together; persist two independent verdicts
(`background_check_*` and `credit_check_*` columns already exist).

---

## 2. Vendor mapping (ratified — not re-opened here)

| Domain | Primary | Fallback | Integration shape | Contract status |
|---|---|---|---|---|
| Background / criminal | **Checkr** | Certn | candidate + invitation → hosted consent → `report.completed` webhook | RFQ sent 2026-05-27; `vendor-scoring-matrix.md` **unfilled** → not signed |
| Credit / eviction | **TransUnion ShareAble** | Experian Connect | applicant KBA + authorization → report-ready callback/webhook | same |

`vendor-scoring-matrix.md` is a template with all cells `_/10` → **no contract is signed
and no API credentials exist yet.** Credentialing + FCRA use-case review takes 2-6 weeks
after signing (`vendor-scoring-matrix.md:49`). This gates the *live* integration, not the
*structure* — see §4 split.

---

## 3. Field mapping (CRA report → existing response shapes)

The vendor reports map onto the **existing** response/result shapes so
`BackgroundCheckService.evaluateResults` + the #245 HUD engine + `CreditCheckService.evaluateResults`
stay single-sourced and unchanged.

**Checkr `report` → `BackgroundVendorResponse`** (`types.ts:42`) — but routed via
`background-check.ts` resolve, not the seam:

| Field | Source | Rule |
|---|---|---|
| `records[]` | `report.{ssn_trace,sex_offender_search,national_criminal_search,county_criminal_searches[],eviction_search}` | normalize each charge to the `CriminalRecord` shape `hud-criminal-decision.ts:128` consumes (category, disposition, date) — `records[]` is authoritative; summary flags are derived only as a fallback |
| `sexOffenses` | `report.sex_offender_search.records` non-empty | → §5.856 mandatory denial path |
| `felonies` / `violentCrimes` / `misdemeanors` | derived from `records[]` charge severity | feeds legacy path only when `CRIMINAL_DECISION_ENGINE_ENABLED` is off |
| eviction | `report.eviction_search` | NOTE: evictions also arrive via TU credit; dedupe by case (see §8) |
| `rawResponse` | — | persist **only** `{reportId, candidateId, status, per-search statuses, adjudication}` — never charge narratives, addresses, full DOB/SSN |

**TU ShareAble → `CreditVendorResponse`** (`types.ts:60`):

| Field | Source | Rule |
|---|---|---|
| `creditScore` | ShareAble ResidentScore / credit score | `>=600` pass (`credit-check.ts` threshold, unchanged) |
| `evictions` | ShareAble eviction-history count | `>0` → auto-fail (unchanged) |
| `bankruptcies` | public-records section | `>0` → auto-fail (unchanged) |
| `collections` / `outstandingDebts` / `paymentHistory` | tradeline summary | informational + soft-risk |
| `rawResponse` | — | persist **only** `{reportId, score, categorical counts}` — never tradeline detail |

The exact JSON field paths are **credentialing-gated** (need the real API docs + a
sandbox account). The mapper is written against Checkr's / TU's published report schema
with a `// TODO(credentialing): confirm field path` marker on each path until verified
against a live sandbox response.

---

## 4. Files to change — split by what gates them

### Ships DARK now (contract-independent structure — same as #244 built before Stripe was live)

1. `src/db/migrations/2026-06-0X-applications-consumer-report.sql` — `ALTER TYPE
   application_status ADD VALUE IF NOT EXISTS 'awaiting_consumer_report'` (**outside a
   txn** — same constraint as `2026-06-01-applications-identity-session.sql:25`) +
   `background_report_id TEXT`, `credit_report_id TEXT`, `consumer_report_*_status TEXT`,
   `screening_authorization_at TIMESTAMPTZ`. Background/credit verdict columns already
   exist (`background_check_*`, `credit_check_*`, `credit_score`).
2. `src/modules/screening/background-check.ts` — add `createReport(applicationId)` +
   `resolve(applicationId)` (read webhook-persisted verdict, `could_not_screen` HOLD if
   pending/missing) + pure `mapCheckrReportToResponse(report)`. **Keep `runCheck()` and the
   seam path verbatim** for MOCK/stub/flag-off (byte-identical dark) — exactly how
   `identity-verification.ts` kept `verify()` alongside `resolve()`.
3. `src/modules/screening/credit-check.ts` — mirror: `createReport` / `resolve` /
   `mapShareAbleReportToResponse`; keep `runCheck()` + seam path verbatim.
4. `src/modules/screening/service.ts` — `runFullScreening` calls `background.resolve(id)` /
   `credit.resolve(id)` on the armed path instead of `runCheck(...)` (identical result
   shape; aggregation `service.ts:523-544` + the `individualized_assessment_required`
   routing `service.ts:559-560` unchanged).
5. `src/modules/screening/state-machine.ts` — register `awaiting_consumer_report` +
   transitions (`submitted → awaiting_consumer_report`,
   `awaiting_consumer_report → {screening, screening_review}`).
6. `src/modules/application/service.ts` — `submit()`: on armed path call
   `createReport()` for both domains and transition to `awaiting_consumer_report`. Flag-off
   path unchanged.
7. New flags in `.env.example`: `BACKGROUND_CHECK_ENABLED=false`,
   `CREDIT_CHECK_ENABLED=false` (or a single `CONSUMER_REPORT_ENABLED`), independent of
   `SCREENING_ON_SUBMIT_ENABLED`. Document that `SCREENING_VENDOR_BACKGROUND=checkr` /
   `SCREENING_VENDOR_CREDIT=transunion` only matter for the (now sandbox-only) seam path.
8. `src/__tests__/background-check-cra.test.ts`, `credit-check-cra.test.ts` — table-driven
   `mapXReportToResponse` + `resolve` gating (pending → `could_not_screen`; mandatory-denial
   record → fail; clean → pass) using **synthetic** report fixtures. No live calls.
9. `src/__tests__/cra-webhook.test.ts` — mirror `payment-webhook.test.ts` /
   `identity-webhook.test.ts`: signature verification, idempotency, the new event types.

### Credentialing-gated (needs signed contract + sandbox keys — do NOT guess-and-ship)

10. `src/modules/screening/cra/` (or inside the two services) — the real HTTP client:
    Checkr candidate/invitation/report create; TU ShareAble order create; the exact field
    paths in the two mappers (replace the `// TODO(credentialing)` markers); webhook
    signature secrets (`CHECKR_WEBHOOK_SECRET`, TU equivalent).
11. `src/modules/payment/webhook.ts` *or* a new `src/modules/screening/cra-webhook.ts`
    route — the live event handlers. (Structure can ship dark with a `not-yet-configured`
    guard; the live mapping is gated.)
12. Set `CRA_NAME` / `CRA_ADDRESS` / `CRA_PHONE` (`adverse-action/service.ts:28-31`) to the
    actual signed CRA — the adverse-action notice already renders them.

---

## 5. FCRA build delta

What already exists (do not rebuild):

- **§1681m adverse-action notice** — `adverse-action/service.ts` `buildNoticeText` renders
  CRA name/address/phone + the right-to-free-report-within-60-days + dispute rights +
  "CRA did not make this decision." Wired into the screening fail path
  (`service.ts` automated `reasonDetail`). **EXISTING.**
- **HUD individualized assessment** for criminal — `hud-criminal-decision.ts` (#245),
  flag `CRIMINAL_DECISION_ENGINE_ENABLED`. Criminal `records[]` from the Checkr mapper feed
  it directly. **EXISTING.**
- **Permissible purpose** (§1681b(a)(3)(F)) — the rental application is a consumer-initiated
  transaction; the CRA contract carries Frank's permissible-purpose certification.
  **Vendor-side / contractual.**

What is NEW for this adapter:

- **Applicant authorization / consent capture.** ✅ **BUILT (server-side), dark behind
  `CONSUMER_REPORT_ENABLED`.** `screening/consumer-report-consent.ts` holds a versioned
  clear-and-conspicuous disclosure (`FCRA_DISCLOSURE_VERSION` / `_TEXT` + SHA-256
  `fcraDisclosureHash`) and `recordAuthorization()` writes a durable
  `consumer_report_authorizations` row (who / when / version / text-hash / method / IP /
  UA — same evidentiary shape as `lease_signatures`) + a `consumer_report_authorized`
  audit entry. `submit()` now **gates** the Checkr/TU pull on a valid authorization:
  honor one already on file (idempotent re-submit) or capture a freshly-affirmed consent;
  absent/stale ⇒ no orders, app stays `submitted`, and the route returns 400 +
  `{disclosure}` (fail-loud, never an unauthorized pull). `screening_authorization_at`
  is now bound to the **actual authorization timestamp**, not order-creation `NOW()` (the
  prior semantic bug). The wizard renders the disclosure from
  `GET /me/applications/consumer-report-disclosure` and posts `consumerReportConsent`
  (server trusts the observed IP/UA). We do **not** build a standalone-disclosure document
  (the vendor hosts it). Remaining: the in-app checkbox UX in the apply wizard (see §8 —
  behind the frozen tenant-e2e `Step` union). Migration: `2026-06-01-fcra-consent.sql`.
- **Pre-adverse-action window** (ratified 5 **business** days, `custom-screening-engine.md`
  §8.3). Today only the final notice is sent. Needs `pre_adverse_action_sent_at` column +
  a daily reaper that sends the final notice once 5 business days elapse + a pre-adverse
  template in `AdverseActionService`. **NEW.**
- **§1681i disputes** — ratified = link to the CRA's hosted dispute portal from the
  adverse-action letter; receive resolution via webhook (`custom-screening-engine.md` §8.6).
  Low lift. **NEW (small).**

---

## 6. Safety & flags

- **New flag(s)** default OFF; flag-off = byte-identical (the seam → sandbox →
  `STUB_GATE_ERROR` → `could_not_screen` HOLD path is untouched and remains the keyless-prod
  behavior). The dark structure adds the `createReport`/`resolve`/webhook code but it is
  unreachable until the flag is ON.
- **Fail-loud, never silent pass:** `resolve` returns a stored verdict or
  `could_not_screen`; an unmappable webhook → throw → DLQ + the app stays HOLD; the
  `STUB_GATE_ERROR` gate is untouched. Aggregation precedence (`fail > could_not_screen >
  review_required > pass`, `service.ts:523-544`) guarantees a misconfigured pipeline cannot
  reach `screening_passed`.
- **PII/FCRA:** full SSN + raw consumer-report PII (charge narratives, tradelines,
  addresses) live on the CRA. We persist ONLY the report reference (`*_report_id`) +
  categorical statuses + counts + error/adjudication codes. The applicant provides their
  full SSN to the CRA's hosted flow — we never transmit `ssn_encrypted` to the vendor on
  this path.

---

## 7. Verification + go-live sequence

**Local/unit (now):** `STRIPE_LIVE_ENABLED=false npm test`. New suites green; `service`
tests updated (`runCheck` → `resolve` on the armed path); assert mandatory-denial record →
fail + adverse-action, pending → `could_not_screen` → `screening_review`, clean → pass.

**Credentialing-gated (after contract):** Checkr + TU sandbox accounts → run a real
applicant through each hosted flow → confirm the webhook lands `report.completed` /
order-ready, the row gets the verdict, screening proceeds. Force a criminal hit → §5.856 /
individualized-assessment. Force never-completed → `could_not_screen` → `screening_review`.

**Prod go-live (ordered, after credentialing):**
1. Apply the migration (ADD VALUE outside txn).
2. `railway up` with the new flag(s) OFF (webhook cases ride dark) — deploy from the
   `fp-deploy` production-linked worktree (`reference_frank_no_staging_env`).
3. Register the Checkr + TU webhooks; set `CHECKR_API_KEY` / TU creds + webhook secrets +
   `SCREENING_VENDOR_BACKGROUND`/`_CREDIT` + `CRA_*` env.
4. Clear the demo posture (prod is `MOCK_MODE=1` — a flag flip alone runs MOCK, not the real
   CRA; `reference_frank_no_staging_env`).
5. Flip the new flag(s) ON (staff still manual `/screen`). After clean live reports, flip
   `SCREENING_ON_SUBMIT_ENABLED`.
6. **Rollback:** flag(s) OFF reverts to prior behavior, no redeploy.

Deploy mechanics (memory): api = manual `railway up --ci --service api` from the
production-linked `fp-deploy` worktree; `.railwayignore` required; new-route 404→401 =
liveness canary.

---

## 8. Open items to decide at build time

- **One new state or two?** `awaiting_consumer_report` alone, or split identity vs CRA
  waits. Recommendation: one combined `awaiting_consumer_report` (identity already has its
  own `awaiting_identity`; chaining two waits is fine, a single combined gate is simpler).
- **Eviction dedupe.** Evictions surface from BOTH Checkr (`eviction_search`) and TU
  (credit eviction history). Decide the authoritative source (recommend TU credit, since
  eviction is a credit/public-records signal) to avoid double-counting in the verdict.
- **Consent UX placement.** ✅ Server side **DONE** (see §5 — `consumer-report-consent.ts`,
  the `submit()` gate, `GET .../consumer-report-disclosure`, and the 400+`{disclosure}`
  contract). Remaining = the apply-wizard checkbox itself: the `Step` union is a frozen
  contract behind the required tenant-e2e gate (`project_tenant_e2e_gate`), so the checkbox
  (render disclosure → tick → POST `consumerReportConsent` with `disclosureVersion`) needs
  its own focused client change, like #244's deferred Stripe redirect step.
- **Combined create.** Whether `submit()` creates both reports eagerly or lazily at first
  `/screen`. Recommend eager-at-submit (matches #244 createSession) when the flag is on.
