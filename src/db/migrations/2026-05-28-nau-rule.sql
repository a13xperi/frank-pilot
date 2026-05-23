-- QAP acquisitions Phase 3.2 — Next Available Unit Rule (NAU).
-- Idempotent. Matches the nau_* columns added to the recertifications block
-- in schema.ts.
--
-- When a recert income check returns `over_income` (>140% of the applicable
-- limit, IRC §42(g)(2)(D)(ii)) the occupied low-income unit goes out of
-- compliance and stays so until the *next comparable available unit* in the
-- same property is rented to a qualifying household. We track that obligation
-- here so the queue can surface open NAU items; the immutable record lives on
-- the compliance tape (acq.nau_triggered / acq.nau_satisfied).
--
--   nau_status:           open      — over-income, NAU obligation outstanding
--                         satisfied — a comparable unit was rented to a
--                                     qualifying household, set-aside preserved
--                         lost      — obligation not satisfied; unit converts
--                                     to market rent
--                         NULL      — no NAU obligation (verdict not over_income)
--   nau_resolved_at:      when the obligation was satisfied/lost
--   nau_resolving_unit_id: the comparable unit that satisfied the obligation
--                          (no hard FK — units may be reorganized; nullable)

ALTER TABLE recertifications
  ADD COLUMN IF NOT EXISTS nau_status TEXT
    CHECK (nau_status IN ('open','satisfied','lost')),
  ADD COLUMN IF NOT EXISTS nau_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nau_resolving_unit_id UUID;

-- Surface open NAU obligations for the follow-up queue.
CREATE INDEX IF NOT EXISTS idx_recertifications_nau_open
  ON recertifications(nau_status)
  WHERE nau_status = 'open';
