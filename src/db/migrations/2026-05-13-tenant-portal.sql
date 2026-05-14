-- Tenant Portal migration (2026-05-13)
-- Adds applicant + tenant roles, user_applications join, magic_link_tokens.
-- Makes users.password_hash nullable for magic-link-only accounts.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'applicant';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'tenant';

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

CREATE TABLE IF NOT EXISTS user_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  relationship VARCHAR(50) DEFAULT 'primary',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, application_id)
);
CREATE INDEX IF NOT EXISTS idx_user_applications_user ON user_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_applications_app ON user_applications(application_id);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_hash ON magic_link_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_user ON magic_link_tokens(user_id);
