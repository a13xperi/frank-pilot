-- ============================================================================
-- B3 — Entity-level GL/AP ledger: GENERIC double-entry foundation
-- ============================================================================
-- Scope: ONLY what is universal to any double-entry GL/AP system. Entity-
-- specific posting rules + the real chart of accounts come from Tanya's 8-step
-- intake (docs/deals/TANYA-GL-INTAKE.md) and slot in as DATA (config + rows),
-- NOT as schema changes. Nothing here hardcodes a Frank/GPM-specific account or
-- rule. The seeded chart of accounts is a STANDARD placeholder, clearly marked
-- "PLACEHOLDER — replace from TANYA-GL-INTAKE", and is replaceable per book.
--
-- This is distinct from `tenant_ledger` (tenant accounts-RECEIVABLE / rent),
-- which already exists on main. This is the entity-level GENERAL ledger: the
-- books an accountant closes each month.
--
-- Idempotent: CREATE … IF NOT EXISTS; enums wrapped in DO/EXCEPTION; all new
-- columns nullable or defaulted. Safe to re-run. Applied by src/db/migrate.ts
-- in filename order and tracked in schema_migrations.
--
-- DDL_PENDING: this migration is NOT yet applied to any database. Apply via
-- `npm run migrate` (or psql) against the target before the module is wired in.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────

-- Normal balance side of an account (the side that INCREASES it).
DO $$ BEGIN
  CREATE TYPE gl_normal_side AS ENUM ('debit', 'credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Top-level account classification (standard accounting equation buckets).
DO $$ BEGIN
  CREATE TYPE gl_account_type AS ENUM (
    'asset', 'liability', 'equity', 'revenue', 'expense'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Journal entry lifecycle. `draft` entries are editable; `posted` are immutable
-- and affect balances; `reversed` are posted entries neutralized by a reversing
-- entry (append-only — we never delete a posted entry).
DO $$ BEGIN
  CREATE TYPE gl_entry_status AS ENUM ('draft', 'posted', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Where an entry came from. `shadow` = parallel-run only, NEVER system-of-record.
DO $$ BEGIN
  CREATE TYPE gl_entry_mode AS ENUM ('live', 'shadow');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Accounting-period state. A locked period rejects new postings dated within it.
DO $$ BEGIN
  CREATE TYPE gl_period_status AS ENUM ('open', 'locked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AP bill lifecycle (see ap-state-machine.ts — the rules live in code; this enum
-- is the persisted shape).
DO $$ BEGIN
  CREATE TYPE ap_bill_status AS ENUM (
    'draft', 'submitted', 'approved', 'rejected', 'scheduled',
    'partially_paid', 'paid', 'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Entities / books (multi-entity) ──────────────────────────────────────────
-- An `entity` is a legal entity or a property. A `book` is a set of ledgers
-- (its own COA + journals + balances). A property posts to its own book;
-- `is_consolidation = true` marks a roll-up book that aggregates child books.
-- Generic: how entities map to books is DATA, configured per deployment.

CREATE TABLE IF NOT EXISTS gl_entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,          -- short stable handle, e.g. "PROP-725"
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'property'  -- 'property' | 'legal_entity' | 'consolidation'
                 CHECK (kind IN ('property', 'legal_entity', 'consolidation')),
  parent_id    UUID REFERENCES gl_entities(id),  -- for consolidation trees
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gl_books (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          UUID NOT NULL REFERENCES gl_entities(id),
  code               TEXT NOT NULL UNIQUE,     -- e.g. "PROP-725-GL"
  name               TEXT NOT NULL,
  base_currency      CHAR(3) NOT NULL DEFAULT 'USD',
  is_consolidation   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Which COA source this book uses. 'PLACEHOLDER' until Tanya's COA is loaded.
  coa_source         TEXT NOT NULL DEFAULT 'PLACEHOLDER',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gl_books_entity ON gl_books (entity_id);

-- Which child books roll up into a consolidation book (many-to-many).
CREATE TABLE IF NOT EXISTS gl_book_consolidation_members (
  consolidation_book_id UUID NOT NULL REFERENCES gl_books(id),
  member_book_id        UUID NOT NULL REFERENCES gl_books(id),
  PRIMARY KEY (consolidation_book_id, member_book_id)
);

-- ── Chart of accounts ────────────────────────────────────────────────────────
-- Per-book so different entities can carry different charts. The SEEDED rows
-- below are a STANDARD placeholder set; replace with Tanya's actual COA.

CREATE TABLE IF NOT EXISTS gl_chart_of_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       UUID NOT NULL REFERENCES gl_books(id),
  code          TEXT NOT NULL,                 -- account number, e.g. "1000"
  name          TEXT NOT NULL,
  account_type  gl_account_type NOT NULL,
  normal_side   gl_normal_side  NOT NULL,
  parent_code   TEXT,                          -- for sub-accounts / roll-ups
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  -- TRUE for the standard placeholder rows so they're easy to find + purge when
  -- Tanya's real COA is loaded.
  is_placeholder BOOLEAN NOT NULL DEFAULT FALSE,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, code)
);

CREATE INDEX IF NOT EXISTS idx_gl_coa_book ON gl_chart_of_accounts (book_id);

-- ── Accounting periods ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gl_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     UUID NOT NULL REFERENCES gl_books(id),
  period      TEXT NOT NULL,                   -- 'YYYY-MM'
  status      gl_period_status NOT NULL DEFAULT 'open',
  locked_at   TIMESTAMPTZ,
  locked_by   UUID,
  -- Tie-out snapshot captured at close (debits/credits/by-account), for audit.
  tie_out     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, period)
);

CREATE INDEX IF NOT EXISTS idx_gl_periods_book ON gl_periods (book_id);

-- ── Journal entries + lines ──────────────────────────────────────────────────
-- The header carries provenance (source doc) + mode (live/shadow). Lines carry
-- the per-account debit/credit amounts. An entry MUST balance: Σdebit = Σcredit.
-- Enforced in code (postJournalEntry) AND by a deferred constraint trigger below.

CREATE TABLE IF NOT EXISTS gl_journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         UUID NOT NULL REFERENCES gl_books(id),
  entry_date      DATE NOT NULL,
  period          TEXT NOT NULL,               -- 'YYYY-MM', derived from entry_date
  status          gl_entry_status NOT NULL DEFAULT 'draft',
  mode            gl_entry_mode   NOT NULL DEFAULT 'live',
  memo            TEXT,
  -- Provenance: what document drove this entry (the posting-rule input).
  source_type     TEXT,                        -- e.g. 'ap_bill', 'ap_payment', 'manual'
  source_ref      TEXT,                        -- external/source id (idempotency anchor)
  posting_rule_id TEXT,                        -- which PostingRule produced it (if any)
  -- Reversal links (append-only correction model).
  reverses_id     UUID REFERENCES gl_journal_entries(id),
  reversed_by_id  UUID REFERENCES gl_journal_entries(id),
  posted_at       TIMESTAMPTZ,
  posted_by       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gl_je_book_period ON gl_journal_entries (book_id, period);
CREATE INDEX IF NOT EXISTS idx_gl_je_mode        ON gl_journal_entries (mode);
CREATE INDEX IF NOT EXISTS idx_gl_je_source      ON gl_journal_entries (source_type, source_ref);
-- Idempotency: a given source doc maps to at most one live entry per book.
-- (Shadow entries are allowed to coexist, hence the partial unique index.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_je_live_source
  ON gl_journal_entries (book_id, source_type, source_ref)
  WHERE mode = 'live' AND source_type IS NOT NULL AND source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS gl_journal_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      UUID NOT NULL REFERENCES gl_journal_entries(id) ON DELETE CASCADE,
  line_no       INT  NOT NULL,
  account_code  TEXT NOT NULL,                 -- FK-by-(book,code) enforced in code
  -- Exactly one of debit/credit is > 0 on a line; the other is 0.
  debit         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit        NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo          TEXT,
  CHECK (NOT (debit > 0 AND credit > 0)),      -- a line is one-sided
  CHECK (debit > 0 OR credit > 0),             -- a line is non-empty
  UNIQUE (entry_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_gl_lines_entry   ON gl_journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_gl_lines_account ON gl_journal_lines (account_code);

-- ── Balance enforcement trigger (the "MUST balance" invariant) ───────────────
-- Σdebit must equal Σcredit per entry. Implemented as a CONSTRAINT TRIGGER on
-- gl_journal_lines, deferred to COMMIT so a multi-line entry can be inserted
-- line-by-line within a transaction and is only checked once complete. This is
-- the DB-level backstop; postJournalEntry() enforces the same rule in code and
-- inserts header+lines inside one transaction.

CREATE OR REPLACE FUNCTION gl_assert_entry_balanced() RETURNS TRIGGER AS $$
DECLARE
  v_entry_id UUID;
  v_debit    NUMERIC(18,2);
  v_credit   NUMERIC(18,2);
BEGIN
  v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
  -- If the whole entry was deleted, nothing to check.
  IF NOT EXISTS (SELECT 1 FROM gl_journal_entries WHERE id = v_entry_id) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit, v_credit
    FROM gl_journal_lines
   WHERE entry_id = v_entry_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION
      'Journal entry % is unbalanced: debits=% credits=%',
      v_entry_id, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE CONSTRAINT TRIGGER trg_gl_lines_balanced
    AFTER INSERT OR UPDATE OR DELETE ON gl_journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION gl_assert_entry_balanced();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── General ledger / account balances (derived, materialized) ────────────────
-- Running balances per (book, account, period), derived from POSTED live lines.
-- Kept as a table (not just a view) so periodClose can snapshot + lock it, and
-- so shadow entries are excluded by construction. deriveBalances() recomputes it.

CREATE TABLE IF NOT EXISTS gl_account_balances (
  book_id       UUID NOT NULL REFERENCES gl_books(id),
  account_code  TEXT NOT NULL,
  period        TEXT NOT NULL,                 -- 'YYYY-MM'
  debit_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit_total  NUMERIC(18,2) NOT NULL DEFAULT 0,
  -- Net in the account's NORMAL direction (debit-normal: debit-credit; else credit-debit).
  net_balance   NUMERIC(18,2) NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (book_id, account_code, period)
);

-- ── AP bills + payments ──────────────────────────────────────────────────────
-- Vendor invoices and their payments. The GL postings they generate live in
-- gl_journal_entries (linked by source_type/source_ref); these tables are the
-- AP sub-ledger that the state machine drives.

CREATE TABLE IF NOT EXISTS ap_vendors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ap_bills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id         UUID NOT NULL REFERENCES gl_books(id),
  vendor_id       UUID REFERENCES ap_vendors(id),
  bill_number     TEXT,                        -- vendor's invoice number
  status          ap_bill_status NOT NULL DEFAULT 'draft',
  bill_date       DATE,
  due_date        DATE,
  amount          NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  amount_paid     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  -- The kind of expense doc, used to pick the PostingRule. Generic string; the
  -- mapping doc-type → Dr/Cr is DATA (posting-rules config), not hardcoded.
  source_doc_type TEXT NOT NULL DEFAULT 'vendor_invoice',
  memo            TEXT,
  approved_by     UUID,
  approved_at     TIMESTAMPTZ,
  -- Idempotency anchor for intake (vendor invoice number per book).
  source_ref      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_bills_book   ON ap_bills (book_id);
CREATE INDEX IF NOT EXISTS idx_ap_bills_status ON ap_bills (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_bills_source
  ON ap_bills (book_id, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS ap_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID NOT NULL REFERENCES ap_bills(id),
  book_id         UUID NOT NULL REFERENCES gl_books(id),
  amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  payment_date    DATE,
  method          TEXT,                        -- 'check' | 'ach' | 'wire' | …
  reference       TEXT,                        -- check no. / ACH trace
  source_doc_type TEXT NOT NULL DEFAULT 'vendor_payment',
  source_ref      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_payments_bill ON ap_payments (bill_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_payments_source
  ON ap_payments (book_id, source_ref) WHERE source_ref IS NOT NULL;

-- ── Parallel-run reconciliation (shadow vs source-of-record) ─────────────────
-- A row per reconciliation run, recording how the shadow GL compared to the
-- existing system-of-record figures it was run alongside. The report payload
-- (per-account variances) is stored as JSONB for audit.

CREATE TABLE IF NOT EXISTS gl_parallel_run_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       UUID NOT NULL REFERENCES gl_books(id),
  period        TEXT NOT NULL,
  matched       BOOLEAN NOT NULL DEFAULT FALSE,
  variance_count INT NOT NULL DEFAULT 0,
  report        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gl_parallel_book_period
  ON gl_parallel_run_reports (book_id, period);

-- ============================================================================
-- SEED — STANDARD chart of accounts (PLACEHOLDER — replace from TANYA-GL-INTAKE)
-- ============================================================================
-- This is a generic, textbook COA so the foundation is demonstrable end-to-end.
-- It is NOT Frank/GPM's real chart. Every row is flagged is_placeholder = TRUE.
-- The same list lives in config/chart-of-accounts.placeholder.json (the loader
-- can apply it to a book); this seed makes a single demo book usable out of the
-- box. Tanya's intake (Part 2: "Chart of accounts") replaces these rows.
--
-- Seeded only when no entities exist yet, so it never clobbers real data.

DO $$
DECLARE
  v_entity_id UUID;
  v_book_id   UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gl_entities) THEN
    INSERT INTO gl_entities (code, name, kind)
      VALUES ('PLACEHOLDER-ENTITY', 'PLACEHOLDER Entity — replace from TANYA-GL-INTAKE', 'legal_entity')
      RETURNING id INTO v_entity_id;

    INSERT INTO gl_books (entity_id, code, name, coa_source)
      VALUES (v_entity_id, 'PLACEHOLDER-BOOK', 'PLACEHOLDER Book — replace from TANYA-GL-INTAKE', 'PLACEHOLDER')
      RETURNING id INTO v_book_id;

    INSERT INTO gl_chart_of_accounts (book_id, code, name, account_type, normal_side, is_placeholder) VALUES
      -- Assets (debit-normal)
      (v_book_id, '1000', 'Cash — Operating',            'asset',     'debit',  TRUE),
      (v_book_id, '1100', 'Accounts Receivable',          'asset',     'debit',  TRUE),
      (v_book_id, '1200', 'Prepaid Expenses',             'asset',     'debit',  TRUE),
      (v_book_id, '1500', 'Fixed Assets',                 'asset',     'debit',  TRUE),
      (v_book_id, '1600', 'Accumulated Depreciation',     'asset',     'credit', TRUE), -- contra-asset
      -- Liabilities (credit-normal)
      (v_book_id, '2000', 'Accounts Payable',             'liability', 'credit', TRUE),
      (v_book_id, '2100', 'Accrued Liabilities',          'liability', 'credit', TRUE),
      (v_book_id, '2200', 'Security Deposits Held',        'liability', 'credit', TRUE),
      -- Equity (credit-normal)
      (v_book_id, '3000', 'Owner Equity',                 'equity',    'credit', TRUE),
      (v_book_id, '3900', 'Retained Earnings',            'equity',    'credit', TRUE),
      -- Revenue (credit-normal)
      (v_book_id, '4000', 'Rental Income',                'revenue',   'credit', TRUE),
      (v_book_id, '4100', 'Other Income',                 'revenue',   'credit', TRUE),
      -- Expenses (debit-normal)
      (v_book_id, '5000', 'Repairs & Maintenance',        'expense',   'debit',  TRUE),
      (v_book_id, '5100', 'Utilities',                    'expense',   'debit',  TRUE),
      (v_book_id, '5200', 'Property Management Fees',      'expense',   'debit',  TRUE),
      (v_book_id, '5300', 'Insurance',                    'expense',   'debit',  TRUE),
      (v_book_id, '5400', 'Property Taxes',               'expense',   'debit',  TRUE),
      (v_book_id, '5900', 'Depreciation Expense',         'expense',   'debit',  TRUE)
    ON CONFLICT (book_id, code) DO NOTHING;
  END IF;
END $$;
