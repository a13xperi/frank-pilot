-- QAP acquisitions layer — candidate projects (Phase 2).
-- Idempotent. Matches the acq_projects block in schema.ts (SCHEMA_SQL bootstrap).
--
-- A prospective LIHTC development evaluated for a 9%/4% credit application,
-- scored against the focused funnel-relevant QAP subset. Demand evidence is
-- joined at score time from the funnel; only the project's own commitments
-- (unit mix, election, services, location) are persisted here.

CREATE TABLE IF NOT EXISTS acq_projects (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  geographic_account  TEXT NOT NULL CHECK (geographic_account IN ('CLARK','WASHOE','OTHER')),
  city                TEXT,
  set_aside           TEXT CHECK (set_aside IN ('NONPROFIT','USDA_RD','TRIBAL','ADDITIONAL')),
  election_kind       TEXT NOT NULL CHECK (election_kind IN ('STD_40_60','STD_20_50','AVERAGE_INCOME')),
  total_units         INTEGER NOT NULL DEFAULT 0 CHECK (total_units >= 0),
  units_30_ami        INTEGER NOT NULL DEFAULT 0 CHECK (units_30_ami >= 0),
  units_50_ami        INTEGER NOT NULL DEFAULT 0 CHECK (units_50_ami >= 0),
  units_60_ami        INTEGER NOT NULL DEFAULT 0 CHECK (units_60_ami >= 0),
  is_qct              BOOLEAN NOT NULL DEFAULT false,
  is_dda              BOOLEAN NOT NULL DEFAULT false,
  resident_services   TEXT[] NOT NULL DEFAULT '{}',
  notes               TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acq_projects_account ON acq_projects(geographic_account);
