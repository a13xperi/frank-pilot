-- Community Care Line — unified incident model (GL-G / care-line).
--
-- Frank's proactive outbound care line AND the inbound anonymous-tips channel
-- both capture here. ONE table; anonymity is a row mode, not a separate store.
-- Ships DARK: nothing writes until CARE_LINE_ENABLED=true + a counsel sign-off.
-- TEXT+CHECK enums (repo convention; no CREATE TYPE) so the migration applies in
-- one transaction. NO-PII discipline for anonymous rows is enforced by a CHECK.

CREATE TABLE IF NOT EXISTS care_incidents (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code           TEXT NOT NULL UNIQUE,           -- FRANK-XXXX, issued every incident
  -- taxonomy (§6)
  severity                 TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  category                 TEXT NOT NULL CHECK (category IN (
                             'life_safety','safety_security','building_systems_down',
                             'unit_habitability','lease_violation','resident_wellbeing',
                             'move_in','general_info','anonymous_tip')),
  status                   TEXT NOT NULL DEFAULT 'captured' CHECK (status IN (
                             'captured','triaged','routed','escalated','resolved','dismissed')),
  routing_intent           TEXT CHECK (routing_intent IN (
                             'call_911_oncall','oncall_workorder','workorder',
                             'human_triage','crisis_988','log_only')),
  -- §7 structured intake (resident's words + Frank's summary; counts/strings only)
  summary_what             TEXT NOT NULL,
  where_building           TEXT,
  where_floor              TEXT,
  where_unit               TEXT,
  where_amenity            TEXT,
  occurred_when            TEXT,                            -- free text / 'ongoing'
  who_affected             TEXT,
  safety_flag              BOOLEAN NOT NULL DEFAULT FALSE,  -- anyone at risk right now?
  self_harm_flag           BOOLEAN NOT NULL DEFAULT FALSE,
  resident_request         TEXT,
  promise_made             TEXT,
  -- reporter identity (§8 anonymity model)
  reporter_kind            TEXT NOT NULL DEFAULT 'named' CHECK (reporter_kind IN ('named','anonymous')),
  reporter_name            TEXT,
  reporter_phone           TEXT,
  callback_opt_in          BOOLEAN NOT NULL DEFAULT FALSE,
  callback_phone           TEXT,
  -- channel + linkage
  channel                  TEXT NOT NULL DEFAULT 'voice_outbound' CHECK (channel IN (
                             'voice_outbound','voice_inbound','sms','web')),
  property_id              UUID REFERENCES properties(id),
  conversation_id          TEXT,                            -- ElevenLabs call id (if voice)
  -- routing back-refs: set ONLY when a human spawns the artifact (never auto)
  work_order_id            UUID REFERENCES work_orders(id),
  decision_matrix_referral BOOLEAN NOT NULL DEFAULT FALSE,  -- systemic → human /intake
  -- triage / lifecycle
  triage_notes             TEXT,
  resolution_notes         TEXT,
  resolved_at              TIMESTAMPTZ,
  raw_payload              JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- §8: anonymous rows must NOT carry identity columns (DB-level guarantee)
  CONSTRAINT care_incidents_anon_no_pii CHECK (
    reporter_kind <> 'anonymous' OR (reporter_name IS NULL AND reporter_phone IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_care_incidents_status_sev
  ON care_incidents (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_incidents_conversation
  ON care_incidents (conversation_id);

-- On-call roster: who a P0/after-hours-P1 escalation pages.
CREATE TABLE IF NOT EXISTS on_call_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID REFERENCES properties(id),
  user_id      UUID REFERENCES users(id),
  role         TEXT,
  phone        TEXT,
  shift_start  TIMESTAMPTZ NOT NULL,
  shift_end    TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_on_call_active
  ON on_call_assignments (property_id, shift_start, shift_end);

-- Durable record that "a human was flagged" — survives an SMS failure.
CREATE TABLE IF NOT EXISTS care_escalations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     UUID NOT NULL REFERENCES care_incidents(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  on_call_user_id UUID REFERENCES users(id),
  notified_via    TEXT NOT NULL DEFAULT 'pending' CHECK (notified_via IN (
                    'pending','sms','tape_only','none_available')),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_care_escalations_incident
  ON care_escalations (incident_id);

-- Recipient-local calling hours need a per-property timezone (none existed).
ALTER TABLE properties ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Backward-compat: the DRAFT frank-anonymous-tips protocol's frank_tips surface,
-- now a VIEW over the anonymous rows of the unified model (no separate store).
CREATE OR REPLACE VIEW frank_tips AS
  SELECT id,
         reference_code AS code,
         category,
         summary_what   AS body_text,
         status,
         callback_opt_in,
         callback_phone,
         created_at,
         updated_at
  FROM care_incidents
  WHERE reporter_kind = 'anonymous';
