-- Migration 018: Campaign Paths
-- Adds path selection and narrative carry-forward to the campaign system.

ALTER TABLE user_campaigns
  ADD COLUMN IF NOT EXISTS path_id        VARCHAR(32)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS path_carry     JSONB         NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS path_narrative JSONB         NOT NULL DEFAULT '{}';

-- path_id: 'blood_empire' | 'revolutionary_flame' | 'last_defenders' | NULL (classic mode)
-- path_carry: numeric carry stats, e.g. { "survivor_bonus": 4, "revolutionary_spirit": 3 }
-- path_narrative: era outcome log, e.g. { "era_0_outcome": "won", "era_1_outcome": "lost" }

ALTER TABLE campaign_entries
  ADD COLUMN IF NOT EXISTS faction_id      VARCHAR(32)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS map_id_override VARCHAR(64)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS carry_snapshot  JSONB        NOT NULL DEFAULT '{}';

-- faction_id: the locked faction the human player used for this era
-- map_id_override: set when a special map (acw, risorgimento) replaces the era default
-- carry_snapshot: path_carry state at the start of this era (for per-era display)

CREATE INDEX IF NOT EXISTS idx_user_campaigns_path
  ON user_campaigns(path_id)
  WHERE path_id IS NOT NULL;
