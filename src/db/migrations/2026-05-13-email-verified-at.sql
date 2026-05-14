-- WARN #2: two-tier scopes — email verification proof (2026-05-13)
-- Adds a persistent timestamp marking when a user's email was proven via magic-link.
-- The /register endpoint issues a token with emailVerified=false; clicking the
-- magic link is what stamps email_verified_at and re-issues emailVerified=true.
-- Existing password-login users are backfilled as verified (they predate WARN #2).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = COALESCE(last_login, created_at)
  WHERE password_hash IS NOT NULL AND email_verified_at IS NULL;
