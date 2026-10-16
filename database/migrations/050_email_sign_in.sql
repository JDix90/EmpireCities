-- Accounts saved with just an email (email_account_save_enabled).
--
-- A guest can save their account with an email address and no password. Such
-- an account has `has_password = false` until the player sets one, and signs in
-- with a one-time link emailed to that address. Every existing account has a
-- password, which is what the default says.

ALTER TABLE users ADD COLUMN IF NOT EXISTS has_password BOOLEAN NOT NULL DEFAULT TRUE;

-- One-time sign-in links (opaque token hashed at rest), like password_reset_tokens.
CREATE TABLE IF NOT EXISTS sign_in_link_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sign_in_link_tokens_lookup
  ON sign_in_link_tokens (token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sign_in_link_tokens_user_pending
  ON sign_in_link_tokens (user_id)
  WHERE used_at IS NULL;
