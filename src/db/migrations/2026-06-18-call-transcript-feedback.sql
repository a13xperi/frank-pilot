-- Tenant-call feedback loop (Frank core C1) — 2026-06-18
--
-- A human (PM / reviewer) marks a completed Frank call transcript good or bad.
-- That mark is the supervision signal that feeds a training-dataset refresh:
-- "these are the calls that went well / poorly, here is the transcript, here is
-- the structured outcome we extracted". The dataset assembler (see
-- src/modules/call-feedback/dataset.ts) reads the GOOD marks (plus, optionally,
-- BAD marks as negatives) into a JSONL fine-tune / eval corpus.
--
-- Channel-agnostic by design: a feedback row points at EITHER an inbound
-- voice_intake_calls row OR an outbound_validation_calls row (exactly one),
-- both keyed by the ElevenLabs conversation_id we already store. We do NOT
-- duplicate the transcript here — the assembler joins back to the source row's
-- raw_payload / data_collection_results at build time, so a transcript
-- correction upstream is reflected on the next refresh.
--
-- PII posture: this table stores ONLY the mark, the rater, a short note, and
-- the conversation_id pointer. No applicant name / phone / transcript text
-- lands here.

DO $$ BEGIN
  CREATE TYPE call_feedback_channel AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE call_feedback_mark AS ENUM ('good', 'bad');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS call_transcript_feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The ElevenLabs conversation this mark is about. Not a FK: the two source
  -- tables are disjoint and outbound rows may be NULL conversation_id for dry
  -- runs (which are never markable), so we resolve+validate in the service.
  conversation_id  TEXT NOT NULL,
  channel          call_feedback_channel NOT NULL,
  mark             call_feedback_mark NOT NULL,
  -- Optional free-text rationale (why this call was good/bad). Capped in the
  -- service; kept short on purpose — structured signal lives in the join.
  note             TEXT,
  -- Optional category tags for slicing the dataset (e.g. {"tone","accuracy"}).
  tags             TEXT[] NOT NULL DEFAULT '{}',
  -- Who rated it (users.id). SET NULL on user delete so the mark survives.
  rated_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  rated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Whether this row has been folded into a dataset build. The assembler stamps
  -- this so an incremental refresh ("only new marks") is a cheap WHERE.
  dataset_included_at TIMESTAMPTZ,
  -- One mark per (conversation, rater): a rater can flip their own good<->bad
  -- (UPSERT), but two raters' marks on the same call are distinct rows so we
  -- can measure inter-rater agreement later.
  UNIQUE (conversation_id, rated_by)
);

-- Assembler hot path: pull GOOD (and optionally BAD) marks, newest first,
-- optionally only the not-yet-included ones.
CREATE INDEX IF NOT EXISTS idx_call_feedback_mark_rated
  ON call_transcript_feedback (mark, rated_at DESC);

-- Incremental-refresh path: WHERE dataset_included_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_call_feedback_pending_dataset
  ON call_transcript_feedback (rated_at DESC)
  WHERE dataset_included_at IS NULL;
