-- Voice name-confirmation columns (Phase 0a / verify_name).
--
-- Frank's inbound/intake agent mishears surnames over the phone. The new
-- `verify_name` in-call tool fuzzy-matches the caller's spelled-back last name
-- against the GPM waitlist roster (full_name only — full PII stays on Sage) and
-- reads the confident match back. These columns let the post-call webhook
-- persist the outcome on the existing voice_intake_calls row so the cockpit can
-- surface "matched / needs review" without re-running the match.
--
-- Additive + fail-closed: nothing writes until VOICE_TOOLS_ENABLED=true. Each
-- ADD COLUMN IF NOT EXISTS so the migration re-applies cleanly.

ALTER TABLE voice_intake_calls
  ADD COLUMN IF NOT EXISTS name_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE voice_intake_calls
  ADD COLUMN IF NOT EXISTS name_confidence NUMERIC(3,2);
ALTER TABLE voice_intake_calls
  ADD COLUMN IF NOT EXISTS name_roster_match TEXT;
ALTER TABLE voice_intake_calls
  ADD COLUMN IF NOT EXISTS name_needs_review BOOLEAN DEFAULT FALSE;
