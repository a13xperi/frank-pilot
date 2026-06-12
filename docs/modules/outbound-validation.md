# outbound-validation

## Purpose

Outbound Frank (DM-FRANK-029): the wait-list validation dialer. Calls Donna Louise
wait-list applicants ("still interested / still available?") via ElevenLabs native
Twilio outbound, claiming applicants atomically from the **Sage source of truth**
(`gpm_waitlist_applicants` — service-role only; full PII stays on Sage) and recording
outcomes back. Local table is a PII-minimal conversation map (UUID + last-4 only).

## Workflow encoded

1. **Claim** — `gpm_claim_next_call` RPC on Sage atomically claims the next eligible
   applicant (consent-gated server-side, fail-closed; re-contact pacing via
   `next_attempt_after`).
2. **Dial** — `runDialerTick()` (cron every 5 min, 9am–8pm Pacific, or manual
   `/dial`): builds dynamic variables, fires ElevenLabs
   `POST /v1/convai/twilio/outbound-call`, inserts `outbound_validation_calls`
   (`dialed`). Gates per tick: call window, **in-flight concurrency 1**, daily batch
   cap, pacing. `DRY_RUN` short-circuits before any PSTN traffic.
3. **Outcome** — the shared post-call webhook routes by agent id to
   `handleOutboundPostCall()`: maps `data_collection_results` →
   confirmed / declined / bad_number / voicemail / callback_requested / no_answer;
   `gpm_record_call_outcome` updates Sage (`still_interested`, `call_attempts`,
   `next_attempt_after`).
4. **Sweep** — `sweepStuckCalls()` every 15 min expires dials with no webhook after
   30 min. **Report** — daily 20:05 PT push to Notion + on-demand md/csv/json.

Dynamic variables passed to the agent (prompt placeholders must match exactly):
`applicant_id`, `applicant_name`, `property_names`, `apt_types`, `date_needed`,
`shared_with`. Data-collection fields the agent must define: `still_interested`,
`call_summary`, `apt_type_confirmed`, `date_needed_confirmed`, `new_phone_number`.

## Data model

Local `outbound_validation_calls`: `applicant_id` (Sage UUID), `conversation_id`
UNIQUE, `call_sid`, `to_number_last4` (**never the full number**), `test_call`,
`status` (`dry_run`/`dialed`/`completed`/`expired`/`dial_failed`), `outcome`,
`dynamic_variables` JSONB, `error`, timestamps. Sage side:
`gpm_waitlist_applicants` (queue, consent, windows) + claim/outcome RPCs.

## API surface

| Route | Permission |
|---|---|
| `POST /api/admin/outbound-validation/dial` | `outbound_validation:run` (**system_admin only**) |
| `POST /api/admin/outbound-validation/sweep` | `outbound_validation:run` |
| `GET /api/admin/outbound-validation/status` | `outbound_validation:view` (senior+) |
| `GET /api/admin/outbound-validation/report?format=md|csv|json` | `outbound_validation:view` |

All 503 while `FRANK_OUTBOUND_ENABLED` is off (fail-closed).

## Compliance anchors

TCPA 47 CFR §64.1200: PEWC consent gate (Sage-side, fail-closed) + 9am–8pm
recipient-local window (DST-safe via `Intl.DateTimeFormat`). Every attempt — dry runs
and failures included — stamps the tape with consent evidence
(`VOICE_INTAKE_OUTBOUND_ATTEMPTED` / `OUTBOUND_VALIDATION_CALL_COMPLETED`).

## Flags & env

`FRANK_OUTBOUND_ENABLED` · `FRANK_OUTBOUND_DRY_RUN` · `FRANK_OUTBOUND_TEST_NUMBER` ·
`FRANK_OUTBOUND_BATCH_LIMIT` (default 5) · `FRANK_OUTBOUND_PACE_MINUTES` (default 5) ·
`ELEVENLABS_API_KEY` / `ELEVENLABS_OUTBOUND_AGENT_ID` /
`ELEVENLABS_AGENT_PHONE_NUMBER_ID` · `NOTION_TOKEN` + report page id (daily push).

## Current state

**Merged (PR #292) and green; flag-dark pending config.** History note: two parallel
builds were reconciled Jun 11 — the retired CSV-import/review-queue variant (38272ce)
lives in git history; its TCPA tape anchor + consent gate were grafted here.
Go-live ladder: dry-run → test-number → capped live batches
(see the Go-Live Runbook in Notion).

## Key files

`src/modules/outbound-validation/` — `dialer.ts`, `outcome.ts`, `sage-client.ts`,
`report.ts`, `routes.ts`. Migration: `2026-06-11-outbound-validation-calls.sql`.
