-- ChronoConquest Initial Database Schema
-- Migration 001: Core tables

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  user_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(32) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1,
  xp            INTEGER NOT NULL DEFAULT 0,
  mmr           INTEGER NOT NULL DEFAULT 1000,
  avatar_url    VARCHAR(512),
  is_banned     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REFRESH TOKENS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash  VARCHAR(512) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked     BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================
-- GAMES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS games (
  game_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  map_id          VARCHAR(128) NOT NULL,
  era_id          VARCHAR(64) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'waiting',
  -- status: waiting | in_progress | completed | abandoned
  victory_type    VARCHAR(32) NOT NULL DEFAULT 'domination',
  settings_json   JSONB NOT NULL DEFAULT '{}',
  current_turn    INTEGER NOT NULL DEFAULT 0,
  winner_id       UUID REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ
);

-- ============================================================
-- GAME PLAYERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS game_players (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id       UUID NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(user_id),
  -- null user_id = AI bot
  player_index  INTEGER NOT NULL,
  player_color  VARCHAR(16) NOT NULL,
  is_ai         BOOLEAN NOT NULL DEFAULT FALSE,
  ai_difficulty VARCHAR(16),
  is_eliminated BOOLEAN NOT NULL DEFAULT FALSE,
  final_rank    INTEGER,
  xp_earned     INTEGER NOT NULL DEFAULT 0,
  mmr_change    INTEGER NOT NULL DEFAULT 0,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, player_index)
);

-- ============================================================
-- GAME STATES TABLE (snapshots for async play + crash recovery)
-- ============================================================
CREATE TABLE IF NOT EXISTS game_states (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id       UUID NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  turn_number   INTEGER NOT NULL,
  state_json    JSONB NOT NULL,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_states_game_id ON game_states(game_id);
CREATE INDEX idx_game_states_turn ON game_states(game_id, turn_number DESC);

-- ============================================================
-- ACHIEVEMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS achievements (
  achievement_id  VARCHAR(64) PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  description     TEXT NOT NULL,
  xp_reward       INTEGER NOT NULL DEFAULT 100,
  icon_url        VARCHAR(512)
);

-- ============================================================
-- USER ACHIEVEMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  achievement_id  VARCHAR(64) NOT NULL REFERENCES achievements(achievement_id),
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);

-- ============================================================
-- FRIENDSHIPS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS friendships (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_a   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_id_b   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status      VARCHAR(16) NOT NULL DEFAULT 'pending',
  -- status: pending | accepted | blocked
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id_a, user_id_b),
  CHECK (user_id_a <> user_id_b)
);

-- ============================================================
-- COSMETICS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS cosmetics (
  cosmetic_id   VARCHAR(64) PRIMARY KEY,
  type          VARCHAR(32) NOT NULL,
  -- type: unit_skin | dice_skin | map_theme | profile_banner | emote
  name          VARCHAR(128) NOT NULL,
  description   TEXT,
  asset_url     VARCHAR(512),
  price_gems    INTEGER NOT NULL DEFAULT 0,
  is_premium    BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================
-- USER COSMETICS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  cosmetic_id   VARCHAR(64) NOT NULL REFERENCES cosmetics(cosmetic_id),
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, cosmetic_id)
);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
