-- Phase 1 progression: onboarding, streaks, quests, cosmetic rarity, seasons, gold rewards.

-- ── Onboarding stage ───────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_stage INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prestige        INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS win_streak      INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_streak    INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_played_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date  DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code   VARCHAR(8) UNIQUE;

-- Guests skip onboarding
UPDATE users SET onboarding_stage = 3 WHERE is_guest = true;

-- ── Cosmetic rarity ────────────────────────────────────────────────────────
ALTER TABLE cosmetics ADD COLUMN IF NOT EXISTS rarity VARCHAR(16) NOT NULL DEFAULT 'common';
-- Allowed values: common, uncommon, rare, legendary, mythic

-- Update existing cosmetics with sensible rarity
UPDATE cosmetics SET rarity = 'common'   WHERE price_gems <= 200;
UPDATE cosmetics SET rarity = 'uncommon' WHERE price_gems BETWEEN 201 AND 500;
UPDATE cosmetics SET rarity = 'rare'     WHERE price_gems > 500;

-- ── Onboarding quests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_quests (
  user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  quest_id    VARCHAR(32) NOT NULL,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, quest_id)
);

-- ── Seasons ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  season_id     VARCHAR(16) PRIMARY KEY,
  name          VARCHAR(64) NOT NULL,
  featured_eras TEXT[]      NOT NULL DEFAULT '{}',
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS season_rewards (
  season_id          VARCHAR(16) NOT NULL REFERENCES seasons(season_id),
  user_id            UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  highest_tier       VARCHAR(16) NOT NULL DEFAULT 'bronze',
  reward_cosmetic_id VARCHAR(64),
  claimed_at         TIMESTAMPTZ,
  PRIMARY KEY (season_id, user_id)
);

-- Seed first season
INSERT INTO seasons (season_id, name, featured_eras, started_at, ended_at)
VALUES ('2026_Q2', 'Season 1: Rise of Empires', ARRAY['era_ancient','era_medieval','era_discovery'], '2026-04-01', '2026-06-30')
ON CONFLICT (season_id) DO NOTHING;

-- ── Monthly challenges ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_challenges (
  challenge_id   VARCHAR(32) PRIMARY KEY,
  month          DATE        NOT NULL,
  title          VARCHAR(128) NOT NULL,
  description    TEXT,
  target_count   INT         NOT NULL DEFAULT 1,
  reward_gold    INT         NOT NULL DEFAULT 0,
  reward_xp      INT         NOT NULL DEFAULT 0,
  condition_json JSONB       NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_challenge_progress (
  user_id       UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  challenge_id  VARCHAR(32) NOT NULL REFERENCES monthly_challenges(challenge_id),
  progress      INT         NOT NULL DEFAULT 0,
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, challenge_id)
);

-- ── Referrals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  referee_id  UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE UNIQUE,
  status      VARCHAR(16) NOT NULL DEFAULT 'pending',
  reward_claimed BOOLEAN  NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);

-- ── Player streaks (opponent-pair tracking) ────────────────────────────────
CREATE TABLE IF NOT EXISTS player_streaks (
  user_id_a    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_id_b    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  streak_count INT  NOT NULL DEFAULT 1,
  last_game_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id_a, user_id_b)
);

-- ── Legendary / prestige cosmetics seed ────────────────────────────────────
INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium, rarity)
VALUES
  ('frame_warlord',    'profile_frame', 'Warlord Frame',    'Win 50 ranked games at 1800+ rating',     0, true, 'legendary'),
  ('frame_immortal',   'profile_frame', 'Immortal Frame',   'Achieve a 25-game win streak',            0, true, 'legendary'),
  ('marker_emperor',   'map_marker',    'Emperor Marker',   'Complete all campaign eras without a loss',0, true, 'legendary'),
  ('frame_recruit',    'profile_frame', 'Recruit Frame',    'Enter your first ranked match',           0, true, 'uncommon'),
  ('badge_pioneer',    'profile_banner','Pioneer Badge',    'Refer a friend to Eras of Empire',        0, true, 'uncommon'),
  ('badge_rival',      'profile_banner','Rival Badge',      'Play 5 games in a row with the same opponent', 0, true, 'rare'),
  ('badge_nemesis',    'profile_banner','Nemesis Badge',    'Play 10 games in a row with the same opponent',0, true, 'legendary'),
  ('frame_week_master','profile_frame', 'Week Master Frame','Maintain a 7-day daily streak',           0, true, 'rare'),
  ('frame_month_master','profile_frame','Month Master Frame','Maintain a 28-day daily streak',         0, true, 'legendary'),
  -- Level milestone frames
  ('frame_level_10',   'profile_frame', 'Level 10 Frame',   'Reach level 10',                          0, true, 'uncommon'),
  ('frame_level_20',   'profile_frame', 'Level 20 Frame',   'Reach level 20',                          0, true, 'rare'),
  ('frame_level_30',   'profile_frame', 'Level 30 Frame',   'Reach level 30',                          0, true, 'rare'),
  ('frame_level_40',   'profile_frame', 'Level 40 Frame',   'Reach level 40',                          0, true, 'legendary'),
  ('frame_level_50',   'profile_frame', 'Level 50 Frame',   'Reach level 50',                          0, true, 'legendary'),
  -- Season 1 tier cosmetics
  ('frame_s1_bronze',  'profile_frame', 'S1 Bronze Frame',  'Season 1 Bronze tier reward',             0, true, 'common'),
  ('frame_s1_silver',  'profile_frame', 'S1 Silver Frame',  'Season 1 Silver tier reward',             0, true, 'uncommon'),
  ('frame_s1_gold',    'profile_frame', 'S1 Gold Frame',    'Season 1 Gold tier reward',               0, true, 'rare'),
  ('frame_s1_platinum','profile_frame', 'S1 Platinum Frame','Season 1 Platinum tier reward',           0, true, 'legendary'),
  ('frame_s1_diamond', 'profile_frame', 'S1 Diamond Frame', 'Season 1 Diamond tier reward',            0, true, 'mythic'),
  -- Prestige frames
  ('frame_prestige_1', 'profile_frame', 'Prestige I Frame', 'Reach Prestige 1',                        0, true, 'legendary'),
  ('frame_prestige_2', 'profile_frame', 'Prestige II Frame','Reach Prestige 2',                        0, true, 'mythic')
ON CONFLICT (cosmetic_id) DO NOTHING;

-- ── New achievements for Phase 1 ──────────────────────────────────────────
INSERT INTO achievements (achievement_id, name, description, xp_reward)
VALUES
  ('ranked_warlord',   'Warlord',         'Win 50 ranked games with rating ≥ 1800',  1000),
  ('immortal_streak',  'Immortal Streak', 'Achieve a 25-game win streak',            1000),
  ('perfect_campaign', 'Perfect Campaign','Complete all 6 campaign eras without a loss', 800)
ON CONFLICT (achievement_id) DO NOTHING;
