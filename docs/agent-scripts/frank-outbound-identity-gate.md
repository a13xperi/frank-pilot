# frank-outbound agent — identity gate (burn blocker B5) + prompt home (B6)

**Why:** the outbound validator confirms interest/apt/date but never confirms it is speaking to
the right person first. Calling a real applicant's number and discussing their housing application
with whoever answers is a privacy + TCPA exposure and risks recording a disposition against the
wrong person. This adds an explicit identity gate before any application detail is disclosed.

**Where to apply:** ElevenLabs dashboard → Conversational AI → agent **frank-outbound**
(`agent_6601ktwp1tz1e9591gg20w2rf226`) → System prompt + Data collection. After applying, paste
the FULL exported system prompt below under "Current full prompt" so it is version-controlled (B6).

---

## 1. Add this block to the SYSTEM PROMPT (near the top of the call flow, before any interest/apt questions)

```
## IDENTITY GATE — do this FIRST, before anything else

Open by asking for the person by name, and do NOT discuss the apartment, the waitlist, their
application, or any personal detail until you have explicitly confirmed you are speaking with them.

  You: "Hi, this is Frank calling on behalf of Global Property Management about the apartment
        waitlist. May I please speak with {{applicant_name}}?"

Branch on the answer:

- They confirm they ARE {{applicant_name}} ("speaking", "that's me", "yes this is [name]"):
  set identity_confirmed = true, then continue to the interest questions.

- Someone else answers / {{applicant_name}} is not available:
  Do NOT disclose any application or apartment details. Say: "No problem, I'll try {{applicant_name}}
  again another time. Thank you!" Set identity_confirmed = false. End politely.

- Wrong number / nobody by that name here:
  Say: "My apologies, I think I have the wrong number. Have a good day." Set wrong_number = true,
  identity_confirmed = false. End. Do NOT reveal who you were trying to reach beyond the first name
  already said, and do NOT describe the application.

- They are evasive or you are not sure it is them:
  Ask once more, plainly: "Just to confirm, am I speaking with {{applicant_name}}?" Only set
  identity_confirmed = true on an explicit yes. If still unclear, treat as "not available" above.

NEVER state apartment type, move-in date, income, or that they are on a waitlist until
identity_confirmed = true.
```

## 2. Add this DATA COLLECTION field
- **`identity_confirmed`** (boolean): "true ONLY if the person explicitly confirmed they are
  {{applicant_name}}. false if someone else answered, wrong number, or unconfirmed."
  (The schema already has `wrong_number`, `reached_voicemail`, `still_interested`, `wants_callback`.)

## 3. Downstream code follow-on (should-fix, tie to this)
In `src/modules/outbound-validation/outcome.ts` `mapPostCallToOutcome`, gate a `confirmed`/`declined`
disposition on `identity_confirmed === true`. If identity was not confirmed, map to `no_answer`
(re-queue) or `callback_requested`, never `confirmed`/`declined` — so we never record an interest
decision made by the wrong person.

---

## Current full prompt (B6 — paste the exported ElevenLabs system prompt here)
_(export from the dashboard and commit, so call behavior is auditable + rollback-able)_

```
TODO: paste the live frank-outbound system prompt here after applying the gate above.
```
