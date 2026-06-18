-- Outbound transactional-alert SMS log (C7).
--
-- Records every outbound transactional SMS the system sends a resident/applicant
-- (rent due, payment confirmed, maintenance status) via the existing Twilio
-- service. One row per send attempt — successes AND failures — so there is an
-- auditable trail of what we told whom, and so a delivery failure is visible
-- rather than silently swallowed by the fire-and-forget Twilio path.
--
-- PII-minimal by design: the full destination number is NOT stored; only the
-- last 4 digits for log triage. The message body is stored (it is system-
-- generated transactional copy, no free-form PII), alongside the alert kind and
-- a small JSONB of the template variables used to render it.

CREATE TABLE IF NOT EXISTS sms_outbound_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_kind      TEXT NOT NULL CHECK (alert_kind IN (
                    'rent_due', 'payment_confirmed', 'maintenance_status')),
  to_last4        TEXT,                       -- last 4 digits only (triage)
  application_id  UUID,                       -- soft link; no FK so a send can't 500 on a bad id
  property_id     UUID,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  message_sid     TEXT,                       -- Twilio SID when sent
  body            TEXT NOT NULL,              -- system-generated transactional copy
  variables       JSONB NOT NULL DEFAULT '{}'::jsonb,
  error           TEXT,                       -- failure reason when status='failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Powers "what did we send this applicant" lookups and a recent-sends sweep.
CREATE INDEX IF NOT EXISTS idx_sms_outbound_log_application
  ON sms_outbound_log (application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_outbound_log_kind_created
  ON sms_outbound_log (alert_kind, created_at DESC);
