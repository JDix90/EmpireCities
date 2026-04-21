-- Speed lookups for in-progress daily games by calendar date (lobby resume, sweeps)

CREATE INDEX IF NOT EXISTS idx_games_settings_daily_challenge_date
  ON games ((settings_json->>'daily_challenge_date'))
  WHERE settings_json->>'daily_challenge_date' IS NOT NULL;
