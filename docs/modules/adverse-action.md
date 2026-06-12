# adverse-action

## Purpose

FCRA §1681m adverse-action notices: whenever a denial rests on consumer-report
information, the applicant gets a compliant notice — specific reason, CRA contact
info, dispute rights. Notices are immutable append-only rows; resends create new rows.

## Workflow encoded

1. **Automatic dispatch** (non-blocking background task) on `screening_failed`
   (report-derived) or any `tierN_denied`: generate notice text → send SMS →
   append `adverse_action_notices` row.
2. **Pre-adverse hold** (`FCRA_PRE_ADVERSE_ENABLED`): report-derived denial parks in
   `pending_adverse_action` with `adverse_action_eligible_at = now + window`; an
   intent-to-deny notice goes out (`stage='pre_adverse'`); the daily 06:00 finalizer
   advances to `screening_failed` + final notice (`stage='adverse'`) after the window.
   Legal framing: §1681b(b)(3) pre-adverse is employment-only — this hold is a
   best-practice/state-law-ready option, default OFF.
3. **Manual resend** — creates a new notice row, never overwrites.

## Data model

`adverse_action_notices`: `application_id` (NOT unique — multiple notices allowed),
`reason`, `reason_detail`, full `notice_text`, `sent_via` (`sms`), `sms_delivered`,
`stage` (`pre_adverse`/`adverse`), `sent_by`, `created_at`.
`applications.adverse_action_eligible_at`.

## API surface

| Route | Permission |
|---|---|
| `GET /api/applications/:applicationId/adverse-action` | `screening:view` |
| `POST /api/applications/:applicationId/adverse-action/resend` | `approval:tier1` |

## Compliance anchors

FCRA §1681m content requirements baked into the notice text; audit action
`adverse_action_notice_sent`; delivery failures never block the application.

## Flags & env

`FCRA_PRE_ADVERSE_ENABLED` · `FCRA_PRE_ADVERSE_WINDOW_DAYS` (default 5).

## Current state

**Live** for automatic dispatch + resend; pre-adverse hold **flag-dark**. Gaps:
SMS-only delivery (email/certified mail stubbed); applicant-facing dispute UI
schema-ready but unbuilt.

## Key files

`src/modules/adverse-action/{routes,service}.ts`.
