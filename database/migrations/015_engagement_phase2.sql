-- Phase 2: Engagement & Retention — season lifecycle, monthly challenges, referral redemption, streak multipliers.

-- ── Login history for calendar UI ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_login_history (
  user_id    UUID  NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  login_date DATE  NOT NULL,
  gold_claimed INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, login_date)
);

-- ── Season history ─────────────────────────────────────────────────────────
ALTER TABLE season_rewards ADD COLUMN IF NOT EXISTS final_mu     FLOAT;
ALTER TABLE season_rewards ADD COLUMN IF NOT EXISTS games_played INT NOT NULL DEFAULT 0;

-- ── Referral reward amounts ────────────────────────────────────────────────
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer_gold INT NOT NULL DEFAULT 0;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referee_gold  INT NOT NULL DEFAULT 0;

-- ── Seed monthly challenges for April 2026 ─────────────────────────────────
INSERT INTO monthly_challenges (challenge_id, month, title, description, target_count, reward_gold, reward_xp, condition_json)
VALUES
  ('apr26_win5',        '2026-04-01', 'Five Victories',              'Win 5 games this month',                       5,  100, 200, '{"type":"wins"}'),
  ('apr26_ranked3',     '2026-04-01', 'Ranked Warrior',              'Play 3 ranked games',                          3,  75,  150, '{"type":"ranked_games"}'),
  ('apr26_build10',     '2026-04-01', 'Master Builder',              'Build 10 structures across all games',         10, 50,  100, '{"type":"buildings_built"}'),
  ('apr26_research5',   '2026-04-01', 'Scholar',                     'Research 5 technologies',                       5, 50,  100, '{"type":"techs_researched"}'),
  ('apr26_conquer30',   '2026-04-01', 'Territorial Ambition',        'Conquer 30 territories in any game mode',      30, 60,  120, '{"type":"territories_conquered"}'),
  ('apr26_3era',        '2026-04-01', 'Time Traveler',               'Play games in at least 3 different eras',       3, 80,  160, '{"type":"unique_eras_played"}'),
  ('apr26_winstreak3',  '2026-04-01', 'Hot Streak',                  'Achieve a 3-game win streak',                   3, 50,  100, '{"type":"win_streak"}'),
  ('apr26_daily7',      '2026-04-01', 'Dedicated Commander',         'Log in for 7 consecutive days',                 7, 75,  150, '{"type":"daily_streak"}')
ON CONFLICT (challenge_id) DO NOTHING;

-- ── Seed May 2026 challenges ───────────────────────────────────────────────
INSERT INTO monthly_challenges (challenge_id, month, title, description, target_count, reward_gold, reward_xp, condition_json)
VALUES
  ('may26_win10',       '2026-05-01', 'Decimate',                    'Win 10 games this month',                      10, 200, 400, '{"type":"wins"}'),
  ('may26_ranked5',     '2026-05-01', 'Ranked Veteran',              'Play 5 ranked games',                           5, 100, 200, '{"type":"ranked_games"}'),
  ('may26_build20',     '2026-05-01', 'Architect',                   'Build 20 structures across all games',         20, 100, 200, '{"type":"buildings_built"}'),
  ('may26_research10',  '2026-05-01', 'Renaissance Mind',            'Research 10 technologies',                     10, 100, 200, '{"type":"techs_researched"}'),
  ('may26_conquer50',   '2026-05-01', 'Empire Builder',              'Conquer 50 territories',                       50, 120, 240, '{"type":"territories_conquered"}'),
  ('may26_4era',        '2026-05-01', 'Temporal Explorer',           'Play games in at least 4 different eras',       4, 100, 200, '{"type":"unique_eras_played"}'),
  ('may26_winstreak5',  '2026-05-01', 'On Fire',                     'Achieve a 5-game win streak',                   5, 100, 200, '{"type":"win_streak"}'),
  ('may26_daily14',     '2026-05-01', 'Faithful General',            'Log in for 14 consecutive days',               14, 150, 300, '{"type":"daily_streak"}')
ON CONFLICT (challenge_id) DO NOTHING;
