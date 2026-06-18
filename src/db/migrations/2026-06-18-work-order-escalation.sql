-- 2026-06-18 work-order-escalation (D1, compliance-ledger-finish)
--
-- Adds stale-work-order escalation + ETA/promise tracking to work_orders. The
-- maintenance module already creates/assigns/starts/completes orders; this
-- layer answers "which open orders have gone stale, and have we promised a
-- completion date we're about to miss?" and carries the manager-alert state.
--
-- All columns are nullable / defaulted so existing rows and every existing
-- INSERT/UPDATE stay byte-identical. No enum changes — safe to apply through
-- the migration runner (psql -f).
--
--   * estimated_completion_date  — the ETA/"promise" date a manager commits to.
--   * is_outstanding             — a stale order awaiting action. Distinct from
--                                  status='in_progress': an order can be
--                                  in_progress and NOT outstanding, or
--                                  submitted/assigned (never started) and
--                                  outstanding. The stale-sweep sets this.
--   * outstanding_since          — when the order first flipped outstanding
--                                  (audit + "how long has this been stale").
--   * escalation_level           — 0 = none; bumps each time the sweep escalates
--                                  an order that stayed stale (1 = manager, 2 =
--                                  re-escalation, …). Lets the alert assembler
--                                  avoid re-paging on the same level.
--   * manager_alerted_at         — last time a manager alert payload was emitted
--                                  for this order (the notifier-sent timestamp).
--   * promise_breached_at        — when estimated_completion_date elapsed while
--                                  the order was still open (missed promise).

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS estimated_completion_date DATE,
  ADD COLUMN IF NOT EXISTS is_outstanding BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outstanding_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manager_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promise_breached_at TIMESTAMPTZ;

-- Hot path for the stale-sweep: find open (submitted/assigned/in_progress)
-- orders ordered by age. Partial index keeps it small — closed orders
-- (completed/cancelled) are never swept.
CREATE INDEX IF NOT EXISTS idx_work_orders_open_created
  ON work_orders (created_at)
  WHERE status IN ('submitted', 'assigned', 'in_progress');

-- Hot path for the outstanding board + alert assembler.
CREATE INDEX IF NOT EXISTS idx_work_orders_outstanding
  ON work_orders (property_id, outstanding_since)
  WHERE is_outstanding = true;
