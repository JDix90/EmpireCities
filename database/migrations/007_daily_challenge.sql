CREATE TABLE IF NOT EXISTS daily_challenges (
  challenge_date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  era_id         TEXT NOT NULL,
  map_id         TEXT NOT NULL,
  seed           BIGINT NOT NULL,
  player_count   INT NOT NULL DEFAULT 4,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_challenge_entries (
  entry_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_date  DATE NOT NULL REFERENCES daily_challenges(challenge_date) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  turn_count      INT,
  territory_count INT,
  won             BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(challenge_date, user_id)
);
