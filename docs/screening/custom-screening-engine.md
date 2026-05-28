# Custom Tenant-Screening Engine — Design + Phase 4 Build Plan

Status: Draft, design-only. Branch `feat/screening-engine-design`. Not deployed.
Owner: Frank-Pilot CDPC engineering. Audience: Frank, engineering, compliance counsel.
Last updated: 2026-05-27.

This is the architectural anchor + skeleton for the screening engine that replaces
the screening surface of an off-the-shelf PMS compliance module. It documents the
design decisions, vendor selection, FCRA/HUD mapping, state machine, audit log,
backtest harness, and a phased build plan that slots into Phase 4 of the existing
Frank-Pilot onboarding master plan.

---

## 1. Executive Summary

**Build vs agency:** Build in-house. We already own ~70% of the surface
(`src/modules/screening/` exists, the compliance engine is full HUD AMI + Form
8609, the immutable audit chain is live via `compliance_tape`, AES-256 PII
encryption is in `src/utils/encryption.ts`, and the FCRA adverse-action notice
generator is already wired into the failure path). What is missing is identity
verification, a real income-verification path (Plaid), a formal state machine,
and a backtest harness. Each of those is a discrete extension — none of them
require replacing what is already shipped. A third-party screening platform
would force us to give up the compliance bridge to `compliance_tape`, our
existing HUD individualized-assessment matrix at `docs/screening/hud-criminal-decision-matrix.md`,
and the audit chain that the rest of the platform already depends on.

What changes from today:

- Identity-verification layer (Persona primary, Stripe Identity fallback) added
  in front of the parallel checks. Today there is no biometric ID step.
- State machine formalized as a typed module with a transition table. Today
  state lives implicitly in `applications.status` and is updated ad-hoc.
- Existing `FraudDetectionService` (duplicate SSN, address fraud, income
  mismatch, approval speed) wired into `runFullScreening` as the early-exit
  fraud-screening step. Today it is built but never called from the orchestrator.
- Plaid Income as the real-time bank-linked income-verification path, with
  Equifax Work Number (already stubbed on PR #201) as the W-2 fallback.
- Backtest harness as a first-class artifact: replay synthetic and (later) real
  historical applicants through the full engine before any vendor swap or rule
  change. No more "deploy and hope."

Layer-by-layer map from the original 4-layer spec to existing-or-new modules:

| Spec layer | What it is | Module / file | Status |
|---|---|---|---|
| 1. Workflow engine | Multitenant state machine that drives the screening pipeline | `src/modules/screening/state-machine.ts` (NEW) + `src/modules/screening/service.ts` (orchestrator) | Scaffolded this PR |
| 2a. Background + criminal | Checkr primary, Certn fallback | `src/modules/screening/background-check.ts` | Stub exists; vendor SDK Phase 4 wk6-10 |
| 2b. Credit + eviction | TransUnion ShareAble primary, Experian Connect fallback | `src/modules/screening/credit-check.ts` | Stub exists; vendor SDK Phase 4 wk6-10 |
| 2c. Income + employment | Plaid Income primary, Equifax Work Number fallback | `src/modules/screening/income-verification-plaid.ts` (NEW) + `src/modules/screening/work-number.ts` (PR #201) | Plaid stub scaffolded this PR; Work Number stub on PR #201 |
| 2d. LIHTC compliance | HUD AMI + IRS Form 8609 (60% threshold) | `src/modules/screening/compliance.ts` | Already complete; do not modify |
| 3a. Identity (biometric ID) | Persona primary, Stripe Identity fallback | `src/modules/screening/identity-verification.ts` (NEW) | Scaffolded this PR |
| 3b. Device + IP fraud | Sardine or Socure — deferred to Phase 5+ | n/a | Deferred; existing `FraudDetectionService` is sufficient for Phase 4 launch |
| 4a. Encryption at rest | AES-256 SSN + DOB | `src/utils/encryption.ts` | Already complete |
| 4b. TLS 1.2+ in transit | Railway/Vercel default | infra | Already complete |
| 4c. Adverse-action letters | FCRA §1681m generator | `src/modules/adverse-action/service.ts` | Already complete; wired into screening fail path |
| 4d. Immutable audit log | Append-only hash-chained ledger | `compliance_tape` table + `src/modules/tape/` + `src/middleware/audit.ts` | Already complete; extend with `screening.state_transition` kind |

---

## 2. Architecture

### 2.1 Pipeline (ASCII)

```
                          applicant submits
                                 |
                                 v
                       +---------------------+
                       |  state: queued      |
                       +---------------------+
                                 |
                                 v
              +--------------------------------------+
              |  identity verification               |
              |  (Persona / Stripe Identity)         |
              |  state: id_verifying -> id_verified  |
              +--------------------------------------+
                                 | reject? -> failed
                                 v
              +--------------------------------------+
              |  fraud screening                     |
              |  - duplicate SSN check               |
              |  - address-fraud lookup              |
              |  - approval-speed anomaly            |
              |  state: fraud_screening              |
              +--------------------------------------+
                                 | dup SSN -> manual_review (early exit)
                                 v
              +--------------------------------------+
              |  parallel checks (Promise.all)       |
              |  state: screening                    |
              +--------------------------------------+
                  |             |              |             |
                  v             v              v             v
            +-----------+  +---------+  +---------------+  +-----------+
            | bg/criminal| | credit  |  | income        |  | LIHTC     |
            | Checkr     | | TU SA   |  | Plaid / WN    |  | compliance|
            +-----------+  +---------+  +---------------+  +-----------+
                  |             |              |             |
                  +------+------+------+-------+
                                 |
                                 v
              +--------------------------------------+
              |  decision engine                     |
              |  any fail -> failed                  |
              |  any review_required -> manual_review|
              |  all pass -> passed                  |
              +--------------------------------------+
                                 |
                +----------------+----------------+
                |                |                |
                v                v                v
           +---------+      +----------+    +-----------+
           | passed  |      | manual_  |    | failed    |
           |         |      | review   |    |           |
           +---------+      +----------+    +-----------+
                                                  |
                                                  v
                                  +------------------------------+
                                  | adverse-action notice        |
                                  | (FCRA §1681m, 5-day window)  |
                                  +------------------------------+

Every transition writes:
  - audit_log (writeAuditLog)         <- everyday audit row
  - compliance_tape (new kind:        <- hash-chained, append-only
    screening.state_transition)
```

### 2.2 State Machine

States:

| State | Meaning | Terminal? |
|---|---|---|
| `queued` | Application submitted; waiting on screening initiator | No |
| `id_verifying` | Persona/Stripe Identity call in-flight | No |
| `id_verified` | Identity proof complete and passed | No |
| `fraud_screening` | Local fraud heuristics running | No |
| `screening` | Parallel vendor checks in-flight | No |
| `manual_review` | At least one check returned `review_required` (or a fraud flag fired without auto-fail) | No |
| `passed` | All checks pass; ready to hand off to approval-tier service | Yes |
| `failed` | At least one auto-fail; adverse-action notice fires | Yes |
| `withdrawn` | Applicant cancelled before terminal state | Yes |

Transitions (every transition fires `transition()` in `state-machine.ts` and
writes one audit row + one tape entry):

| From | To | Trigger |
|---|---|---|
| `queued` | `id_verifying` | `screening_initiated` (manual or auto) |
| `queued` | `withdrawn` | `applicant_withdrew` |
| `id_verifying` | `id_verified` | `identity_verification_passed` |
| `id_verifying` | `failed` | `identity_verification_failed` |
| `id_verifying` | `manual_review` | `identity_verification_inconclusive` |
| `id_verifying` | `withdrawn` | `applicant_withdrew` |
| `id_verified` | `fraud_screening` | `auto_advance` |
| `fraud_screening` | `screening` | `fraud_screening_clean` |
| `fraud_screening` | `manual_review` | `fraud_flag_raised` (non-dup-SSN) |
| `fraud_screening` | `failed` | `duplicate_ssn_detected` (early exit) |
| `fraud_screening` | `withdrawn` | `applicant_withdrew` |
| `screening` | `passed` | `all_checks_passed` |
| `screening` | `failed` | `any_check_failed` |
| `screening` | `manual_review` | `any_check_review_required` |
| `screening` | `withdrawn` | `applicant_withdrew` |
| `manual_review` | `passed` | `manual_override_pass` (staff: regional manager+) |
| `manual_review` | `failed` | `manual_override_fail` (staff: regional manager+) |
| `manual_review` | `withdrawn` | `applicant_withdrew` |

Terminal states `passed`, `failed`, `withdrawn` cannot transition out. Any
attempt by `transition()` throws.

### 2.3 Multitenancy

Frank-Pilot already supports multitenancy via property scoping: every screening
row, application, lease, and tape entry is FK'd to `property_id`. For Frank's
portfolio (~1,600 units across one operator, ~few hundred apps/month) **soft
isolation by `property_id` is sufficient**. We do not bolt on per-tenant
Postgres schemas, per-tenant databases, or row-level security (RLS) policies
in Phase 4.

When we onboard a second operator, the upgrade path is:

1. Add `operator_id` to properties (and propagate via FK).
2. Add RLS policies on the screening + tape tables keyed off
   `current_setting('app.operator_id')`.
3. Set `app.operator_id` per request in middleware.

That migration is well-understood and can be done without breaking Phase 4
work. Premature isolation (Temporal namespaces, per-tenant DBs) would slow
Phase 4 and buy nothing for a single-operator deployment.

### 2.4 Workflow-engine choice (Temporal vs in-process)

We do not need Temporal.io or AWS Step Functions for Frank's scale. Frank
processes a few hundred applications/month, each screening run is bounded
(timeout < 60s once vendor SDKs land), and the existing Postgres-backed audit
chain already gives us the durability and replay properties a workflow engine
provides. The state-machine module + the compliance tape + the existing
`adverse-action` cron is the canonical "in-process Postgres-backed workflow."

We revisit this if (a) throughput exceeds 10k apps/month, (b) we need to
coordinate cross-org workflows that span multiple wall-clock days with vendor
retries, or (c) the compliance auditor requires an external orchestration
substrate (open question §8).

---

## 3. Vendor Selection

For each layer below, **one primary and one fallback** are named, with rationale
keyed to Frank's scale and the FCRA workflow. Vendor SDK implementations are
out-of-scope for this PR — they are Phase 4 weeks 6-10 work after the RFQs
already sent in Phase 0 come back (see `docs/screening/vendor-rfq-template.md`).

### 3.1 Background + Criminal

| Primary | Checkr |
|---|---|
| Fallback | Certn |

Rationale: Checkr is the dominant US property-screening API, supports housing
tenant-screening per their FCRA-CRA contract terms (must be verified in the
RFQ response — see Phase 0 email sent 2026-05-27), and exposes the HUD-relevant
fields (lifetime sex-offender registry, drug-manufacture convictions,
3-year-window drug evictions) we need for the mandatory-denial floor in
`docs/screening/hud-criminal-decision-matrix.md`. Certn is the fallback because
their data coverage on US records is thinner than Checkr's but their adverse-
action workflow is FCRA-compliant out of the box, making the swap mechanical
if Checkr's RFQ comes back with terms we cannot accept.

### 3.2 Credit + Eviction

| Primary | TransUnion ShareAble |
|---|---|
| Fallback | Experian Connect |

Rationale: ShareAble is built for small-portfolio landlords and operators,
exposes both credit score and eviction history in a single API, and (critical
for Phase 4 launch) does not require Frank to become a permissioned-purpose
CRA reseller. Experian Connect is the fallback — better data depth but
heavier KYC burden on Frank's side.

### 3.3 Income + Employment

| Primary | Plaid Income |
|---|---|
| Fallback | Equifax Work Number (W-2 applicants only) |

Rationale: Plaid Income works for any applicant who can link a bank account
(direct-deposit, gig-economy, self-employed). Work Number only works for
salaried W-2 employees of subscribing employers; for Frank's tenant mix that
is roughly 50-60% coverage. Plaid is therefore the primary path; Work Number
is run in parallel only when the applicant declares a W-2 employer, as a
verification cross-check. Income mismatch between the two automatically fires
`FraudDetectionService.checkIncomeMismatch` and routes to manual review.

### 3.4 Identity (biometric ID)

| Primary | Persona |
|---|---|
| Fallback | Stripe Identity |

Rationale: Persona has a better adverse-action UX (a denied ID verification
can be retried with a different document type without re-collecting PII),
exposes a webhook for housing-specific KYC workflows, and supports custom
verification flows for HUD-mandated household member ID checks. Stripe
Identity is the fallback because Frank already has a Stripe relationship
(BP-08), so the contract burden is zero — but the UX is more rigid and the
data model is narrower.

### 3.5 Device + IP Fraud (deferred)

Sardine and Socure are the canonical options. **Deferred to Phase 5+** unless
we see fraud rate exceed 5% of applications in the first 60 days post-launch.
Frank's existing `FraudDetectionService` (duplicate SSN, known-bad-address
lookup, income mismatch, fast-approval anomaly) is sufficient for Phase 4
launch. If we add Sardine/Socure later, they slot in as an additional async
call inside `state: fraud_screening` — no architectural change needed.

---

## 4. FCRA + HUD Compliance Mapping

### 4.1 FCRA

| Requirement | Implementation | Status |
|---|---|---|
| §1681m adverse action notice | `AdverseActionService.sendNotice()` writes DB record + SMS via Twilio; fires automatically on `screening_result=fail` and on tier1/tier2 deny decisions | DONE — `src/modules/adverse-action/service.ts` |
| §1681m pre-adverse 5-day window | A pre-adverse notice must be sent ≥5 days before the final adverse-action notice. Today we only send the final notice. Needs (a) a `pre_adverse_action_sent_at` column on `applications`, (b) a daily cron that sends the final notice once 5 days have elapsed, (c) the pre-adverse template in `AdverseActionService` | NEW — outline in §7 step 4 |
| §1681i dispute handling | If applicant disputes a consumer report finding, we must (a) hold the application in `manual_review`, (b) forward the dispute to the CRA, (c) record outcome in the audit trail. Today there is no dispute endpoint | NEW — `POST /api/screening/:id/dispute` outlined in §7 step 4 |
| §604(b) permissible-purpose certification | Vendor-side. Each CRA contract attests that Frank has permissible purpose to pull the report (tenant screening). We carry the signed certification in our vendor contract file; not a code path | Vendor-side |
| Pre-adverse: legal vs business days | Industry default is 5 business days. Open question §8 for compliance counsel | OPEN |

### 4.2 HUD

Per the existing memory (Castro framework rescinded Nov 2025), Turner Letter
killed PIH 2015-19 + Castro memo + McCain memo. **FHA + 24 CFR §100.500
disparate-impact analysis still apply**, which means HUD individualized
assessment is still required for criminal background screening even though the
mandatory framework is gone. Mandatory denials remain:

- 24 CFR §5.856 lifetime sex-offender registry
- 24 CFR §960.204(a)(3) meth manufacture conviction
- Documented illicit drug use
- 3-year-window drug-related eviction

NV has zero state overlay. The full decision matrix lives at
`docs/screening/hud-criminal-decision-matrix.md` — that document is the
canonical source of truth for what the BackgroundCheckService applies.

The compliance engine (`compliance.ts`) is unchanged: HUD AMI 60% threshold +
IRS Form 8609 certification at lease signing + Tenant Income Certification
annually. Already complete; do not modify.

---

## 5. State Machine + Audit Log

The new `state-machine.ts` module is the only authorized writer of screening
state transitions. The decision: **do not introduce a separate audit-log
system. The compliance tape IS the audit log.**

What the module writes for every transition:

1. **`audit_log` row** via `writeAuditLog({ action: "screening_state_transition", ... })`.
   This is the everyday audit row, queryable from the staff console.
2. **`compliance_tape` entry** with kind `screening.state_transition` and
   citation `15 U.S.C. §1681m + 24 CFR §100.500`. The payload is a JSON-LD
   document carrying `{ applicationId, fromState, toState, trigger, actorId,
   evidence: { ... } }`. This is the immutable hash-chained record.

The tape entry is fire-once-and-forget (the `stampSafe` pattern in
`acquisitions/recert-compliance.ts`): a tape failure must not block a
state transition, but it must log loudly so we know to retry. Both writes
happen inside the same transaction with the `applications` table update so
the rows are atomic with the state change.

`TapeStampKind` in `src/modules/tape/types.ts` must be extended:

```
| "screening.state_transition"
| "screening.run_completed"
```

with corresponding citations:

```
"screening.state_transition": "15 U.S.C. §1681m + 24 CFR §100.500",
"screening.run_completed":    "15 U.S.C. §1681 et seq.",
```

This extension is **not done in this PR** because it touches the tape contract
(`docs/bp-02-contracts.md`) and needs Lane A/B/C signoff. The state-machine
stub in this PR writes only to `audit_log`; the doc lists the tape extension
as the next step (Phase 4 work item 4).

---

## 6. Backtest Harness

**Purpose.** Replay historical or synthetic applicants through the full screening
engine before each vendor swap, rule change, or threshold tune. Validates that
proposed changes do not break existing-tenant outcomes. This is first-class — it
is the safety net that lets us swap Checkr→Certn or change the credit threshold
from 600 to 620 without breaking production approvals.

**Replay corpus.**

- **Phase 4a:** synthetic applicants in `scripts/screening-backtest-corpus/*.json`.
  10 hand-crafted edge cases covering happy path, mandatory denials, manual-review
  triggers, fraud flags, missing AMI data, ID-verification rejection.
- **Phase 5+:** real Frank historical data, exported via the OneSite/Loft CSV
  cutover. Once we have ≥6 months of real screening outcomes, the corpus rotates
  to real (PII-scrubbed) applicants and the synthetic corpus stays for CI
  smoke-tests.

**Mock vendor adapters.** Each external service in `src/modules/screening/`
honors a single env gate: `process.env.MOCK_MODE === "1"`. When set, the
service reads a `screening_tag` field from the applicant and returns a canned
response keyed off the tag. The tag-to-response contract is at
`scripts/MOCK_MODE.md`. The harness is the only caller that sets `MOCK_MODE=1`;
production never does.

Tag → response mapping (illustrative; full list in `scripts/MOCK_MODE.md`):

| Tag | bg/criminal | credit | income | identity | compliance |
|---|---|---|---|---|---|
| `approve_clean` | pass | pass (720) | pass ($54k) | verified | pass |
| `deny_felony` | fail | pass | pass | verified | pass |
| `deny_sex_offender` | fail (lifetime registry) | pass | pass | verified | pass |
| `deny_income_over_ami` | pass | pass | pass ($90k) | verified | fail (over 60% AMI) |
| `review_misdemeanors` | review (3 misd) | pass | pass | verified | pass |
| `review_low_credit` | pass | review (520) | pass | verified | pass |
| `fraud_dup_ssn` | (early exit) | (early exit) | (early exit) | verified | (early exit) |
| `fraud_income_mismatch` | pass | pass | mismatch ($30k vs $90k claim) | verified | pass |
| `no_ami_data` | pass | pass | pass | verified | review (missing AMI) |
| `id_verification_fail` | (skipped) | (skipped) | (skipped) | rejected | (skipped) |

**Outputs.** Per-run, the harness writes to `tmp/screening-backtest/<run-id>/`:

- `summary.md` — markdown with run metadata, aggregate metrics, per-rule firing
  counts, distribution of outcomes.
- `per-applicant.csv` — one row per applicant with: id, tag, expected outcome,
  actual outcome, match, time-to-decision-ms, state-machine path.

**Aggregate metrics in summary.md:**

- Approval rate (`passed` / total)
- Denial rate (`failed` / total)
- Manual-review rate (`manual_review` / total)
- Mean / p50 / p95 time-to-decision (ms)
- FCRA letter send rate (`failed_with_adverse_action_sent` / `failed`)
- Per-rule firing counts (lifetime sex-offender, drug-3yr, dup-SSN, income>60% AMI, etc.)
- Match rate against `expected_outcome` field on each corpus entry. <100%
  match rate is an immediate flag.

**Safety constraints:**

- The harness **MUST NOT** make any external API call. The `MOCK_MODE=1`
  startup gate is checked once at top of file; if any vendor service ever
  receives a real applicant call from the harness, that is a bug.
- The harness **MUST NOT** write to the production `applications` table. It
  uses a pure in-memory orchestrator that imports the vendor service classes
  but never invokes `ScreeningService.runFullScreening` (which writes to
  Postgres).
- The harness **MUST** run without any DB migration applied. Pure local
  replay, no DB dependency.

**Backtest report green = required for any vendor swap.** This is the gate.
No production rule change or vendor SDK swap merges to main without a green
backtest report attached to the PR.

---

## 7. Build Plan + Phase 4 Mapping

Five work items, each ≤1 week, in execution order. Slots into Phase 4 of the
master plan (weeks 6-10 in the wall-clock plan, gated on Frank credentials).

### Step 1 — Wire FraudDetectionService into runFullScreening (2 days)

The service is built but never called. Add it as a step **before** the parallel
checks: duplicate-SSN check early-exits with state `failed` (the only fraud
flag that auto-fails; everything else routes to `manual_review`). Address-
fraud check runs but does not block (it just raises a flag for staff review).

Touches: `src/modules/screening/service.ts` only. Additive.

### Step 2 — Wire WorkNumberService into runFullScreening (2 days)

The PR #201 stub already exists. Wire it as a **parallel** call alongside
background + credit + LIHTC compliance when the applicant has declared a W-2
employer. The result is cross-checked against the Plaid Income result by
`FraudDetectionService.checkIncomeMismatch` — a >15% delta auto-fires a
medium-severity fraud flag.

Touches: `src/modules/screening/service.ts`. Gated on the PR #201 merge.

### Step 3 — Add identity-verification + Plaid income stubs and wire (3 days)

Identity verification runs **before** the parallel checks. Plaid income runs
**inside** the parallel checks alongside the existing background, credit, and
LIHTC compliance services. Both modules ship in this PR (stubs).

Wiring touches: `src/modules/screening/service.ts`. The Plaid stub adds a
fourth check to the `Promise.all` block; the identity check is its own
serial step that fires before the orchestrator enters `state: screening`.

### Step 4 — Formalize state machine (3 days)

- Ship `state-machine.ts` (in this PR).
- Add a `db/migrations/2026-06-XX-application-status-history.sql` migration
  that introduces a `status_history JSONB` column on `applications` (an
  append-only array of `{ state, enteredAt, trigger, actorId }`). The
  state-machine module updates this column atomically with the state change.
- Extend `TapeStampKind` in `src/modules/tape/types.ts` with the two new
  screening kinds (see §5).
- Add the `POST /api/screening/:id/dispute` route (FCRA §1681i — `manual_review`
  + forward dispute to the CRA).
- Add the daily reaper job for the pre-adverse 5-day window (FCRA §1681m).

### Step 5 — Backtest harness skeleton + corpus (4 days)

- Ship `scripts/screening-backtest.ts` (in this PR).
- Ship 10-entry synthetic corpus at `scripts/screening-backtest-corpus/*.json`
  (in this PR).
- Ship `scripts/MOCK_MODE.md` (in this PR).
- Wire `MOCK_MODE=1` early-return into `BackgroundCheckService`,
  `CreditCheckService`, `IdentityVerificationService`, `PlaidIncomeService`.
- Do **NOT** wire mock mode into `ComplianceService` — that engine is
  deterministic against the AMI table and does not need mocking.
- Add `npm run backtest` to package.json (deferred to actual merge).

### Vendor SDK implementations (weeks 6-10)

After RFQs come back and Frank signs vendor contracts:

- Replace the stub in `background-check.ts` with the Checkr SDK call.
- Replace the stub in `credit-check.ts` with the TransUnion ShareAble call.
- Replace the stub in `identity-verification.ts` with the Persona call.
- Replace the stub in `income-verification-plaid.ts` with the Plaid Link +
  Income endpoint.
- Each swap **must** be preceded by a green backtest run on the synthetic
  corpus.

---

## 8. Ratified Decisions

The 7 design-level decisions below were ratified by Alex on 2026-05-27. Each
remains revisitable if conditions change (scale inflection, vendor lock-in,
counsel guidance) — the rationale is captured so future-us understands the
trade-off being held.

### 8.1 Identity vendor — **Persona** (primary), Stripe Identity (fallback)

FCRA + housing adverse-action workflow needs auditable, customizable ID
checks. Stripe Identity is built for fraud signals ("is this the cardholder")
rather than for "we made a housing decision based on this ID." The
~$1–2/check cost delta is trivial against the $35.95 application fee.
Stripe Identity remains the documented fallback so we can swap in a week
if Persona credentialing slips.

**Open follow-up:** confirm Persona's BAA-equivalent housing-PII contract terms
before signing.

### 8.2 Workflow engine — **In-process Postgres state machine**

Frank's scale is ~10 apps/day peak. Temporal / Step Functions are
over-engineered until 10x scale or a 2nd operator with materially different
rules lands. Compliance auditors care about audit-trail completeness (which
`compliance_tape` already provides) rather than orchestration sophistication.

**Revisit trigger:** ≥100 apps/day sustained, OR onboarding a 2nd operator
whose rules diverge from Frank's, OR an auditor explicitly demanding
external orchestration evidence.

### 8.3 Pre-adverse window — **5 business days**

Industry standard; legally defensible; what June (Frank's legal) will likely
recommend. Calendar days saves a day of decision latency but loses the
legal-safe-harbor optic. Confirm with June at onboarding (master plan Phase 0
item 4).

### 8.4 Sex-offender registry source — **Both: vendor primary + direct NSOPW.gov belt-and-suspenders**

HUD §5.856 mandates lifetime denial for registered sex offenders — false
negatives are catastrophic, false positives are fixable via the individualized
assessment matrix at `docs/screening/hud-criminal-decision-matrix.md`. Direct
NSOPW.gov query is free, ~50ms latency. If vendor and direct disagree, hold
for manual review. Belt-and-suspenders cost is trivial against §5.856
exposure.

**Implementation note:** the direct NSOPW.gov adapter is a new stub —
`src/modules/screening/nsopw-direct.ts` — added during Phase 4 step 3 of the
build plan (§7).

### 8.5 Plaid consent UX — **Gated, with Work Number as an explicit W-2 path**

LIHTC tenants are heavily 1099 / gig / multi-job — Work Number alone covers
~40-60% of applicants. Self-reported income is a non-starter for LIHTC
compliance audit. UX: applicant chooses "I have a W-2 job" → Work Number;
anything else → Plaid bank link. Nobody completes the funnel with
self-reported only.

**Conversion-friction acknowledgement:** Plaid linking will cost us some
funnel drop-off. The trade-off is accepted because LIHTC compliance failure
is a tape-stamped event Frank cannot afford.

### 8.6 FCRA §1681i disputes — **CRA hosted portal**

At Frank's scale (~5-10 disputes/year max), hosting our own dispute intake
is overkill. Link applicants to the chosen vendor's portal from the
adverse-action letter; receive resolution via webhook (vendor-dependent).

**Revisit trigger:** onboarding a 2nd operator (volume scales linearly), or
sustained ≥20 disputes/quarter (process becomes a bottleneck).

### 8.7 Real backtest corpus cutover — **Phase 5 + ~2 weeks (target wk 10-14)**

Synthetic corpus is sufficient for Phase 4 implementation — the rules under
test don't change. Real corpus matters when (a) tuning thresholds against
true-positive / true-negative rates, and (b) validating vendor SDK swaps
against historical outcomes. Cutover gated on three preconditions, all of
which align with master plan Phase 5:

1. Frank's PMS CSV export landing (master plan Phase 5, wk 8-12+)
2. PII-scrub pipeline live (hash SSN, fuzz DOB to month/year only, redact
   street addresses, keep zip + city + state)
3. Screening vendor signed (master plan Phase 3, wk 3-6)

**Target corpus:** 200-500 real applicants spanning the last 24 months,
covering at least 3 properties to exercise multi-property AMI lookups.

### Net effect on the master plan

Zero schedule change. All 7 decisions align with the existing Phase 4
(wk 6-10) and Phase 5 (wk 8-12+) sequencing. What they unblock is the
5-step Phase 4 build plan in §7 — the work can start the moment Frank's
PMS logins (master plan Phase 0 → Phase 2) land.
