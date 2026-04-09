-- Migration 012: Era Campaign tables

CREATE TABLE user_campaigns (
  campaign_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  current_era_index INT NOT NULL DEFAULT 0,
  prestige_points   INT NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE campaign_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES user_campaigns(campaign_id) ON DELETE CASCADE,
  era_id        VARCHAR(32) NOT NULL,
  game_id       UUID REFERENCES games(game_id),
  won           BOOL NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_era UNIQUE (campaign_id, era_id)
);

CREATE INDEX idx_user_campaigns_user_status ON user_campaigns(user_id, status);
CREATE INDEX idx_campaign_entries_campaign   ON campaign_entries(campaign_id);
