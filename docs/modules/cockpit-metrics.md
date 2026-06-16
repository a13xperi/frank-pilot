# cockpit-metrics

## Purpose

NO-PII inbound voice metrics for the **token-watch Frank cockpit** (the live ops tab).
The cockpit's Sage REST project can read the outbound waitlist funnel directly
(`gpm_funnel_counts()` RPC), but the **inbound** figures live on frank-pilot's own DB —
this module exposes them as aggregate counts the dashboard can poll without a user session.

## Workflow encoded

1. The cockpit polls `GET /api/cockpit/inbound-metrics` with the shared cockpit token.
2. The service runs a single aggregate query over `voice_intake_calls` and returns counts.
3. Nothing else — no rows, no applicant data, ever.

## Data model

Read-only. Source: `voice_intake_calls` (see [voice-intake](voice-intake.md)). Lifecycle
mapping: `promoted` = `applicant_id IS NOT NULL`; `awaiting_review` = `applicant_id IS NULL
AND callback_requested = false`; `callbacks_requested` = `callback_requested = true`;
`completed` = `call_successful = 'success'`. No tables created.

## API surface

| Route | Auth |
|---|---|
| `GET /api/cockpit/inbound-metrics` | shared secret — `Authorization: Bearer <COCKPIT_METRICS_TOKEN>` or `x-cockpit-token` |

Response (all integers except `answer_rate` 0..1):
`generated_at, total_calls, last_24h, last_7d, promoted, callbacks_requested,
awaiting_review, completed, no_consent, answer_rate`.

## Compliance anchors

PII discipline: the endpoint returns **counts only** — never names, phones, transcripts,
emails, or addresses. A test asserts the payload contains no PII field names.

## Flags & env

`COCKPIT_METRICS_TOKEN` — the shared secret. **Fail-closed:** while unset the route returns
`503`; once set it requires a matching token (`401` otherwise). Set it in prod and hand the
same value to the token-watch cockpit's fetch.

## Current state

Built + unit-tested. Ships dark until `COCKPIT_METRICS_TOKEN` is set in prod (GL-C4).
Cockpit wiring (token-watch FrankView fetch) is the follow-up.

## Key files

`src/modules/cockpit-metrics/` — `service.ts`, `routes.ts`, `index.ts`.
Tests: `src/__tests__/cockpit-metrics.test.ts`.
