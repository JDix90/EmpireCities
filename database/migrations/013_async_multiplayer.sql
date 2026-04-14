-- Async multiplayer — user preferences, push tokens, and notification tracking.

-- User notification preferences (1:1 with users)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id             UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  push_enabled        BOOLEAN NOT NULL DEFAULT true,
  email_notifications BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Push device tokens (1:many — user can have phone + browser)
CREATE TABLE IF NOT EXISTS push_tokens (
  token_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'web',  -- 'web' | 'ios' | 'android'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

-- Extend existing async_notifications table with delivery status tracking
ALTER TABLE async_notifications
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'sent';
