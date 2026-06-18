# care-line

## Purpose

The **Community Care Line** — Frank's proactive outbound care/wellness agent (and the
inbound anonymous-tips channel) that calls residents, captures structured incidents against a
P0–P3 taxonomy, gives FAQ answers back, and escalates safety/wellbeing. One unified incident
model; anonymity is a row mode, not a separate store. SoT: `docs/intel/care-line-sot.md` ⇄
Notion `e985741bcf39472280bcdea87bcde5fa`. Agent instruction set: `docs/care-line-system-prompt.md`.

## Workflow encoded

Shared ElevenLabs post-call webhook → `dispatch()` routes by `agent_id`: an event from the
care-line agent (`ELEVENLABS_CARE_LINE_AGENT_ID`) → `handleCareLinePostCall()` →
`captureIncident()`. The handler maps the agent's `data_collection_results` → a `care_incidents`
row, classifies severity (server escalates UP only), evaluates escalation (§10), and stamps the
tape. **Sensitive categories route to human triage — never an auto lease-violation or work
order** (fair-housing risk + the FK/actor constraints).

## Data model

`care_incidents` (severity/category/status/routing_intent + §7 fields + reference_code
FRANK-XXXX + anonymity CHECK forbidding identity on anonymous rows + nullable back-ref FKs) ·
`on_call_assignments` (roster) · `care_escalations` (durable "a human was flagged" record) ·
`frank_tips` VIEW over anonymous rows (back-compat with the DRAFT anonymous-tips protocol) ·
`properties.timezone` (added; drives recipient-local hours). Migration:
`src/db/migrations/2026-06-16-care-line-incidents.sql`.

## API surface

| Route | Auth |
|---|---|
| (shared) `POST /api/webhooks/elevenlabs/post-call` | signature-verified; care-line branch flag-gated |

Admin triage routes (`/api/care-line/...`) are a fast-follow.

## Compliance anchors

`CARE_LINE_CALL_CAPTURED` (TCPA 47 CFR §64.1200 / Fair Housing 24 CFR Part 100 / NRS 200.620) ·
`CARE_LINE_ESCALATED` (Anti-retaliation 24 CFR §100.400 / 988). AI disclosure first sentence,
recipient-local hours, permanent opt-out, anonymity, no auto-enforcement on third-party reports.

## Flags & env

`CARE_LINE_ENABLED` (fail-closed: capture no-ops until true) · `ELEVENLABS_CARE_LINE_AGENT_ID`
(routes the webhook) · `CARE_LINE_DRY_RUN` · `CARE_LINE_ONCALL_SMS_ENABLED` (off; paging is a
follow-up — escalations still record + tape-stamp).

## Current state

Built **dark + counsel-gated**. tsc clean; 21 unit tests (taxonomy precedence, escalation
matrix, recipient-local window, capture mapping, anonymity, fail-closed). NOT live: no agent
created, no flags flipped, migration not yet applied to prod. Live grounded `/api/care-line-qa`
endpoint + admin triage routes + on-call SMS paging are fast-follows. **No live call until
counsel signs off** (the SoT is an AI-gen v0 spec). Closes JPM Corrective-Action Item #6.

## Key files

`src/modules/care-line/` — `service.ts` (capture + post-call handler + isCareLineEvent),
`taxonomy.ts`, `escalation.ts`, `dialer.ts` (recipient-local window), `index.ts`.
Tests: `src/__tests__/care-line-logic.test.ts`, `care-line-capture.test.ts`.
