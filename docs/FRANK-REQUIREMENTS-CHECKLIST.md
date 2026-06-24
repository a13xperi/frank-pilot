# Requirements checklist — the deterministic "what's still missing" for the follow-up loop

## Why

The follow-up loop (`follow_ups` + `schedule_followup` / `get_call_context` / the
Phase-2 dialer + the `checkpoint` resume) already lets Frank schedule a callback
and pick up where he left off. But "what isn't done yet" was a **free-form
`follow_ups.checkpoint` string the LLM writes** — non-deterministic, not
queryable, and it never updated when a document actually arrived.

This adds a structured, queryable checklist so:
- a callback names the **exact** gap ("were you able to find your pay stubs?")
  from a system-known list, not from the LLM re-reading a prose checkpoint;
- the loop **auto-closes** when the gap is filled (Frank never calls back about
  something already received);
- the operator can see **where every callback sits** (`bs followups`).

Driving scenario (Craig): photo ID verified + SSN on file + consent given, only
pay stubs outstanding → `missing = [income_paystubs]` → the callback asks for
exactly that; marking it received closes the open document-chase follow-up.

## What shipped (code, dark by default)

- **`application_requirements`** table (`src/db/migrations/2026-06-24-application-requirements.sql`)
  — an OVERRIDE/receipt layer. `computeMissing` **fuses** explicit rows with the
  screening columns already on `applications` (`identity_verification_result`,
  `income_verified`, `screening_authorization_at`, `ssn_encrypted`), so it works
  for **every existing application with zero backfill**. Resilient if the table
  isn't migrated yet (degrades to column-derived only).
- **`src/modules/requirements/`** — `catalog.ts` (the item set:
  `photo_id | ssn_proof | income_paystubs | consent_screening`, each with a pure
  column→status rule) + `service.ts` (`computeMissing` / `computeMissingByPhone`
  / `markItem` / `markItemByPhone` + `resolveFollowupsIfComplete`) + `tools.ts`
  (`mark_requirement`).
- **Follow-up wiring** — `buildContextPacket` now carries `missing_items`; the
  Phase-2 dialer passes `missing_items` + `missing_count` as **dynamic
  variables**; `get_call_context` speaks the gap.
- **`mark_requirement`** voice tool — records "here are my pay stubs" in-call
  (phone-keyed), reports what's left, and auto-closes the loop when done.
- **Cockpit** — `npm run cli -- followups [--board | <id>]` (agenda / board /
  detail), thin-wrapped by `bs followups` (battlestation, `$FRANK_PILOT_DIR`).

## Flip live (in order)

1. **Apply the migration** to the frank-pilot DB:
   `npm run migrate` (applies `2026-06-24-application-requirements.sql`).
2. **Register the `mark_requirement` server tool** in the ElevenLabs dashboard
   (the backend handler is already wired in `src/index.ts`):
   - URL: `POST {API}/api/webhooks/elevenlabs/tools/mark_requirement`
   - secret header (same as the other tools), flat body.
   - params: `phone_e164` (string), `item_key` (enum: `photo_id | ssn_proof |
     income_paystubs | consent_screening`), `status` (optional, default
     `received`).
   - add its tool id to the agent's `tool_ids`.
3. **Use the new dynamic vars in the prompt.** The Phase-2 callback already binds
   `missing_items` (e.g. "your two most recent pay stubs") and `missing_count`.
   Add to `frank-front-desk.md` (callback / `is_followup` section): *"If
   `{{missing_items}}` is set, open the callback by asking for exactly those — 'I
   just need {{missing_items}} to finish up' — and when the caller confirms they
   have one, call `mark_requirement` with that item."*
4. **Verify** with `bs followups --board` then `bs followups` (set
   `FRANK_PILOT_DIR` to the deployed/merged checkout), and a timed test call.

## Notes

- Migrations are filed-not-applied; nothing changes behavior until step 1 + the
  dashboard wiring.
- PII-minimal: the checklist stores only coarse item status; phones are masked in
  `bs followups`. No name/SSN/DOB in the report or the context packet.
- `get_caller_history`'s PIN identity fence still gates any readback of a returning
  caller's specifics — the checklist rides behind it.
