# Frank voice agent — system design (inbound · outbound · FAQ, one agent)

Captured Jun 11 (pre-demo, 1am vision — Alex). Goal: inbound calls, outbound
waitlist calls, and the FAQ corpus blend into ONE easy system. One agent, one
knowledge source, per-call context.

## The three doors, one agent

| Mode | Trigger | Opening | Status |
|---|---|---|---|
| **Inbound** | Tenant dials +1 (725) 267-2488 | Property greeting (see voice-agent-greeting.md) | LIVE (greeting verified Jun 11); intake tools (`tool-callbacks.ts`, `send-app-link.ts`) already in repo |
| **Outbound** | Waitlist event (vacancy / Day-7 / Day-12 cadence from the Donna Louise roadmap) | "Hi {{first_name}}, this is Frank, the digital assistant for the GPMG team — you're #{{position}} on the {{property}} list and a unit just opened. I'd love to help you get your application started." | NOT BUILT — ElevenLabs outbound API + dynamic variables; platform waitlist engine fires it like email/SMS today |
| **FAQ** | Any question, either direction | Answers from the 500-question tenant FAQ corpus | Interim: corpus copy uploaded to ElevenLabs Knowledge Base. Production: agent calls `/api/housing-qa` as a TOOL → one grounded source shared with chat, platform facts ($35.95 fee, 120-day rule) always win |

## Blend architecture

- **One agent** (`frank-onboarder`) — different entry context, same brain.
- **Per-call context** via ElevenLabs dynamic variables: inbound gets the
  property greeting; outbound gets {first_name, position, property, unit_type}
  from the waitlist event payload.
- **Shared tools**: `ask_housing_faq` (→ `/api/housing-qa`, replaces the KB
  copy), `send_app_link` (SMS magic link — exists), intake capture
  (`tool-callbacks.ts` — exists), post-call webhook → `voice_calls` table
  (exists).
- Voice becomes the third channel in the EXISTING waitlist cadence
  (email + SMS + voice), not a new system.

## Gates before outbound goes live (in order)

1. **Twilio upgrade** (~$20) — trial blocks calls to unverified numbers
   (mandatory for outbound) and plays the trial preamble on inbound.
2. **TCPA / AI-voice consent** — FCC: AI-voice calls require PRIOR EXPRESS
   CONSENT. Add an automated/AI-call consent checkbox to waitlist intake,
   stamp it on the compliance tape, respect call-time windows. Patricia's 30
   paper-list names need consent captured before Frank dials any of them.
3. **Voice re-grounding** (`VOICE_AGENT_TENANT_SCOPED`) — same scope-leak
   class that cut the chat widget for Jun 11; number stays private until done.
4. **Frank Hawkins sign-off** on his name in the greeting (flagged in
   voice-agent-greeting.md).

## Quality tier (dashboard-only, no code — do first)

1. **Frank's cloned voice on `frank-onboarder`** (clone exists — see
   `aime-caddie (Frank voice)`; clone use approved per the May Notion decision).
   The "digital assistant for Frank Hawkins" disclosure makes this honest.
2. **Real system prompt**: port the chat guardrails — no personal qualification
   rulings ("the application verifies this"), no steering, fair-housing
   neutral, platform facts win, PM-callback escalation path.
3. **ElevenLabs Tests suite**: fee → $35.95; food stamps → excluded;
   "do I qualify?" → refuses to rule; fair-housing bait → neutral. Run on
   every prompt edit.
4. **Spanish** — EN+ES is a day-one platform requirement (roadmap); enable
   multilingual + Spanish greeting variant.
5. **Post-call webhook to prod** (`VOICE_INTAKE_ENABLED` + webhook secret) —
   transcripts/consent/callbacks land in `voice_calls` + PM console + tape.

## Build order (post-demo)

1. Twilio upgrade + verify FAQ answers on inbound (KB interim).
2. `ask_housing_faq` tool → retire the KB copy (one source of truth).
3. Re-grounding + attestation → publish number; after-hours forwarding from
   (702) 920-6548.
4. Consent checkbox in waitlist intake + tape stamp.
5. Outbound: waitlist-event → ElevenLabs outbound call with dynamic variables;
   start with ONE consenting test prospect, then Patricia's cohort.
