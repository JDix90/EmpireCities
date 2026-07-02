-- ── Retention Wave 1 ──────────────────────────────────────────────────────
-- Outbound re-engagement log + consecutive-login counter.
--
-- retention_notifications backs the retention notification worker
-- (backend/src/workers/retentionNotificationWorker.ts). The UNIQUE
-- (user_id, sent_on) constraint is load-bearing: the worker INSERTs a claim
-- row with ON CONFLICT DO NOTHING *before* sending, which gives us both the
-- hard cap of one outbound notification per user per UTC day and race-safety
-- when multiple backend instances run the sweep.

CREATE TABLE IF NOT EXISTS retention_notifications (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  -- 'streak_at_risk' | 'daily_challenge' | 'winback_d2' | 'winback_d7'
  trigger_type    VARCHAR(32) NOT NULL,
  -- 'push' | 'email'
  channel         VARCHAR(16) NOT NULL,
  sent_on         DATE        NOT NULL DEFAULT CURRENT_DATE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'sent' | 'failed'. Failed sends keep their claim row on purpose:
  -- under-sending beats double-sending for re-engagement mail.
  delivery_status VARCHAR(16) NOT NULL DEFAULT 'sent',
  UNIQUE (user_id, sent_on)
);

CREATE INDEX IF NOT EXISTS idx_retention_notif_user ON retention_notifications(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_notif_trigger ON retention_notifications(trigger_type, sent_at DESC);

-- Consecutive-login counter for the escalating daily-login reward.
-- Distinct from users.daily_streak, which counts consecutive days *played*
-- (keyed on last_played_date); this one pairs with last_login_date, the
-- column claimDailyLogin already updates atomically.
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER NOT NULL DEFAULT 0;

-- Backfill: users who claimed yesterday keep a live 1-day streak so their
-- next claim reads day 2 instead of restarting at day 1.
UPDATE users SET login_streak = 1
WHERE login_streak = 0 AND last_login_date = CURRENT_DATE - 1;
