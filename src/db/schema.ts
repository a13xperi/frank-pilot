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
  'system_admin',
  'applicant',
  'tenant'
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
  'lease_signed',
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
  'lease_signed',
  'payment_setup',
  'auto_pay_enrolled',
  'tenant_onboarded',
  'lease_modification_requested',
  'lease_modification_approved',
  'lease_modification_denied',
  'fraud_flag_raised',
  'adverse_action_notice_sent',
  'application_cancelled',
  'income_verified',
  'property_created',
  'property_updated',
  'user_login',
  'user_logout',
  'permission_change',
  'recertification_created',
  'recertification_reminder_sent',
  'recertification_submitted',
  'recertification_approved',
  'recertification_denied',
  'recertification_overdue',
  'market_rent_applied',
  'recertification_reset',
  'ledger_rent_posted',
  'ledger_payment_recorded',
  'ledger_late_fee_assessed',
  'ledger_credit_applied',
  'ledger_entry_reversed',
  'violation_reported',
  'violation_warning_issued',
  'violation_notice_served',
  'violation_resolved',
  'violation_dismissed',
  'eviction_notice_generated',
  'eviction_case_filed',
  'eviction_case_updated',
  'renewal_offered',
  'renewal_accepted',
  'renewal_declined',
  'renewal_counter_offered',
  'renewal_approved',
  'moveout_initiated',
  'moveout_inspection_completed',
  'deposit_disposition_calculated',
  'deposit_refund_sent',
  'collections_referred',
  'inspection_scheduled',
  'inspection_completed',
  'work_order_created',
  'work_order_assigned',
  'work_order_completed'
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

CREATE TYPE property_type AS ENUM ('senior', 'family', 'mixed_use');

CREATE TYPE recertification_type AS ENUM ('annual', 'interim');

CREATE TYPE ledger_entry_type AS ENUM (
  'rent_charge', 'late_fee', 'nsf_fee', 'payment', 'credit',
  'concession', 'adjustment', 'pro_rated_rent', 'extended_guest_fee',
  'early_termination_fee'
);

CREATE TYPE ledger_entry_status AS ENUM ('posted', 'reversed', 'pending');

CREATE TYPE violation_type AS ENUM (
  'nonpayment', 'late_payment_pattern', 'lease_violation',
  'noise_disturbance', 'property_damage', 'unauthorized_occupant',
  'drug_violation', 'criminal_activity', 'unauthorized_pet',
  'health_safety', 'other'
);

CREATE TYPE violation_status AS ENUM (
  'reported', 'warning_issued', 'notice_served',
  'cure_period', 'escalated', 'resolved', 'dismissed'
);

CREATE TYPE notice_type AS ENUM (
  'pay_or_quit_7day', 'perform_or_quit_5day', 'quit_tenancy_at_will_5day',
  'unlawful_detainer_5day', 'no_cause_7day', 'no_cause_30day',
  'nonpayment_cares_30day', 'nuisance_quit_3day', 'cure_or_quit_5day',
  'rent_increase_30day'
);

CREATE TYPE renewal_status AS ENUM (
  'pending_offer', 'offered', 'accepted', 'declined',
  'counter_offered', 'approved', 'expired'
);

CREATE TYPE inspection_type AS ENUM (
  'monthly', 'move_in', 'move_out', 'annual', 'emergency', 'hqs', 'smoke_detector'
);

CREATE TYPE inspection_status AS ENUM (
  'scheduled', 'notice_sent', 'in_progress', 'completed', 'cancelled', 'overdue'
);

CREATE TYPE work_order_status AS ENUM (
  'submitted', 'assigned', 'in_progress', 'completed', 'cancelled', 'on_hold'
);

CREATE TYPE work_order_priority AS ENUM (
  'emergency', 'urgent', 'routine', 'low'
);

CREATE TYPE moveout_status AS ENUM (
  'notice_received', 'pre_inspection_scheduled', 'pre_inspection_complete',
  'vacated', 'final_inspection_complete', 'deposit_calculated',
  'deposit_sent', 'closed', 'collections'
);

CREATE TYPE eviction_case_status AS ENUM (
  'pre_filing', 'notice_served', 'notice_expired',
  'filed', 'hearing_scheduled', 'judgment',
  'writ_issued', 'executed', 'dismissed', 'settled'
);

CREATE TYPE recertification_status AS ENUM (
  'pending',
  'reminder_120',
  'reminder_90',
  'reminder_60',
  'submitted',
  'under_review',
  'approved',
  'denied',
  'overdue',
  'market_rent_applied'
);

-- ============================================================
-- TABLES
-- ============================================================

-- Users (staff + applicants + tenants — magic-link users have null password_hash)
-- email_verified_at is the persistent proof an account holder controls the email:
-- stamped by verifyMagicLink (and by password-login backfill on existing accounts);
-- gates state-changing/PII routes via requireEmailVerified middleware.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role user_role NOT NULL,
  property_ids UUID[] DEFAULT '{}',
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Magic-link tokens for passwordless tenant/applicant login
CREATE TABLE magic_link_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_magic_link_tokens_hash ON magic_link_tokens(token_hash);
CREATE INDEX idx_magic_link_tokens_user ON magic_link_tokens(user_id);

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

  -- Extended property profile (Module 15)
  phone VARCHAR(20),
  email VARCHAR(255),
  property_manager VARCHAR(200),
  property_type property_type DEFAULT 'family',
  lihtc_type VARCHAR(50),
  ami_set_aside VARCHAR(100),
  compliance_period_start DATE,
  compliance_period_end DATE,
  has_lura BOOLEAN DEFAULT false,
  has_mortgage BOOLEAN DEFAULT false,
  jurisdiction VARCHAR(100),
  unit_mix JSONB DEFAULT '{}',
  rent_schedule JSONB DEFAULT '{}',
  total_vacancy INTEGER DEFAULT 0,
  waiting_list_enabled BOOLEAN DEFAULT false,

  -- QAP acquisitions layer (2026-05-22): location scoring (§7.3.1) and the
  -- 30% basis boost (§11) for HUD Qualified Census Tracts / Difficult
  -- Development Areas. See migration 2026-05-22-property-qct.sql.
  census_tract VARCHAR(20),
  is_qct BOOLEAN NOT NULL DEFAULT false,
  is_dda BOOLEAN NOT NULL DEFAULT false,

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
  -- Required at submit-time (validated in ApplicationService.create), but
  -- NULL during the draft phase: applicant self-serve creates a draft row
  -- from /intent and /claim-unit/:id before SSN/DOB are collected.
  ssn_encrypted TEXT,
  ssn_hash VARCHAR(64),
  date_of_birth_encrypted TEXT,
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
  household_size INTEGER DEFAULT 1,
  income_verified BOOLEAN DEFAULT false,
  income_verified_by UUID REFERENCES users(id),
  income_verified_at TIMESTAMPTZ,

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
  lease_start_date DATE,
  lease_end_date DATE,
  security_deposit_amount DECIMAL(10,2),

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

  -- Applicant intent (filled by the intent quiz before unit pick)
  intent_bedrooms INTEGER,
  intent_budget_min DECIMAL(10,2),
  intent_budget_max DECIMAL(10,2),
  intent_move_in_date DATE,
  intent_household_size INTEGER,

  -- W0 AMI pre-qualifier (computed in StepIntent from income + HH size)
  gross_annual_income DECIMAL(12,2),
  qualifying_ami_tier VARCHAR(3),
  qualifying_household_size INTEGER,
  qualifying_ami_calculated_at TIMESTAMPTZ,

  -- Unit claim (soft reservation while applicant completes the application)
  claimed_unit_id UUID,
  claim_expires_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual units, generated from properties.unit_mix. Status drives the
-- unit-picker funnel: available → held (during applicant claim) → leased.
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_number VARCHAR(20) NOT NULL,
  bedrooms INTEGER NOT NULL,
  bathrooms NUMERIC(3,1) NOT NULL DEFAULT 1.0,
  sqft INTEGER,
  monthly_rent NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  -- Held-claim expiry; lazy-expired in GET /applicants/units.
  claim_expires_at TIMESTAMPTZ,
  photo_url TEXT,
  description TEXT,
  available_from DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, unit_number)
);

-- Units indexes (mirrors 2026-05-14-units-and-intent.sql migration)
CREATE INDEX idx_units_property_status ON units(property_id, status);
CREATE INDEX idx_units_available ON units(status) WHERE status = 'available';
CREATE INDEX idx_units_bedrooms_rent ON units(bedrooms, monthly_rent);
-- Stale-hold scan support for the lazy-expire path in GET /applicants/units.
CREATE INDEX idx_units_held_expires ON units(claim_expires_at) WHERE status = 'held';

-- FK from applications.claimed_unit_id → units(id). Declared post-units because
-- the applications table is created earlier in this bootstrap SQL.
ALTER TABLE applications
  ADD CONSTRAINT applications_claimed_unit_id_fkey
  FOREIGN KEY (claimed_unit_id) REFERENCES units(id) ON DELETE SET NULL;

CREATE INDEX idx_applications_claimed_unit ON applications(claimed_unit_id);

-- Position-aware waitlist (gpmglv-gap wedge #5).
-- One row per (property, bedroom_count, user). Position is derived from
-- created_at ordering at query time. notified_position_at /
-- last_notified_position snapshot what we last told the applicant so the
-- API can compute monthly "moved up N spots" movement without storing a
-- per-day position history.
CREATE TABLE waitlist_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  bedroom_count SMALLINT NOT NULL,
  applicant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_position_at TIMESTAMPTZ,
  last_notified_position SMALLINT,
  UNIQUE (property_id, bedroom_count, applicant_user_id)
);
-- Hot query path: rank by created_at within a (property, bedroom_count) lane.
CREATE INDEX idx_waitlist_entries_lane_created
  ON waitlist_entries(property_id, bedroom_count, created_at);
CREATE INDEX idx_waitlist_entries_user
  ON waitlist_entries(applicant_user_id);

-- BP-02 Compliance Tape — append-only hash-chained audit ledger.
-- One row per regulated event; UPDATE/DELETE/TRUNCATE rejected by trigger.
-- Sequence is monotonic per scope (applicant_id, or global when NULL).
-- Hash chain: each row's prev_hash = previous row's entry_hash; entry_hash =
-- SHA-256(sequence || prev_hash || canonicalJson(payload) || created_at).
-- See docs/bp-02-contracts.md and src/modules/tape/{types,hashing,api-contract}.ts.
CREATE TABLE compliance_tape (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence BIGINT NOT NULL CHECK (sequence >= 1),
  kind TEXT NOT NULL,
  citation TEXT NOT NULL,
  applicant_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL,
  prev_hash BYTEA NOT NULL CHECK (octet_length(prev_hash) = 32),
  entry_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(entry_hash) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT NULL
);

-- Per-scope monotonic sequence: applicant_id NULL collapses to a sentinel
-- UUID so the same index enforces "no gaps, no dupes per scope" for both
-- the per-applicant chain and the global chain.
CREATE UNIQUE INDEX idx_compliance_tape_scope_sequence
  ON compliance_tape (
    COALESCE(applicant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sequence
  );

CREATE INDEX idx_compliance_tape_applicant_sequence
  ON compliance_tape (applicant_id, sequence)
  WHERE applicant_id IS NOT NULL;

-- Backs the repository's ON CONFLICT (kind, session_id) idempotency clause.
-- Non-partial: PostgreSQL's default NULL semantics treat each NULL as distinct,
-- so stamps without a session_id remain insertable as separate rows (no
-- idempotency unless caller passes a session_id). A partial index would force
-- ON CONFLICT to repeat the WHERE predicate; non-partial avoids that.
CREATE UNIQUE INDEX idx_compliance_tape_kind_session
  ON compliance_tape (kind, session_id);

CREATE OR REPLACE FUNCTION compliance_tape_reject_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
AS $func$
BEGIN
  RAISE EXCEPTION 'compliance_tape is append-only (% blocked)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$func$;

DROP TRIGGER IF EXISTS compliance_tape_no_update ON compliance_tape;
CREATE TRIGGER compliance_tape_no_update
  BEFORE UPDATE OR DELETE ON compliance_tape
  FOR EACH ROW
  EXECUTE FUNCTION compliance_tape_reject_mutation();

DROP TRIGGER IF EXISTS compliance_tape_no_truncate ON compliance_tape;
CREATE TRIGGER compliance_tape_no_truncate
  BEFORE TRUNCATE ON compliance_tape
  FOR EACH STATEMENT
  EXECUTE FUNCTION compliance_tape_reject_mutation();

-- Tenant/applicant join to applications (multiple users per application: primary, co-applicant, household member)
CREATE TABLE user_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  relationship VARCHAR(50) DEFAULT 'primary',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, application_id)
);
CREATE INDEX idx_user_applications_user ON user_applications(user_id);
CREATE INDEX idx_user_applications_app ON user_applications(application_id);

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(address_line1, city, state, zip)
);

-- FCRA Adverse Action Notices (15 U.S.C. § 1681m)
-- Required whenever adverse action is taken based on consumer report information.
-- Records are immutable; use resend to create a new record instead of updating.
CREATE TABLE adverse_action_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  sent_by UUID REFERENCES users(id),
  reason VARCHAR(100) NOT NULL,       -- e.g. 'screening_failed', 'tier1_denied'
  reason_detail TEXT,                 -- human-readable denial reason from results
  notice_text TEXT NOT NULL,          -- full FCRA-compliant notice text (PII-safe for log)
  sent_via VARCHAR(50) DEFAULT 'sms',
  sms_delivered BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inspections (Module 10)
CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id),
  application_id UUID REFERENCES applications(id),
  unit_number VARCHAR(20),
  inspection_type inspection_type NOT NULL,
  status inspection_status NOT NULL DEFAULT 'scheduled',
  scheduled_date DATE NOT NULL,
  completed_date DATE,
  inspector_id UUID REFERENCES users(id),
  notice_sent_at TIMESTAMPTZ,
  notes TEXT,
  room_details JSONB DEFAULT '{}',
  photos JSONB DEFAULT '[]',
  appliance_inventory JSONB DEFAULT '{}',
  smoke_detector_ok BOOLEAN,
  hqs_compliant BOOLEAN,
  follow_up_required BOOLEAN DEFAULT false,
  follow_up_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Orders (Module 10)
CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id),
  application_id UUID REFERENCES applications(id),
  unit_number VARCHAR(20),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  priority work_order_priority NOT NULL DEFAULT 'routine',
  status work_order_status NOT NULL DEFAULT 'submitted',
  category VARCHAR(100),
  is_emergency BOOLEAN DEFAULT false,
  submitted_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  completion_notes TEXT,
  photos JSONB DEFAULT '[]',
  estimated_cost DECIMAL(10,2),
  actual_cost DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lease Renewals (Module 8)
CREATE TABLE lease_renewals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  status renewal_status NOT NULL DEFAULT 'pending_offer',
  current_rent DECIMAL(10,2) NOT NULL,
  proposed_rent DECIMAL(10,2) NOT NULL,
  rent_change_amount DECIMAL(10,2),
  proposed_term_months INTEGER DEFAULT 12,
  tenant_response VARCHAR(20),
  counter_rent DECIMAL(10,2),
  counter_term_months INTEGER,
  offered_at TIMESTAMPTZ,
  response_at TIMESTAMPTZ,
  response_deadline DATE,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  reminder_60_sent_at TIMESTAMPTZ,
  reminder_30_sent_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Move-Outs (Module 8)
CREATE TABLE move_outs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  status moveout_status NOT NULL DEFAULT 'notice_received',
  notice_date DATE NOT NULL,
  expected_vacate_date DATE NOT NULL,
  actual_vacate_date DATE,
  forwarding_address TEXT,
  pre_inspection_date DATE,
  pre_inspection_notes TEXT,
  final_inspection_date DATE,
  final_inspection_notes TEXT,
  deposit_amount DECIMAL(10,2),
  deductions_total DECIMAL(10,2),
  deductions_detail JSONB DEFAULT '{}',
  refund_amount DECIMAL(10,2),
  deposit_disposition_date DATE,
  deposit_deadline DATE,
  unpaid_rent_balance DECIMAL(10,2),
  collections_referred_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lease Violations (Module 9: Eviction & Violation Workflow)
CREATE TABLE lease_violations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  violation_type violation_type NOT NULL,
  status violation_status NOT NULL DEFAULT 'reported',
  description TEXT NOT NULL,
  occurred_at DATE NOT NULL,
  reported_by UUID REFERENCES users(id),
  evidence_notes TEXT,
  warning_issued_at TIMESTAMPTZ,
  notice_served_at TIMESTAMPTZ,
  cure_deadline DATE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_notes TEXT,
  is_material_breach BOOLEAN DEFAULT false,
  vawa_flagged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Eviction Notices (NV Regional Justice Center form templates)
CREATE TABLE eviction_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  violation_id UUID REFERENCES lease_violations(id),
  notice_type notice_type NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  tenant_name VARCHAR(200) NOT NULL,
  property_address TEXT NOT NULL,
  unit_number VARCHAR(20),
  amount_owed DECIMAL(12,2),
  notice_text TEXT NOT NULL,
  serve_date DATE,
  expiration_date DATE,
  served_by UUID REFERENCES users(id),
  certificate_of_mailing BOOLEAN DEFAULT false,
  cares_act_applicable BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Eviction Cases (court filing and execution tracking)
CREATE TABLE eviction_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  notice_id UUID REFERENCES eviction_notices(id),
  status eviction_case_status NOT NULL DEFAULT 'pre_filing',
  case_number VARCHAR(50),
  jurisdiction VARCHAR(100),
  filing_date DATE,
  hearing_date DATE,
  judgment_date DATE,
  judgment_amount DECIMAL(12,2),
  writ_issued_date DATE,
  execution_date DATE,
  constable_instructions TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant Ledger (Module 6: Double-entry financial tracking)
CREATE TABLE tenant_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  entry_type ledger_entry_type NOT NULL,
  status ledger_entry_status NOT NULL DEFAULT 'posted',
  description TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL DEFAULT 0,
  billing_period VARCHAR(7),
  due_date DATE,
  reference_id VARCHAR(100),
  posted_by UUID REFERENCES users(id),
  reversed_by_id UUID REFERENCES tenant_ledger(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recertifications (Module 7: Annual/Interim HUD recertification tracking)
CREATE TABLE recertifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  tenant_name VARCHAR(200) NOT NULL,

  -- Type and status
  type recertification_type NOT NULL DEFAULT 'annual',
  status recertification_status NOT NULL DEFAULT 'pending',

  -- HUD deadlines
  anniversary_date DATE NOT NULL,
  cutoff_date DATE NOT NULL,         -- 10th day of 11th month
  tracs_deadline DATE NOT NULL,      -- anniversary + 15 months

  -- Reminder tracking
  reminder_120_sent_at TIMESTAMPTZ,
  reminder_90_sent_at TIMESTAMPTZ,
  reminder_60_sent_at TIMESTAMPTZ,

  -- Submission
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES users(id),

  -- Review
  reviewer_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  review_decision screening_result,

  -- Income
  previous_annual_income DECIMAL(12,2),
  new_annual_income DECIMAL(12,2),
  rent_adjustment DECIMAL(10,2),

  -- Market rent enforcement
  market_rent_applied_at TIMESTAMPTZ,
  market_rent_amount DECIMAL(10,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Application Messages (Module 16: My Application + two-way staff/applicant thread)
CREATE TABLE application_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('staff','applicant','tenant')),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX idx_application_messages_app_created
  ON application_messages(application_id, created_at DESC);
CREATE INDEX idx_application_messages_sender
  ON application_messages(sender_user_id);

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

CREATE INDEX idx_inspections_property ON inspections(property_id);
CREATE INDEX idx_inspections_status ON inspections(status);
CREATE INDEX idx_inspections_scheduled ON inspections(scheduled_date);
CREATE INDEX idx_work_orders_property ON work_orders(property_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_orders_priority ON work_orders(priority);

CREATE INDEX idx_renewals_application ON lease_renewals(application_id);
CREATE INDEX idx_renewals_status ON lease_renewals(status);
CREATE INDEX idx_moveouts_application ON move_outs(application_id);
CREATE INDEX idx_moveouts_status ON move_outs(status);
CREATE INDEX idx_moveouts_deadline ON move_outs(deposit_deadline);

CREATE INDEX idx_violations_application ON lease_violations(application_id);
CREATE INDEX idx_violations_property ON lease_violations(property_id);
CREATE INDEX idx_violations_status ON lease_violations(status);
CREATE INDEX idx_violations_type ON lease_violations(violation_type);
CREATE INDEX idx_eviction_notices_application ON eviction_notices(application_id);
CREATE INDEX idx_eviction_notices_type ON eviction_notices(notice_type);
CREATE INDEX idx_eviction_cases_application ON eviction_cases(application_id);
CREATE INDEX idx_eviction_cases_status ON eviction_cases(status);

CREATE INDEX idx_ledger_application ON tenant_ledger(application_id);
CREATE INDEX idx_ledger_property ON tenant_ledger(property_id);
CREATE INDEX idx_ledger_billing_period ON tenant_ledger(billing_period);
CREATE INDEX idx_ledger_entry_type ON tenant_ledger(entry_type);
CREATE INDEX idx_ledger_due_date ON tenant_ledger(due_date);

CREATE INDEX idx_recertifications_application ON recertifications(application_id);
CREATE INDEX idx_recertifications_property ON recertifications(property_id);
CREATE INDEX idx_recertifications_status ON recertifications(status);
CREATE INDEX idx_recertifications_anniversary ON recertifications(anniversary_date);
CREATE INDEX idx_recertifications_cutoff ON recertifications(cutoff_date);

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

CREATE TRIGGER trg_recertifications_updated_at
  BEFORE UPDATE ON recertifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_renewals_updated_at
  BEFORE UPDATE ON lease_renewals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_moveouts_updated_at
  BEFORE UPDATE ON move_outs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_violations_updated_at
  BEFORE UPDATE ON lease_violations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_eviction_cases_updated_at
  BEFORE UPDATE ON eviction_cases
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

-- ============================================================
-- BP-08 — Stripe PaymentIntents wiring
-- See docs/bp-08-stripe-spec.md and
-- src/db/migrations/2026-05-25-bp08-payment-tables.sql for the rationale.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_idempotency (
  idempotency_key   TEXT PRIMARY KEY,
  application_id    UUID NOT NULL,
  attempt_n         INT  NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  payment_intent_id TEXT,
  client_secret     TEXT,
  amount_cents      INT,
  currency          CHAR(3),
  last_event_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_idempotency_app_attempt
  ON payment_idempotency (application_id, attempt_n);

CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id       TEXT PRIMARY KEY,
  event_type     TEXT NOT NULL,
  application_id UUID,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_webhook_dlq (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT UNIQUE NOT NULL,
  event_type      TEXT NOT NULL,
  raw_payload     JSONB NOT NULL,
  error_message   TEXT,
  attempt_count   INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lease e-signature (native). One tenant signature row per application; the
-- executed PDF + a sha256 hash give tamper-evidence, and the compliance tape
-- (LEASE_EXECUTED stamp) is the legally-meaningful audit record. ESIGN/UETA:
-- consent_at captures the "agree to sign electronically" affirmation.
CREATE TABLE IF NOT EXISTS lease_signatures (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id      UUID NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  signer_user_id      UUID NOT NULL REFERENCES users(id),
  signer_name         TEXT NOT NULL,
  signature_image     TEXT NOT NULL,
  signed_document_url TEXT,
  document_hash       TEXT,
  signer_ip           INET,
  consent_at          TIMESTAMPTZ NOT NULL,
  signed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- QAP acquisitions layer — candidate projects (Phase 2). A prospective LIHTC
-- development being evaluated for a 9%/4% credit application. Scored against
-- the focused, funnel-relevant QAP subset (§7.4.1 low-rent, §7.4.2 low-income,
-- §7.4.3 resident services, §7.3.1 location/basis-boost) with the unit mix and
-- election the project commits to. Demand evidence is joined at score time from
-- the funnel (see demand-service.ts), not stored here.
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
`;

export const DROP_SCHEMA_SQL = `
DROP TABLE IF EXISTS acq_projects CASCADE;
DROP TABLE IF EXISTS lease_signatures CASCADE;
DROP TABLE IF EXISTS stripe_webhook_dlq CASCADE;
DROP TABLE IF EXISTS stripe_processed_events CASCADE;
DROP TABLE IF EXISTS payment_idempotency CASCADE;
DROP TABLE IF EXISTS application_messages CASCADE;
DROP TABLE IF EXISTS work_orders CASCADE;
DROP TABLE IF EXISTS inspections CASCADE;
DROP TABLE IF EXISTS move_outs CASCADE;
DROP TABLE IF EXISTS lease_renewals CASCADE;
DROP TABLE IF EXISTS eviction_cases CASCADE;
DROP TABLE IF EXISTS eviction_notices CASCADE;
DROP TABLE IF EXISTS lease_violations CASCADE;
DROP TABLE IF EXISTS tenant_ledger CASCADE;
DROP TABLE IF EXISTS recertifications CASCADE;
DROP TABLE IF EXISTS adverse_action_notices CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS lease_modifications CASCADE;
DROP TABLE IF EXISTS fraud_flags CASCADE;
DROP TABLE IF EXISTS compliance_tape CASCADE;
DROP FUNCTION IF EXISTS compliance_tape_reject_mutation() CASCADE;
DROP TABLE IF EXISTS waitlist_entries CASCADE;
DROP TABLE IF EXISTS known_problem_addresses CASCADE;
DROP TABLE IF EXISTS ami_limits CASCADE;
DROP TABLE IF EXISTS applications CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS work_order_priority CASCADE;
DROP TYPE IF EXISTS work_order_status CASCADE;
DROP TYPE IF EXISTS inspection_status CASCADE;
DROP TYPE IF EXISTS inspection_type CASCADE;
DROP TYPE IF EXISTS moveout_status CASCADE;
DROP TYPE IF EXISTS renewal_status CASCADE;
DROP TYPE IF EXISTS eviction_case_status CASCADE;
DROP TYPE IF EXISTS notice_type CASCADE;
DROP TYPE IF EXISTS violation_status CASCADE;
DROP TYPE IF EXISTS violation_type CASCADE;
DROP TYPE IF EXISTS ledger_entry_status CASCADE;
DROP TYPE IF EXISTS ledger_entry_type CASCADE;
DROP TYPE IF EXISTS recertification_status CASCADE;
DROP TYPE IF EXISTS recertification_type CASCADE;
DROP TYPE IF EXISTS property_type CASCADE;
DROP TYPE IF EXISTS modification_type CASCADE;
DROP TYPE IF EXISTS fraud_flag_type CASCADE;
DROP TYPE IF EXISTS audit_action CASCADE;
DROP TYPE IF EXISTS payment_method CASCADE;
DROP TYPE IF EXISTS screening_result CASCADE;
DROP TYPE IF EXISTS application_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
`;
