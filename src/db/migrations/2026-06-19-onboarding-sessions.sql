-- Onboarding concierge session — the cross-channel progress spine over `applications`.
--
-- One applicant's run through the multi-step application, tracked independently of
-- WHICH channel they use (web guide / phone / SMS), so a disorganized person can
-- start on a call, get a text, and finish on the web — resuming at the exact step.
-- The system of record stays `applications`; this table tracks PROGRESS + resumability,
-- not the answers themselves (those land on `applications`, SSN/DOB encrypted there).
--
-- Soft link to application_id (NO FK): a session is created at first contact, often
-- before a draft `applications` row exists, and a bad/missing id must never 500 the
-- guide. `answers_state` stages in-progress NON-sensitive answers so a run can resume
-- across channels; SENSITIVE values (SSN/DOB/payment) are NEVER stored here — they go
-- straight to `applications` (encrypted, via ApplicationService) at the secure web commit.

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID,                       -- soft link to applications.id (set once a draft exists)
  resume_token     TEXT UNIQUE NOT NULL,       -- unguessable handle → /apply?resume=<token>

  -- Identity, for resume + nudge ONLY (the answers themselves live on `applications`)
  email            TEXT,
  phone_last4      TEXT,                        -- last 4 digits only (triage; full number on applications)

  current_step     TEXT NOT NULL DEFAULT 'identity',
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'complete', 'abandoned')),

  -- Per-question state: { "<question_id>": { status, channel, at, value? } }. `value` is
  -- present ONLY for non-sensitive questions (the resume spine); sensitive answers are
  -- marked answered with NO value. status ∈ ('pending','answered','skipped').
  answers_state    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Which channel the person prefers / started on, so nudges reach them where they are.
  channel_pref     TEXT CHECK (channel_pref IN ('web', 'sms', 'voice', 'email')),
  started_channel  TEXT,

  -- Nudge bookkeeping — the stalled-session sweep reads these.
  last_contact_at  TIMESTAMPTZ,                 -- last time WE reached out
  last_progress_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- last time THEY advanced
  nudge_count      INTEGER NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link an application back to its in-flight onboarding run.
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_application
  ON onboarding_sessions (application_id);

-- The nudge sweep: active + stalled, ordered by how long they've been stuck. Partial
-- index keeps it tiny (only live sessions) for the cron's hot path.
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_nudge
  ON onboarding_sessions (last_progress_at)
  WHERE status = 'active';
