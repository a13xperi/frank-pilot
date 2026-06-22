# frank-memory — caller memory (SMS-verified)

## Purpose

"Frank remembers you." Let Frank greet a returning caller by name and pick up where
they left off (what they were applying for, the last thing discussed, open follow-ups)
without leaking one caller's history to another person on the same phone. Identity is
proven mid-call with a texted PIN: Frank texts a short code, the caller reads it back,
and only a verified caller's history is read aloud.

The three in-call server tools (`send_pin`, `verify_pin`, `get_caller_history`) are
defined in [`frank-memory-tools.json`](./frank-memory-tools.json) and register on both
the inbound agent (`ELEVENLABS_AGENT_ID`, the 725 number) and the outbound agent
(`ELEVENLABS_OUTBOUND_AGENT_ID`, Donna Louise validation). They POST to the shared
in-call tool route handled by `src/modules/voice-intake/tool-callbacks.ts`, which
dispatches on the URL `:tool_name`, reads the agent-extracted args from the request
body's `parameters` object, and returns `{ ok, result?, message? }` — where `message`
is what Frank reads to the caller.

## Call flow (texted-PIN — both lines today)

1. **Identify the line.** On the outbound agent the number is the one Frank dialed; on
   the inbound agent the caller gives or confirms it. Frank holds the phone in E.164
   (for example `+17025550123`).

2. **Frank texts a PIN → `send_pin`.** Frank fires `send_pin { phone_e164,
   conversation_id }`. The handler issues a short PIN, texts it to that number, and
   returns `ok=true` with a spoken message ("I just texted a code to the number on
   file — can you read it back to me?"). A missed/unparseable number returns
   `ok=false` and Frank asks the caller to repeat it.

3. **Caller reads it back → `verify_pin`.** Frank fires `verify_pin { phone_e164,
   read_back_pin, conversation_id }` with the digits the caller spoke. A correct,
   unexpired, unused PIN returns `ok=true` (identity confirmed). A wrong/expired/used
   PIN returns `ok=false`; Frank asks the caller to try again or resends.

4. **Pull history → `get_caller_history`.** ONLY after `verify_pin` returns `ok=true`,
   Frank fires `get_caller_history { phone_e164 }`. It returns the prior-call summary
   (name, what they were applying for, last topic, open follow-ups), or a "no prior
   calls" result so Frank greets them as new.

5. **Rapport.** Frank weaves the recap in naturally ("Good to hear from you again,
   Maria — last time we were sorting out your income docs for the two-bedroom; did
   those come through?") and continues the conversation.

`get_caller_history` is gated on a verified identity by design: Frank must never read
one caller's history to whoever happens to be holding that phone, so the history pull
will not fire until the PIN round-trips.

## Inbound caller-ID caveat (deferred)

Ideally the **inbound** line would skip the texted PIN when the carrier-verified
caller-ID already matches a known number — true caller-ID is a stronger, lower-friction
signal than a code the caller reads back. ElevenLabs does not hand the verified inbound
ANI to the agent in a form we can trust end-to-end today, so doing that safely needs a
**725 → frank-pilot → ElevenLabs proxy**: the 725 PSTN leg terminates on our side, we
read the carrier ANI, attach it as a trusted signal, and forward the call into the
ElevenLabs agent. That proxy is **deferred** — until it lands, **both lines use the
texted-PIN flow above**, which is uniform and safe on either agent.

## Wiring notes

- **Flag-gated.** The tool route returns `503` until `VOICE_TOOLS_ENABLED=true` and
  `ELEVENLABS_WEBHOOK_SECRET` is a real value (the sentinel `wsec_changeme` is refused).
  Register the tools dark, then flip the flag on Railway once the handlers are wired.
- **Signed + idempotent.** Every fire is HMAC-verified and deduped on
  `tool:<conversation_id>:<tool_call_id>` via `elevenlabs_processed_events`, and stamped
  to the tape as `VOICE_TOOL_INVOKED` — the same pipeline as `send_app_link`. Handlers
  return `200 { ok: false, message }` on any "can't do that" path so ElevenLabs never
  auto-disables the webhook.
- **PII.** Phone numbers are logged masked (last-4 only); never log a full E.164 or a
  PIN.
