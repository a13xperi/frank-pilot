# screening

## Purpose

The screening engine: identity, fraud, background, credit, and tax-credit compliance —
automated where vendors are wired, fail-closed into a human review queue everywhere
else. Orchestrates async vendor webhooks (Stripe Identity, Checkr, TransUnion
ShareAble) and owns the application state transitions they trigger.

## Workflow encoded

`runFullScreening()` pipeline:
1. Transition `submitted → screening`; decrypt PII.
2. **Identity** (Stripe Identity webhook-resolved, or legacy sync) — rejected →
   short-circuit `screening_failed` + FCRA notice.
3. **Fraud screening** — duplicate SSN (hash match) → fail; address fraud → flag.
4. **Background + credit + compliance** in parallel (Checkr / TransUnion ShareAble
   webhook-resolved when `CONSUMER_REPORT_ENABLED`, else sync vendor seam; LIHTC §42
   income limits per property election).
5. **Extended checks** (flag-dark Phase 4a): Plaid income, Work Number, NSOPW.
6. **Aggregate** — precedence: `fail` > `review_required` > `could_not_screen` > `pass`:
   - any fail → `screening_failed` (+ FCRA notice, or pre-adverse hold)
   - review/could-not-screen → **`screening_review` HOLD** — a person decides
   - all pass → `screening_passed`

**The hold queue is the human-on-the-loop heart**: vendor outages, missing keys,
HUD individualized assessments — everything unresolvable parks here and never
silently passes (see `stub-policy.ts`: keyless production throws `STUB_GATE_ERROR`
unless `MOCK_MODE`/`ALLOW_STUB_SCREENING` explicitly opened).

## Data model

Screening columns on `applications` (see [application](application.md));
`consumer_report_authorizations` (FCRA §1681b(b)(2) durable record: disclosure
version + SHA-256 hash + full text + IP + UA + timestamp; UNIQUE per application);
`cra_processed_events` (webhook idempotency); `cra_webhook_dlq`; `fraud_flags`
(type: `duplicate_ssn`/`address_fraud`/`income_mismatch`/`unusual_approval_speed`/
`manual_override`; resolution tracked).

## API surface

| Route | Permission |
|---|---|
| `GET /api/screening/review-queue` | `screening:view` |
| `POST /api/screening/:applicationId/screen` | `screening:initiate` (manual trigger) |
| `POST /api/screening/:applicationId/manual-override` | `screening:initiate` — pass/fail + notes, clears holds |
| `GET /api/screening/:applicationId/results` | `screening:view` |
| `POST /api/webhooks/cra` | Checkr + TransUnion receivers — HMAC-verified, raw-body mount, idempotent, DLQ on error |
| Stripe Identity events | arrive via the payments webhook (`identity.verification_session.*`) |

## Compliance anchors

FCRA §1681b(b)(2) authorization **before any pull** (refuses on stale disclosure
version) · §1681m adverse action on report-derived denials · HUD/Castro §III.B
individualized assessment hold · LIHTC §42 income limits ·
stamps: `screening_initiated`, per-check `*_completed`, `screening_state_transition`.

## Flags & env

`IDENTITY_VERIFICATION_ENABLED` · `CONSUMER_REPORT_ENABLED` (+ `CHECKR_API_KEY`,
`CHECKR_WEBHOOK_SECRET`, `TRANSUNION_SHAREABLE_API_KEY` + webhook secret) ·
`SCREENING_ON_SUBMIT_ENABLED` · `SCREENING_EXTENDED_CHECKS_ENABLED` (+ `PLAID_*`,
`WORK_NUMBER_*`, `NSOPW_*`) · `FCRA_PRE_ADVERSE_ENABLED` · `SCREENING_API_URL/KEY`
(legacy sync seam) · `MOCK_MODE` / `ALLOW_STUB_SCREENING` (test/demo stub gates).

## Current state

Code **100% built**; CRA + identity paths **flag-dark pending vendor contracts/keys**
(Checkr + TransUnion credentialing in progress — see `docs/runbooks/checkr-cra-arming.md`).
Manual review path **live** and is the cohort-one operating mode. Extended checks
dormant. Gaps: Work Number / NSOPW / Plaid are wired-but-keyless stubs.

## Key files

`src/modules/screening/` — `service.ts` (orchestration), `state-machine.ts`,
`identity-verification.ts`, `background-check.ts`, `credit-check.ts`,
`compliance.ts`, `fraud-detection.ts`, `consumer-report-consent.ts`,
`cra-webhook.ts`, `stub-policy.ts`, `routes.ts`.
