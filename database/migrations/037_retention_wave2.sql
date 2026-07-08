-- ── Retention Wave 2 ──────────────────────────────────────────────────────
-- Streak freezes: a gold-purchasable consumable that bridges exactly one
-- missed day of the daily play streak. Consumption happens lazily inside
-- updateDailyStreak (the sole daily_streak write site) the next time the
-- user finishes a game, so no sweep or scheduled job touches these columns.

ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freezes SMALLINT NOT NULL DEFAULT 0
  CHECK (streak_freezes >= 0);

-- The UTC date the freeze bridged (i.e. the missed day). Lets the UI say
-- "a freeze saved your N-day streak" after the fact; overwritten on each use.
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_freeze_used_on DATE;
