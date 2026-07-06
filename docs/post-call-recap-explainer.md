# Post-call recap explainer — design spec (#8)

**Goal (Alex, 2026-06-25):** after *every* Frank phone call, Frank pushes the caller a short recap explainer — "here's what we accomplished, here's your next step" — so they always know where things stand. **Especially for struggle-busters** (callers who got stuck / escalated / needed a person), so they're reassured, not left wondering.

This is the *back-end bookend* of the onboarding asset: onboarding video is sent when they call; the recap is sent when the call ends. Same reusable generator (`frank-explainer`), same delivery (`/onboard`-style short link + texted via the existing SMS path).

## What it produces
A 4–6 scene, ~30–45s captioned Frank-voice video, terminal-native (reuse `out/frank-trainual/gen-frames.py` template — add a `recap` scene set), personalized from the call:
1. "Here's what we got done today, <name>."
2. Checklist of accomplishments (✓ pre-qualified at X% AMI · ✓ claimed unit Y · ✓ fee link sent / paid · ✓ ID started).
3. **Your next step** (the single thing they need to do next — from the requirements checklist / checkpoint).
4. Where you are: the 5-gate pipeline with the current gate lit.
5. Reassurance (esp. struggle-busters): "you're not on your own — tap my name or call me back anytime." → "Frank out."

## Content source (already exists — reuse)
- `src/modules/follow-ups/service.ts` `buildContextPacket(phoneE164)` → rapport + latest application + screening verdicts + `resume_checkpoint` + open follow-ups. This is the recap's data.
- The requirements checklist ([[frank-requirements-checklist]] — `mark_requirement` / what's-still-missing) → the "next step".
- `follow_ups` row (incl. the `voice_intake_escalation` source from #372) → the struggle-buster flag.

## Where it hooks (the one real decision)
Two candidate triggers — recommend **A**:
- **A) ElevenLabs post-call webhook** (the call-ended event) → enqueue a recap job. Confirm frank-pilot's post-call webhook handler exists (check `voice-intake/*webhook*` / the call-time wrap `follow-ups/call-time.ts`, which already runs at call end to build the checkpoint). Hook the enqueue there.
- B) A cron sweep over recently-ended calls without a recap. (Fallback if no clean post-call webhook.)

## Async generation (do NOT block the webhook)
Per-call `frank-explainer` render takes ~1–2 min — too slow to run inline in a webhook. So:
1. Post-call hook writes a `recap_jobs` row (call_id, phone, status=pending) — or reuse a `follow_ups`/queue row.
2. A worker (cron tick, mirror the dialer cadence in `scheduler.ts`, gated behind a new `FRANK_RECAP_ENABLED` flag) claims pending jobs, builds the recap spec from `buildContextPacket`, runs `frank-explainer` (or a lighter card-only render for speed), uploads to the `frank-media` bucket (path `recaps/<callId>.mp4`), and texts the caller a short link via the existing `sendMagicLinkSms`-style path (or `say-to`, gated).
3. Idempotent on call_id (never double-send).

## Delivery
- Reuse the hosting pattern from #7: upload to Supabase `frank-media` public bucket, text a short link. A per-call link can be the direct public URL, or a `frank-go /r/<id>` style redirect.
- Outbound is gated (never-send-without-approval for operator sends; but a system-generated recap to the caller who just called is arguably consented — decide the gate posture with Alex; default to the existing SMS path used by `send_app_link`, which already texts callers).

## Slices (smallest-first)
1. **Recap generator** (pure, testable, no DB): extend `gen-frames.py` with a `recap` config (accomplishments[], nextStep, gate, struggleBuster bool) + a recap spec; render one sample. *Buildable now, no frank-pilot wiring.*
2. **Recap content builder**: a function `buildRecapSpec(contextPacket)` in frank-pilot → the spec JSON. Unit-tested off a fixture packet.
3. **Async job + worker**: `recap_jobs` (filed-not-applied migration) + a `scheduler.ts` cron tick gated on `FRANK_RECAP_ENABLED`.
4. **Post-call hook**: enqueue from the call-end handler.
5. **Delivery**: render → upload → text link, idempotent.

## Flags / safety
- Dark by default behind `FRANK_RECAP_ENABLED` (byte-identical scheduler when off, same pattern as the follow-up/outbound blocks).
- Migrations are manual (file-not-apply).
- No PII in logs; recap content is the caller's own data sent only to the caller.

## Verify
- Slice 1: render a sample recap from a fixture, eyeball it.
- End-to-end (staging): a test call → job enqueued → worker renders + texts a link → link plays the recap; struggle-buster path produces the reassurance variant.
