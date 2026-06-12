# voice-intake

## Purpose

Inbound Frank: ElevenLabs Conversational AI phone/browser intake. Captures applicant
conversations, persists post-call results, and gives the PM console a triage queue
where humans promote an intake into a real application — the voice channel feeding the
same paper trail as the web funnel.

## Workflow encoded

1. **Call** — inbound PSTN or in-browser WebRTC ("Talk to Frank" pill; signed-URL
   minting with per-IP/cookie rate limits + a pre-charged daily cost budget).
2. **Post-call webhook** — HMAC-SHA256 signature over `<timestamp>.<body>` (30-min
   tolerance), idempotent (`elevenlabs_processed_events` + UNIQUE `conversation_id`),
   always answers 200 (errors → `elevenlabs_webhook_dlq`; 5xx-ing would get the
   webhook auto-disabled by ElevenLabs after 10 failures). Routes by `agent_id`:
   outbound-agent calls hand off to [outbound-validation](outbound-validation.md).
3. **Persist** — UPSERT on `conversation_id` (transcription + audio events converge
   to one row); consent flag parsed from `data_collection_results.consent_recording`
   (defaults TRUE — implied-consent path; Phase 4 tightens).
4. **Triage** — leasing agents see pending calls; senior+ **approve** →
   `promoteIntakeToApplication()` (applications row `source='voice'`, SMS magic-link
   for doc upload, `VOICE_INTAKE_DECISION` stamp) or **reject** (soft: tape stamp +
   drop from queue).

## Data model

`voice_intake_calls` (UNIQUE `conversation_id`, `data_collection_results` JSONB with
name/phone/city/household/income, `consent_recording`, `callback_requested`,
`applicant_id` back-ref set on approve, `raw_payload` for forensic replay) ·
`elevenlabs_processed_events` · `elevenlabs_webhook_dlq` ·
`voice_intake_costs` (daily cost rollup).

## API surface

| Route | Permission |
|---|---|
| `GET /api/pm/voice-intakes` (+ `/:id`) | `voice_intake:view` (leasing+ triage) |
| `POST /api/pm/voice-intakes/:id/approve` | `voice_intake:approve` (senior+) |
| `POST /api/pm/voice-intakes/:id/reject` | `voice_intake:approve` |
| `POST /api/pm/voice-intakes/:id/callback` | `voice_intake:view` |
| `POST /api/webhooks/elevenlabs/post-call` | signature-verified, raw-body mount |
| `POST /api/webhooks/elevenlabs/tools/:name` | in-call server tools (flag-gated 503) |
| `POST /api/voice/sessions` | browser session minter (rate + budget gated) |

## Compliance anchors

`VOICE_INTAKE_COMPLETED` (HUD 4350.3 Ch. 4-6 / **NRS 200.620 two-party consent**) ·
`VOICE_INTAKE_DECISION` · `VOICE_TOOL_INVOKED` (every mid-call tool fire) ·
`VOICE_BROWSER_SESSION_STARTED/DENIED`. PII discipline: browser-session IPs are
HMAC-hashed before storage.

## Flags & env

`VOICE_INTAKE_ENABLED` (webhook + console) · `VOICE_TOOLS_ENABLED` (in-call tools) ·
`VOICE_BROWSER_SESSIONS_ENABLED` (+ `_DAILY_CAP_USD`, `_MAX_DURATION_SECS`,
`_COST_PER_MIN_USD`, `_IP_HASH_SECRET`) · `ELEVENLABS_WEBHOOK_SECRET` (sentinel
`wsec_changeme` refused) · `ELEVENLABS_API_KEY` · `TENANT_PORTAL_URL`.

## Current state

**Live and hardened** (signature verification, idempotency, DLQ, cost caps).
This is the agent the 725 number should point at for Monday's signage fallback.

## Key files

`src/modules/voice-intake/` — `webhook.ts`, `service.ts`, `routes.ts`,
`applicant-routes.ts`, `browser-session.ts`, `tool-callbacks.ts`, `send-app-link.ts`,
`signature.ts`.
