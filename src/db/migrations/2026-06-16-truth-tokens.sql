-- Truth Token — provable grounding attestation (Phase 3).
--
-- Every grounded answer the platform emits can mint a Truth Token: a small,
-- PII-free receipt that BINDS the answer to (a) the exact question, (b) the
-- model that produced it, and (c) the precise set of retrieval sources it was
-- allowed to see. The binding is a SHA-256 over the canonical JSON of those
-- inputs (see src/modules/truth-token/service.ts), so anyone holding the
-- answer text + source ids can later recompute the hash and prove the answer
-- was grounded in those sources by that model — without trusting our logs.
--
-- PII-minimal by design: we store hashes (answer_hash, source_set_hash,
-- question_hash) and source IDENTIFIERS only — never the question text, the
-- answer text, or any applicant/tenant detail. The answer_hash is UNIQUE: the
-- same answer for the same question+sources+model mints one canonical token.
--
-- `ledger_head` optionally anchors the token to the compliance-tape hash chain
-- head at issue time, so a future contradiction check can detect a token that
-- references state the ledger later supersedes. Nullable — minting never blocks
-- on the ledger.

CREATE TABLE IF NOT EXISTS truth_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       TEXT,                                   -- optional correlation id (null when caller omits)
  answer_hash      TEXT NOT NULL UNIQUE,                   -- SHA-256(canonical{question,answer,sourceIds,modelId})
  model_id         TEXT NOT NULL,                          -- the model that produced the answer
  engine           TEXT,                                   -- optional sub-engine label (sdk/cli/...)
  source_ids       JSONB NOT NULL DEFAULT '{}'::jsonb,     -- the allowed source-id set this answer was grounded in
  source_set_hash  TEXT NOT NULL,                          -- SHA-256(canonical(sourceIds)) — stable set fingerprint
  ledger_head      TEXT,                                   -- compliance-tape chain head at issue time (nullable)
  question_hash    TEXT,                                   -- SHA-256(canonical(question)) — bind w/o storing the text
  created_by       TEXT NOT NULL,                          -- issuing surface/module (e.g. 'housing-qa')
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Time-ordered scans for the verify/audit surfaces and retention sweeps.
CREATE INDEX IF NOT EXISTS idx_truth_tokens_created_at
  ON truth_tokens (created_at);
