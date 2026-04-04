-- Async (email) games — optional mode; requires SMTP in production.
ALTER TABLE games ADD COLUMN IF NOT EXISTS async_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS async_turn_deadline TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS async_notifications (
  notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id         UUID NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'your_turn',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel         TEXT NOT NULL DEFAULT 'email'
);

CREATE INDEX IF NOT EXISTS idx_async_notif_user
  ON async_notifications(user_id, sent_at DESC);
