-- Application requirements checklist (the structured "what's still missing").
--
-- Frank's follow-up loop can already schedule a callback and resume from a
-- free-form `follow_ups.checkpoint`. This makes "what isn't done yet" STRUCTURED
-- and DETERMINISTIC: one row per required item per application, flipped to
-- received/verified as each lands. computeMissing() fuses these explicit rows
-- with the system-of-record columns on `applications` (identity / income /
-- consent screening verdicts) so a callback names the exact gap ("your two most
-- recent pay stubs") instead of relying on the LLM to recall it from the
-- free-form checkpoint -- and the loop auto-closes when the gap is filled.
--
-- The table is an OVERRIDE / receipt layer: an item with no explicit row falls
-- back to its column-derived status (see src/modules/requirements/catalog.ts),
-- so this works for every existing application with ZERO backfill. A row is
-- written only when something is recorded out-of-band of the screening columns
-- (Frank's `mark_requirement` tool, a PM action, a document upload).
--
-- Person/anchor model matches the rest of the app: phone-of-record reaches the
-- checklist by resolving the latest `applications` row for that phone, so the
-- follow-ups context packet (phone-keyed) can carry the missing items.
--
-- Sequenced inside the 2026-06-24 delta set; sorts before follow-ups.sql, but
-- depends only on the base `applications` + `users` tables, never on follow_ups.
-- Idempotent: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS application_requirements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  item_key        TEXT NOT NULL,   -- photo_id | ssn_proof | income_paystubs | consent_screening | ...
  status          TEXT NOT NULL DEFAULT 'missing'
                    CHECK (status IN ('missing','received','verified','waived')),
  received_at     TIMESTAMPTZ,
  received_ref    TEXT,            -- upload url / note / 'voice:<conversation_id>'
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES users(id),
  source          TEXT,            -- voice | pm_console | stripe_identity | screening | ...
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, item_key)
);

-- The checklist read is always per-application (the open-loop computation).
CREATE INDEX IF NOT EXISTS idx_app_requirements_app
  ON application_requirements (application_id);
