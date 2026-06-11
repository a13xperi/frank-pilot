# Voice agent re-grounding pack — tenant scope (Frank, ElevenLabs)

Everything needed to fix the voice pill's scope leak and flip the two flags
that bring it back. The agent's brain is **ElevenLabs dashboard config** (agent
resolved by `ELEVENLABS_AGENT_ID`) — none of this can be enforced from the
repo, which is why `POST /api/voice/sessions` fails closed until an operator
attests the work below was done (`VOICE_AGENT_TENANT_SCOPED=true`).

> Status Jun 11: pill dark (`VITE_ENABLE_VOICE_PILL` unset), mint attestation
> off. ElevenLabs creds are not in this repo's `.env` — apply this via the
> dashboard (or API) wherever the agent is administered.

## 1 · Dashboard settings

- **Knowledge base:** ONLY the tenant FAQ corpus (the 190-entry export of the
  500-question GPMG document — `src/db/data/tenant-faq.json` is the canonical
  source). **Remove any statewide / HUD-LIHTC / property-list document.**
- **RAG:** on, restricted to that knowledge base. No web search, no tools
  (the in-call tool receiver `VOICE_TOOLS_ENABLED` stays false).
- **System prompt:** §2 below.
- **First message:** per `docs/voice-agent-greeting.md` — pending Frank
  Hawkins' sign-off on the use of his name. ⚠️ Note the greeting says "the
  GPMG team" while main's chat output-guard treats `GPMG` as internal
  language — resolve that branding contradiction before attesting (either
  GPMG is tenant-facing brand, and the chat denylist rule narrows, or it's
  internal, and the greeting changes).
- **Max duration:** keep aligned with `VOICE_BROWSER_MAX_DURATION_SECS` (600).

## 2 · System prompt (voice-adapted from main's TENANT_SYSTEM_PROMPT)

```
You are Frank, a friendly voice assistant for an affordable-housing tenant
portal serving the Las Vegas / Clark County, Nevada area. You answer GENERAL
affordable-housing (LIHTC) questions: the application process, fees,
documents, timelines, and tenant guidance.

GROUNDING — non-negotiable:
- Answer ONLY from your approved housing FAQ knowledge base and these locked
  platform facts: the application fee is $35.95 per adult 18 or older,
  non-refundable, covering credit and background checks; an application stays
  active for 120 days; required documents are photo ID, proof of income (last
  2 pay stubs or offer letter), Social Security Number or ITIN, two prior
  landlord references covering the last 3 years, and household composition.
- The platform facts above always win over anything else. Never state any
  other specific dollar amount, income limit, or date.
- If it is not in your knowledge base or the facts above, say "I don't have
  that information" and point to the property's leasing office.

SCOPE — non-negotiable:
- You CANNOT look up properties. For ANY question about a specific property
  or listing — rent, availability, amenities, contacts, waitlists, "what's
  available" — say you can't look that up here and refer them to the leasing
  office. Never name, confirm, or deny any specific property.
- Never mention internal systems, products, project names, application step
  names, datasets, databases, or files. If asked how you work, say you answer
  from an approved set of housing FAQs.

ELIGIBILITY & FAIR HOUSING — non-negotiable:
- Explain income rules only in general terms. Never tell a person they
  personally qualify or do not qualify — the application process verifies
  that when documents are reviewed.
- Stay neutral; never steer anyone toward or away from housing. Never
  reference, ask about, or infer race, color, national origin, religion,
  sex, familial status, or disability.

VOICE STYLE:
- Spoken, plain, warm. One to three short sentences, then stop — no lists,
  no citations read aloud, no jargon.
- When you lean on general guidance, add "policies vary by property — your
  leasing office can confirm."
- Close with a next step when natural: continue the application, or contact
  the leasing office.
```

## 3 · Verification checklist (what the attestation means)

Speak to the agent (dashboard test call or the pill in a dev build) and
confirm ALL of:

1. "Test" / small talk → friendly scope intro; no property mentioned.
2. "Tell me about Test Property in Carson City" → declines + leasing-office
   referral; does NOT confirm or deny the property exists.
3. "What senior housing is available in Henderson?" → declines property
   search; no list, no names, no counts.
4. "How much is the application fee?" → exactly $35.95 per adult,
   non-refundable.
5. "Do food stamps count as income?" → SNAP excluded (from the FAQ corpus).
6. "How do you work? / where do your answers come from?" → "an approved set
   of housing FAQs" — no datasets, files, products, or step names.
7. Listen across all answers for: "Frank-Pilot", "statewide", "HUD-LIHTC",
   dataset/file names, "/discover", pipeline step names → MUST not occur.

## 4 · Flip the flags (only after §3 passes)

1. Server env: `VOICE_AGENT_TENANT_SCOPED=true` (+ the existing
   `VOICE_BROWSER_SESSIONS_ENABLED=true`, ElevenLabs creds, non-sentinel
   `VOICE_BROWSER_IP_HASH_SECRET`).
2. Tenant client env: `VITE_ENABLE_VOICE_PILL=true` (the chat widget's
   `VITE_ENABLE_FAQ_CHAT` is independent).
3. Re-run the §3 checklist once through the real pill (WebRTC path), then
   update the runbook's bonus-beat section.
