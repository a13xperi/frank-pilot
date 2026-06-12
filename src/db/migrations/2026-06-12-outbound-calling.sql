-- 2026-06-12 outbound-calling
--
-- Voice-intake Phase 2 (DM-FRANK-029): outbound AI calling for the new-unit
-- occupancy push. Three tables:
--
--   * waitlist_import_batches    — one row per legacy wait-list file handoff
--                                  (One Site export / operator spreadsheet)
--   * external_waitlist_entries  — one row per person on the legacy list.
--                                  source_position preserves the operator's
--                                  ordering: compliance sequencing FILTERS
--                                  (windows, consent, attempts) but NEVER
--                                  reorders (HUD 4350.3 Ch. 4 waiting-list
--                                  management).
--   * outbound_call_queue        — human-on-the-loop dial queue. Rows are
--                                  born 'proposed'; a reviewer approves; the
--                                  dialer only ever places 'approved' rows.
--
-- Removal is NEVER automatic: when the 12-day window expires or attempts max
-- out, the entry flips to 'removal_review' and a person decides.
--
-- TCPA posture: consent_outbound (PEWC) gates proposal AND dial; the dialer
-- additionally refuses outside 8am–9pm recipient-local time. Every attempt
-- stamps VOICE_INTAKE_OUTBOUND_ATTEMPTED (TCPA 47 CFR §64.1200(a)(2)).
--
-- No ALTER TYPE here — safe inside a transaction.

CREATE TABLE IF NOT EXISTS waitlist_import_batches (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID REFERENCES properties(id) ON DELETE SET NULL,
  source_label  TEXT NOT NULL,
  row_count     INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  imported_by   UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_waitlist_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id        UUID NOT NULL REFERENCES waitlist_import_batches(id) ON DELETE CASCADE,
  property_id     UUID REFERENCES properties(id) ON DELETE SET NULL,
  source_position INTEGER NOT NULL,
  full_name       TEXT NOT NULL,
  phone           VARCHAR(20),
  email           TEXT,
  bedroom_count   SMALLINT,
  listed_at       DATE,
  -- TCPA PEWC: prior express written consent to receive AI/autodialed calls,
  -- as recorded on the legacy list. FALSE = never proposed, never dialed.
  consent_outbound BOOLEAN NOT NULL DEFAULT FALSE,
  consent_source   TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','queued','contacted','interested','declined',
                      'unreachable','removal_review','removed','converted')),
  contact_attempts           INTEGER NOT NULL DEFAULT 0,
  first_contacted_at         TIMESTAMPTZ,
  last_contacted_at          TIMESTAMPTZ,
  -- 48-hour response window opened by each contact attempt; 12-day final
  -- window anchored at first contact. Expiry surfaces the entry for review.
  response_window_expires_at TIMESTAMPTZ,
  removal_window_expires_at  TIMESTAMPTZ,
  matched_application_id     UUID REFERENCES applications(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, source_position)
);

CREATE INDEX IF NOT EXISTS idx_external_waitlist_lane
  ON external_waitlist_entries(property_id, status, source_position);
CREATE INDEX IF NOT EXISTS idx_external_waitlist_phone
  ON external_waitlist_entries(phone);

CREATE TABLE IF NOT EXISTS outbound_call_queue (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id         UUID NOT NULL REFERENCES external_waitlist_entries(id) ON DELETE CASCADE,
  status           VARCHAR(20) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected','dialing','completed','failed')),
  attempt_number   INTEGER NOT NULL DEFAULT 1,
  proposed_by      UUID REFERENCES users(id),
  reviewed_by      UUID REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  reject_reason    TEXT,
  -- Consent frozen at proposal time so the audit row is self-contained even
  -- if the entry's consent flag is later edited.
  consent_snapshot BOOLEAN,
  -- Earliest legal dial time (TCPA quiet hours) computed at proposal.
  scheduled_after  TIMESTAMPTZ,
  conversation_id  TEXT,
  dial_result      VARCHAR(20),
  dialed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live queue row per entry at a time; terminal rows free the entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_queue_one_active
  ON outbound_call_queue(entry_id)
  WHERE status IN ('proposed','approved','dialing');
CREATE INDEX IF NOT EXISTS idx_outbound_queue_status
  ON outbound_call_queue(status, created_at);
