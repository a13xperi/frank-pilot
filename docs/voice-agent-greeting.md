# Voice agent greeting — Frank (ElevenLabs first message)

Canonical intro copy for the inbound voice agent. The greeting is configured as
the agent's **first message** in the ElevenLabs dashboard (agent resolved via
`ELEVENLABS_AGENT_ID`; this repo only proxies `get-signed-url` and receives the
post-call webhook — the greeting itself is dashboard config, not code).

> Voice intake is currently dark (`VOICE_INTAKE_ENABLED=false`) and is NOT part
> of the Jun 11 demo. This copy is parked here so the dashboard update and the
> repo stay in sync when it goes live.

## Donna Louise Phase 2 (pilot property) — inbound

> "Hi, this is Frank — the digital assistant Frank Hawkins built for the
> Donna Louise Phase 2 community. He wanted the good people living here to be
> able to get answers with the latest technology, any time. That's why you're
> talking to me today. We're grateful you're starting your application to
> become a resident. We have one- and two-bedroom units. Please follow the
> instructions, and ask me anything along the way."

## Per-property template — inbound

> "Hi, this is Frank — the digital assistant Frank Hawkins built for the
> {{property_name}} community. He wanted the good people living here to be able
> to get answers with the latest technology, any time. That's why you're
> talking to me today. We're grateful you're starting your application to
> become a resident. We have {{unit_mix}} units. Please follow the
> instructions, and ask me anything along the way."

## Per-property template — outbound (waitlist-validation calls)

Used by the outbound agent (`ELEVENLABS_OUTBOUND_AGENT_ID`, `dialer.ts`); the
property name comes in as a per-call dynamic variable.

> "Hi, this is Frank — the digital assistant Frank Hawkins built for the
> {{property_name}} community, so the good people on our list can hear from us
> with the latest technology. I'm calling about your housing application with
> {{property_name}}. Is now an okay time for a couple of quick questions?"

## Branding rule (applies to ALL tenant conversations, voice and chat)

The assistant is **"Frank"**. Never say **"Frank Pilot" / "Frank-Pilot"** in
any tenant-facing conversation — that name is internal. (The chat path pins
this structurally: "Frank-Pilot" is a forbidden marker in
`housing-qa-tenant-scope.test.ts`; tenant-facing portal copy was de-branded in
the i18n strings on Jun 11.)

## Disclosure note

The greeting above uses the **founder's-note form** (Alex Jun 16): the AI tells
the caller that Frank Hawkins built this assistant so his communities can get
answers with the latest technology, "that's why you're talking to me." It keeps
the personal warmth **while still disclosing** the caller is talking to the AI
assistant Frank built — it does NOT claim to BE Frank Hawkins.

This replaces an earlier draft that closed with "This is Frank Hawkins" spoken
by the AI voice; an agent introducing itself as a real, named person without
disclosure carries impersonation/consumer-protection risk in a fair-housing
context. Keep the mid-call identity honest (see voice-agent-system-prompt.md,
WHO YOU ARE). **Still get Frank Hawkins' written sign-off on the use of his
name/story before flipping the live agents.**
