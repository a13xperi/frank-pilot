-- Units + applicant intent + unit claim (2026-05-14)
-- Adds the unit-claim funnel: individual unit records, applicant intent quiz
-- answers stored on applications, and a soft-reservation claim with expiry.

CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_number VARCHAR(20) NOT NULL,
  bedrooms INT NOT NULL,
  bathrooms NUMERIC(3,1) NOT NULL DEFAULT 1.0,
  sqft INT,
  monthly_rent NUMERIC(10,2) NOT NULL,
  -- available | held | leased | off_market
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  photo_url TEXT,
  description TEXT,
  available_from DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, unit_number)
);

CREATE INDEX IF NOT EXISTS idx_units_property_status ON units(property_id, status);
CREATE INDEX IF NOT EXISTS idx_units_available ON units(status) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_units_bedrooms_rent ON units(bedrooms, monthly_rent);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS intent_bedrooms INT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS intent_budget_min NUMERIC(10,2);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS intent_budget_max NUMERIC(10,2);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS intent_move_in_date DATE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS intent_household_size INT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS claimed_unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_applications_claimed_unit ON applications(claimed_unit_id);
