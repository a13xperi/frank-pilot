# application

## Purpose

The core application lifecycle — the state machine every applicant rides from draft to
onboarded tenant. Owns all applicant PII (SSN/DOB encrypted at rest), the screening
result columns, the tiered-approval columns, and the append-only `status_history`
trail that drives compliance auditing.

## Workflow encoded

Full state machine (`application_status`; transitions enforced by the chokepoint
`transitionApplicationStatus()` in `src/modules/screening/state-machine.ts`):

```
draft → submitted
submitted → awaiting_identity         (IDENTITY_VERIFICATION_ENABLED)
submitted → awaiting_consumer_report  (CONSUMER_REPORT_ENABLED)
submitted → screening                 (auto if SCREENING_ON_SUBMIT_ENABLED, else manual /screen)
awaiting_* → screening | screening_review   (vendor webhooks land verdicts)
screening → screening_passed | screening_failed | screening_review
screening_review → screening_passed | screening_failed   (staff manual override)
screening_failed → pending_adverse_action (FCRA_PRE_ADVERSE_ENABLED) → screening_failed
screening_passed → tier1_review → tier1_approved | tier1_denied
tier1_approved → tier2_review (high rent / exceptions) → tier2_approved | tier2_denied
tier2_approved → tier3_review (exceptions) → tier3_approved | tier3_denied
tier*_approved → lease_generated (requires income_verified, LIHTC §42)
lease_generated → lease_signed → onboarded
any non-terminal → cancelled (senior+)
```

Every transition appends `{from, to, trigger, actorId, actorRole, at, evidence}` to
`status_history` (JSONB, append-only).

## Data model

`applications` is the widest table in the system. Load-bearing groups:
- **PII**: `ssn_encrypted`/`ssn_hash` (hash UNIQUE — duplicate-SSN fraud check),
  `date_of_birth_encrypted`, contact/address/employer/landlord/emergency fields.
- **Status**: `status` (the chokepoint column, indexed), `status_history` JSONB.
- **Screening**: identity (`identity_session_id/status/result/details/completed_at`),
  CRA (`background_report_id`, `credit_report_id`, `consumer_report_*_status`,
  `screening_authorization_at`), per-check result/details/completed_at columns
  (background, credit, compliance, income, work_number, nsopw),
  `overall_screening_result`, `adverse_action_eligible_at`.
- **Approval**: `tierN_reviewer_id/decision/notes/decided_at`, `tier2_required`,
  `tier3_required` — reviewer ids must be pairwise distinct (separation of duties).
- **Lease/onboarding**: `income_verified(_by/_at)`, lease dates,
  `onesite_lease_id`, `loft_tenant_id`, Stripe customer/method, `auto_pay_enrolled`.
- **Funnel**: intent quiz (`intent_*`), W0 AMI pre-qualifier (`qualifying_ami_*`),
  `claimed_unit_id` + `claim_expires_at` (48h soft hold), `source`
  (`web`/`voice`/`sms`/`operator`), `voice_call_id`, `consent_outbound_ai_calls`
  (TCPA PEWC).

## API surface

| Route | Permission |
|---|---|
| `POST /api/applications` | `application:create` |
| `GET /api/applications` (+ `/:id`) | `application:read` |
| `PATCH /api/applications/:id` | `application:create` (draft only) |
| `POST /api/applications/:id/submit` | `application:submit` |
| `PATCH /api/applications/:id/verify-income` | `screening:initiate` (LIHTC §42 gate) |
| `PATCH /api/applications/:id/cancel` | `screening:initiate` |

Self-serve entry lives in [applicants](applicants.md).

## Compliance anchors

Stamps: `application_created`, `application_submitted`, `screening_initiated`,
`screening_state_transition` (every status change), `consumer_report_authorized`
(FCRA §1681b(b)(2) with disclosure hash + IP + UA). FCRA §1681m notices on every
denial. ESIGN/UETA consent at signature. HUD/Castro §III.B: discretionary criminal
records force a `screening_review` hold — no blanket bans.

## Flags & env

`IDENTITY_VERIFICATION_ENABLED` · `CONSUMER_REPORT_ENABLED` ·
`SCREENING_ON_SUBMIT_ENABLED` · `SCREENING_EXTENDED_CHECKS_ENABLED` ·
`FCRA_PRE_ADVERSE_ENABLED` (+ `FCRA_PRE_ADVERSE_WINDOW_DAYS`, default 5) ·
`COMPLIANCE_TAPE_V2_ENABLED` (dual-write transitions to the hash-chained tape).

## Current state

Core path **live** (draft→submit→screening→tiers→lease→onboarded). Flag-dark:
extended checks, pre-adverse hold, tape v2. Gaps: fraud-flag resolution enforced
before tier-1 pass but not before submit; tier-2/3 escalation criteria
(`TIER2_RENT_THRESHOLD`, "exceptions") are code constants, not configurable.

## Key files

`src/modules/application/{routes,service,validation}.ts`,
`src/modules/screening/state-machine.ts` (the transition chokepoint).
