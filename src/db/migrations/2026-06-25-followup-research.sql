-- Research loop (Frank "ask -> capture -> research -> deliver").
-- A follow_up can now carry an open QUESTION Frank couldn't answer, the researched
-- ANSWER + its SOURCE, and a research_status the worker + dialer gate on:
--   none            -- ordinary callback, no research needed (default)
--   needs_research  -- captured a question; the worker should research it
--   researching     -- claimed by the worker
--   ready_for_review-- answer written, awaiting human approval
--   approved        -- answer approved; the dialer may deliver it
--   failed          -- research failed (left for retry/operator)
-- Idempotent (ADD COLUMN IF NOT EXISTS) — same shape as 2026-06-24-frank-call-resume.sql.

ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS question        TEXT;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS answer          TEXT;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS answer_source   TEXT;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS research_status TEXT NOT NULL DEFAULT 'none';

-- Partial index so the worker's "claim next needs_research" stays cheap.
CREATE INDEX IF NOT EXISTS idx_follow_ups_needs_research
  ON follow_ups (created_at)
  WHERE research_status = 'needs_research';
