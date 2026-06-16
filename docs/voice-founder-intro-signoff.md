# Frank — voice intro sign-off (for Frank Hawkins)

**Status: DRAFT — staged, not sent. Voice agent stays dark until Frank signs off.**

We want callers to hear, right up front, *why* the Frank assistant exists — in
your words: you helped build an AI agent so the good people in your communities
can get answers with the latest technology. Before we turn that on, we need your
written OK on using your name and this story, because the assistant speaks it.

## What a caller will hear

**When they call in (inbound):**
> "Hi, this is Frank — the digital assistant Frank Hawkins built for the Donna
> Louise Phase 2 community. He wanted the good people living here to be able to
> get answers with the latest technology, any time. That's why you're talking to
> me today. We're grateful you're starting your application to become a resident.
> We have one- and two-bedroom units. Please follow the instructions, and ask me
> anything along the way."

**When the assistant calls a waitlist applicant (outbound):**
> "Hi, this is Frank — the digital assistant Frank Hawkins built for the {property}
> community, so the good people on our list can hear from us with the latest
> technology. I'm calling about your housing application. Is now an okay time for
> a couple of quick questions?"

**If a caller asks "are you the real Frank?":**
> It answers plainly that it's the AI assistant you *built* to help — it never
> pretends to *be* you.

## Why it's worded this way (the honesty line)

It says you **built** the assistant — it does not claim to *be* you. That one
distinction keeps us on the right side of the rules: an AI voice introducing
itself as a real, named person *without* disclosing it's an AI carries
impersonation / consumer-protection risk in a fair-housing context. The
founder's-note wording keeps all the warmth and the personal story while staying
honest about what the caller is talking to. (An earlier draft that closed with a
flat "This is Frank Hawkins" spoken by the AI was dropped for exactly this
reason.)

## What we need from you

1. **OK to use your name + this story** in the spoken intro, voice and chat? (yes / changes)
2. **Your voice:** are you OK recording a short voice sample so the assistant can
   speak in a clone of *your* voice? (optional, but it's what makes the "Frank
   built this for you" framing land — and it's yours, used only for this.)
3. **Any wording you'd change** in the lines above?

Reply with a yes (or your edits) and we flip it on. Until then it stays off.

## Ready-to-send cover message (STAGED — do not send without Alex's go-ahead)

Two clips of exactly what callers will hear are generated and ready to attach:
`battlestation/out/briefings/2026-06-16-frank-intro-inbound.mp3` and
`…-outbound.mp3` (frank-onboarder voice — swap for Frank's own clone once he
records one).

**Text / SMS:**
> Frank — we built the AI assistant that helps your Donna Louise residents get
> answers any time, by phone and text. Before it goes live I want your OK on how
> it introduces you. Here's exactly what a caller hears (clip attached). It says
> you *built* it — never pretends to be you. Good to go, or want changes? — Alex

**Email:**
> **Subject:** Quick OK needed — how the Frank assistant introduces you
>
> Frank,
>
> The AI assistant is ready to start helping your residents by phone and text.
> Before we turn it on, I'd like your sign-off on the intro, since it uses your
> name and your story.
>
> Attached are two short clips — what a caller hears when they call in, and when
> the assistant calls an applicant back. It tells people you *built* this so your
> communities can get answers with the latest technology, and it's always clear
> it's the AI assistant you built — never pretending to be you.
>
> Three quick things:
> 1. OK to use your name + this story?
> 2. Open to recording a short voice sample so it can speak in your voice?
> 3. Anything you'd change in the wording?
>
> Reply yes (or your edits) and we'll flip it on.
>
> — Alex

## For the operator (internal)

- Live copy + the exact go-live `PATCH` command: `docs/voice-agent-greeting.md`
  ("Pushing to the live agents (GATED)").
- Persona/identity rules the assistant follows mid-call:
  `docs/voice-agent-system-prompt.md` (WHO YOU ARE).
- Text + web chat already carry the same intro/disclosure (shipped):
  `battlestation/scripts/frank-care-chat.py`, `battlestation/web/frank-care-chat.html`.
- Gate also tracked by the voice go-live runbook; do not flip `VOICE_INTAKE_ENABLED`
  or patch the ElevenLabs agents before this sign-off.
