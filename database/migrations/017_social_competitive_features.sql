ALTER TABLE friendships
  ADD COLUMN IF NOT EXISTS friend_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_game_together TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_friendships_last_game_together
  ON friendships(last_game_together);