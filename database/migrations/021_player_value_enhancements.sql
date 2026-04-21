-- Wave enhancements: post-match coaching, adaptive learning, ranked integrity,
-- replay highlights, weekly seeded challenges, and QoL preferences.

CREATE TABLE IF NOT EXISTS match_insight_reports (
  game_id UUID PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  insights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_replay_highlights (
  game_id UUID PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  highlights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_skill_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_qol_settings (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  animation_speed_multiplier REAL NOT NULL DEFAULT 1.0,
  quick_combat_enabled BOOLEAN NOT NULL DEFAULT false,
  confirm_end_turn BOOLEAN NOT NULL DEFAULT true,
  undo_window_seconds INTEGER NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ranked_placement_progress (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  season_id VARCHAR(32) NOT NULL DEFAULT '2026_Q2',
  placement_matches_played INTEGER NOT NULL DEFAULT 0,
  provisional BOOLEAN NOT NULL DEFAULT true,
  smurf_risk_score REAL NOT NULL DEFAULT 0,
  stall_penalties INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_seeded_challenges (
  challenge_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_start_date DATE NOT NULL UNIQUE,
  seed INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS weekly_seeded_submissions (
  submission_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES weekly_seeded_challenges(challenge_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  efficiency_score REAL NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_seeded_submissions_challenge
  ON weekly_seeded_submissions(challenge_id, score DESC, efficiency_score DESC, duration_seconds ASC);
