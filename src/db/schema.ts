export const SCHEMA_SQL = `
-- ============================================================
-- Frank Pilot: Tenant Onboarding Module — Database Schema
-- Community Development Programs Center of Nevada
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'leasing_agent',
  'senior_manager',
  'regional_manager',
  'asset_manager',
  'system_admin'
);

CREATE TYPE application_status AS ENUM (
  'draft',
  'submitted',
  'screening',
  'screening_passed',
  'screening_failed',
  'tier1_review',
  'tier1_approved',
  'tier1_denied',
  'tier2_review',
  'tier2_approved',
  'tier2_denied',
  'tier3_review',
  'tier3_approved',
  'tier3_denied',
  'lease_generated',
  'onboarded',
  'cancelled'
);

CREATE TYPE screening_result AS ENUM (
  'pass',
  'fail',
  'review_required'
);

CREATE TYPE payment_method AS ENUM (
  'ach',
  'credit_card',
  'debit_card',
  'bank_transfer'
);

CREATE TYPE audit_action AS ENUM (
  'application_created',
  'application_submitted',
  'screening_initiated',
  'screening_completed',
  'background_check_completed',
  'credit_check_completed',
  'compliance_check_completed',
  'tier1_approved',
  'tier1_denied',
  'tier2_approved',
  'tier2_denied',
  'tier3_approved',
  'tier3_denied',
  'lease_generated',
  'payment_setup',
  'auto_pay_enrolled',
  'tenant_onboarded',
  'lease_modification_requested',
  'lease_modification_approved',
  'lease_modification_denied',
  'fraud_flag_raised',
  'user_login',
  'user_logout',
  'permission_change'
);

CREATE TYPE fraud_flag_type AS ENUM (
  'duplicate_ssn',
  'address_fraud',
  'income_mismatch',
  'unusual_approval_speed',
  'manual_override'
);

CREATE TYPE modification_type AS ENUM (
  'rent_increase',
  'tenant_substitution',
  'lease_term_change',
  'pet_policy_change',
  'other'
);

-- ============================================================
-- TABLES
-- ============================================================

-- Users (internal staff)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role user_role NOT NULL,
  property_ids UUID[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Properties
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL DEFAULT 'NV',
  zip VARCHAR(10) NOT NULL,
  unit_count INTEGER NOT NULL,
  ami_area VARCHAR(100) NOT NULL,
  onesite_property_id VARCHAR(100),
  loft_property_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant Applications
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id),
  unit_number VARCHAR(20),

  -- Applicant PII (encrypted at rest)
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  ssn_encrypted TEXT NOT NULL,
  ssn_hash VARCHAR(64) NOT NULL,
  date_of_birth_encrypted TEXT NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),

  -- Current address
  current_address_line1 VARCHAR(255),
  current_address_line2 VARCHAR(255),
  current_city VARCHAR(100),
  current_state VARCHAR(2),
  current_zip VARCHAR(10),

  -- Employment & Income
  employer_name VARCHAR(255),
  employer_phone VARCHAR(20),
  employment_start_date DATE,
  annual_income DECIMAL(12,2),
  income_verified BOOLEAN DEFAULT false,

  -- Rental history
  previous_landlord_name VARCHAR(255),
  previous_landlord_phone VARCHAR(20),
  previous_rental_address VARCHAR(500),
  previous_rental_duration_months INTEGER,

  -- Emergency contact
  emergency_contact_name VARCHAR(255),
  emergency_contact_phone VARCHAR(20),
  emergency_contact_relationship VARCHAR(100),

  -- Lease details
  requested_lease_term_months INTEGER DEFAULT 12,
  requested_rent_amount DECIMAL(10,2),
  requested_move_in_date DATE,

  -- Status
  status application_status DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES users(id),

  -- Screening results
  background_check_result screening_result,
  background_check_details JSONB,
  background_check_completed_at TIMESTAMPTZ,

  credit_check_result screening_result,
  credit_score INTEGER,
  credit_check_details JSONB,
  credit_check_completed_at TIMESTAMPTZ,

  compliance_check_result screening_result,
  compliance_check_details JSONB,
  compliance_check_completed_at TIMESTAMPTZ,

  overall_screening_result screening_result,

  -- Approval chain
  tier1_reviewer_id UUID REFERENCES users(id),
  tier1_decision screening_result,
  tier1_notes TEXT,
  tier1_decided_at TIMESTAMPTZ,

  tier2_reviewer_id UUID REFERENCES users(id),
  tier2_decision screening_result,
  tier2_notes TEXT,
  tier2_decided_at TIMESTAMPTZ,
  tier2_required BOOLEAN DEFAULT false,

  tier3_reviewer_id UUID REFERENCES users(id),
  tier3_decision screening_result,
  tier3_notes TEXT,
  tier3_decided_at TIMESTAMPTZ,
  tier3_required BOOLEAN DEFAULT false,

  -- Integration references
  onesite_lease_id VARCHAR(100),
  loft_tenant_id VARCHAR(100),

  -- Payment
  payment_method payment_method,
  auto_pay_enrolled BOOLEAN DEFAULT false,
  stripe_customer_id VARCHAR(100),
  stripe_payment_method_id VARCHAR(100),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fraud Flags
CREATE TABLE fraud_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  flag_type fraud_flag_type NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lease Modifications (Decision Matrix)
CREATE TABLE lease_modifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  modification_type modification_type NOT NULL,
  description TEXT NOT NULL,

  -- What changed
  original_value TEXT,
  requested_value TEXT,

  -- Approval
  required_role user_role NOT NULL,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  denied_by UUID REFERENCES users(id),
  denied_at TIMESTAMPTZ,
  decision_notes TEXT,

  -- If tenant_substitution, triggers re-screening
  rescreening_required BOOLEAN DEFAULT false,
  rescreening_application_id UUID REFERENCES applications(id),

  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Known Problem Addresses (fraud detection)
CREATE TABLE known_problem_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address_line1 VARCHAR(255) NOT NULL,
  city VARCHAR(100),
  state VARCHAR(2),
  zip VARCHAR(10),
  reason TEXT NOT NULL,
  reported_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log (immutable, append-only)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action audit_action NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_role user_role,
  application_id UUID REFERENCES applications(id),
  resource_type VARCHAR(50),
  resource_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AMI Limits (HUD Area Median Income)
CREATE TABLE ami_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area VARCHAR(100) NOT NULL,
  year INTEGER NOT NULL,
  household_size INTEGER NOT NULL,
  ami_30_percent DECIMAL(10,2),
  ami_50_percent DECIMAL(10,2),
  ami_60_percent DECIMAL(10,2),
  ami_80_percent DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(area, year, household_size)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_property ON applications(property_id);
CREATE INDEX idx_applications_ssn_hash ON applications(ssn_hash);
CREATE INDEX idx_applications_submitted_at ON applications(submitted_at);
CREATE INDEX idx_applications_created_at ON applications(created_at);

CREATE INDEX idx_fraud_flags_application ON fraud_flags(application_id);
CREATE INDEX idx_fraud_flags_unresolved ON fraud_flags(application_id) WHERE resolved = false;

CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_log_application ON audit_log(application_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

CREATE INDEX idx_lease_modifications_application ON lease_modifications(application_id);
CREATE INDEX idx_lease_modifications_status ON lease_modifications(status);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_lease_modifications_updated_at
  BEFORE UPDATE ON lease_modifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Prevent audit log modification (immutability)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
`;

export const DROP_SCHEMA_SQL = `
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS lease_modifications CASCADE;
DROP TABLE IF EXISTS fraud_flags CASCADE;
DROP TABLE IF EXISTS known_problem_addresses CASCADE;
DROP TABLE IF EXISTS ami_limits CASCADE;
DROP TABLE IF EXISTS applications CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS modification_type CASCADE;
DROP TYPE IF EXISTS fraud_flag_type CASCADE;
DROP TYPE IF EXISTS audit_action CASCADE;
DROP TYPE IF EXISTS payment_method CASCADE;
DROP TYPE IF EXISTS screening_result CASCADE;
DROP TYPE IF EXISTS application_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
`;
