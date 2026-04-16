-- Phase 3: Virality & Social — share tracking, spectator support, activity feed, public replays.

-- ── Game share tracking ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_shares (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id     UUID        NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  platform    VARCHAR(32) NOT NULL DEFAULT 'link',
  share_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_shares_game ON game_shares(game_id);
CREATE INDEX IF NOT EXISTS idx_game_shares_user ON game_shares(user_id);

ALTER TABLE games ADD COLUMN IF NOT EXISTS share_count    INT     NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS is_replay_public BOOLEAN NOT NULL DEFAULT false;

-- ── Activity feed ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity_feed (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_type  VARCHAR(32) NOT NULL,
  event_data  JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_user    ON user_activity_feed(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_feed_created ON user_activity_feed(created_at DESC);

-- ── Spectator count cache (denormalized for live games listing) ────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS spectator_count INT NOT NULL DEFAULT 0;
