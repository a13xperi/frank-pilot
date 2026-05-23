-- BP-08 Stripe PaymentIntents — server-side wiring tables.
--
-- See docs/bp-08-stripe-spec.md for the contract these tables back. Three
-- concerns, three tables:
--
--   1. payment_idempotency       — caller-side replay protection. One row per
--                                  (applicationId, attemptN) so a client that
--                                  retries POST /api/payments/intents within a
--                                  single attempt gets the cached client_secret
--                                  back instead of a new PaymentIntent. After
--                                  success/failure the row blocks reuse and the
--                                  client must bump attemptN.
--
--   2. stripe_processed_events   — webhook-side dedup. Stripe retries with the
--                                  same event_id on delivery timeout; this
--                                  table makes the handler idempotent on top of
--                                  the Stripe header idempotency layer.
--
--   3. stripe_webhook_dlq        — handler error recovery. If processing a
--                                  successfully-verified webhook throws, we
--                                  park the raw payload here and return 200 to
--                                  Stripe so it doesn't retry the same broken
--                                  event forever. Manual replay via
--                                  `stripe events resend evt_…` until volume
--                                  justifies an automated DLQ replayer.

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
