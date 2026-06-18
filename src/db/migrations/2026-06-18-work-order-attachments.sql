-- Maintenance-tech completion evidence (build-list D2).
--
-- A maintenance technician must attach a geolocated, timestamped photo before
-- a work order can be moved to `completed`. This table is the evidence store:
-- one row per captured photo, carrying the GPS fix and capture time the device
-- reported (navigator.geolocation + the photo's own timestamp), plus who
-- uploaded it.
--
-- `kind` distinguishes the lifecycle moment the photo documents:
--   arrival          — tech on-site, before work (optional proof of presence)
--   departure        — tech leaving site (optional)
--   completion_photo — the GATING photo: at least one of these, WITH a non-null
--                      lat/long, is REQUIRED before status -> completed.
--   other            — any supplemental photo.
--
-- Geolocation columns are nullable at the table level (an arrival snapshot may
-- come from a device that denied location); the *completion* requirement —
-- "≥1 completion_photo with both latitude AND longitude" — is enforced in the
-- service layer (MaintenanceService.complete), not by a table constraint, so a
-- partial arrival capture is still storable.
--
-- `url` is a reference to the stored image (object-storage URL or a data: URL
-- for the demo/PWA path). We store the reference, never the raw bytes, to keep
-- the row light and the audit log PII-minimal.

CREATE TABLE IF NOT EXISTS work_order_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'completion_photo'
                  CHECK (kind IN ('arrival','departure','completion_photo','other')),
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude      DOUBLE PRECISION
                  CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
  longitude     DOUBLE PRECISION
                  CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The completion gate reads "do any completion_photo rows with geo exist for
-- this work order"; the detail view lists all attachments newest-first.
CREATE INDEX IF NOT EXISTS idx_work_order_attachments_wo_kind
  ON work_order_attachments (work_order_id, kind);

-- New audit action for an attachment upload. ADD VALUE IF NOT EXISTS is
-- idempotent (Postgres 12+) and runs in autocommit — the migration runner
-- applies these via psql without an explicit transaction block, which is
-- required because ALTER TYPE ... ADD VALUE cannot run inside one.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'work_order_attachment_added';
