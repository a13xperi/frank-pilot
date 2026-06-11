# Voice agent greeting — Frank (ElevenLabs first message)

Canonical intro copy for the inbound voice agent. The greeting is configured as
the agent's **first message** in the ElevenLabs dashboard (agent resolved via
`ELEVENLABS_AGENT_ID`; this repo only proxies `get-signed-url` and receives the
post-call webhook — the greeting itself is dashboard config, not code).

> Voice intake is currently dark (`VOICE_INTAKE_ENABLED=false`) and is NOT part
> of the Jun 11 demo. This copy is parked here so the dashboard update and the
> repo stay in sync when it goes live.

## Donna Louise Phase 2 (pilot property)

> "Welcome to Donna Louise Phase 2 Apartments. We are grateful to have you
> start your application process to become a resident. We have one- and
> two-bedroom units. Please follow the instructions. This is Frank Hawkins —
> thank you."

## Per-property template

> "Welcome to {{property_name}}. We are grateful to have you start your
> application process to become a resident. We have {{unit_mix}} units.
> Please follow the instructions. This is Frank Hawkins — thank you."

## Branding rule (applies to ALL tenant conversations, voice and chat)

The assistant is **"Frank"**. Never say **"Frank Pilot" / "Frank-Pilot"** in
any tenant-facing conversation — that name is internal. (The chat path pins
this structurally: "Frank-Pilot" is a forbidden marker in
`housing-qa-tenant-scope.test.ts`; tenant-facing portal copy was de-branded in
the i18n strings on Jun 11.)

## Disclosure consideration (flagged for sign-off)

The greeting closes with "This is Frank Hawkins" spoken by an AI voice. Before
go-live, get Frank Hawkins' explicit sign-off AND consider an AI-disclosure
variant — e.g. "…This is Frank, the digital assistant for Frank Hawkins and
the GPMG team — thank you." An AI agent introducing itself as a real, named
person without disclosure carries impersonation/consumer-protection risk in a
fair-housing context; one clause resolves it without losing the personal touch.
