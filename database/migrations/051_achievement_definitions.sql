-- Every achievement can be earned.
--
-- 1. The definitions. Twenty-three of the twenty-six achievements were only
--    ever inserted by database/seeds/, which a deploy runs only with --seed, so
--    a database seeded before 003 was added has no Iron Brigade row. A
--    user_achievements row references its achievement, and a game's unlocks
--    for every player are written in one transaction: the first win on the
--    American Civil War map rolled back First Blood and everything else that
--    game unlocked, and a one-shot like First Blood could then never be earned,
--    because the next win is no longer the first. Insert them all here, as the
--    seeds have them; a row that already exists is left as it is.
INSERT INTO achievements (achievement_id, name, description, xp_reward) VALUES
  ('first_blood',       'First Blood',      'Win your very first game.',                                       200),
  ('conqueror',         'Conqueror',        'Control all territories on the map.',                             500),
  ('diplomat',          'Diplomat',         'Establish a truce with every other player in a single game.',     150),
  ('card_shark',        'Card Shark',       'Redeem 5 card sets in a single game.',                            250),
  ('blitzkrieg',        'Blitzkrieg',       'Capture 10 or more territories in a single turn.',                300),
  ('ancient_master',    'Ancient Master',   'Win a game on the Ancient World map.',                            400),
  ('medieval_lord',     'Medieval Lord',    'Win a game on the Medieval Era map.',                             400),
  ('age_of_sail',       'Age of Sail',      'Win a game on the Age of Discovery map.',                         400),
  ('iron_cross',        'Iron Cross',       'Win a game on the World War II map.',                             400),
  ('cold_warrior',      'Cold Warrior',     'Win a game on the Cold War map.',                                 400),
  ('map_maker',         'Map Maker',        'Publish your first custom map.',                                  300),
  ('popular_creator',   'Popular Creator',  'Have your custom map played 100 times.',                          500),
  ('veteran',           'Veteran',          'Complete 50 games.',                                              600),
  ('strategist',        'Grand Strategist', 'Reach MMR 1500 in any era.',                                      750),
  ('fog_master',        'Ghost in the Fog', 'Win a game with Fog of War enabled.',                             350),
  ('tutorial_complete', 'First Steps',      'Complete the interactive tutorial.',                              100),
  ('comeback_king',     'Comeback King',    'Win after holding the fewest territories at any point mid-game.', 400),
  ('perfect_defense',   'Perfect Defense',  'Win without losing a single territory after turn 3.',             350),
  ('speed_demon',       'Speed Demon',      'Win a game in 8 turns or fewer.',                                 300),
  ('underdog',          'Underdog Victory', 'Win a ranked game against a player rated 200+ above you.',        500),
  ('first_ranked_win',  'First Ranked Win', 'Win your first ranked match.',                                    250),
  ('ten_streak',        'Unstoppable',      'Achieve a 10-game win streak.',                                   600),
  ('iron_brigade',      'Iron Brigade',     'Win a game on the American Civil War map.',                       400),
  ('ranked_warlord',    'Warlord',          'Win 50 ranked games with rating ≥ 1800',                         1000),
  ('immortal_streak',   'Immortal Streak',  'Achieve a 25-game win streak',                                   1000),
  ('perfect_campaign',  'Perfect Campaign', 'Complete all 6 campaign eras without a loss',                     800)
ON CONFLICT (achievement_id) DO NOTHING;

--    The six medals the unlocks hand out came from the seeds too, and
--    user_cosmetics references its cosmetic the same way, so First Blood
--    failed on its Bronze Commander frame just as surely. Insert them as seed
--    002 has them, earned-only, with the achievement 029 gates each one on.
INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium, earned_only, required_achievement) VALUES
  ('frame_bronze',   'profile_frame', 'Bronze Commander',  'A bronze ring for your first victory.',      0, FALSE, TRUE, 'first_blood'),
  ('frame_silver',   'profile_frame', 'Silver Strategist', 'Earned by reaching 1600 ranked rating.',     0, FALSE, TRUE, NULL),
  ('frame_gold',     'profile_frame', 'Gold Conqueror',    'Awarded for total map domination.',           0, FALSE, TRUE, 'conqueror'),
  ('frame_champion', 'profile_frame', 'Champion Frame',    'A mark of a 10-game win streak.',            0, FALSE, TRUE, 'ten_streak'),
  ('marker_skull',   'map_marker',    'Skull Marker',      'Skull territory markers for speed demons.',   0, FALSE, TRUE, 'speed_demon'),
  ('marker_crown',   'map_marker',    'Crown Marker',      'Crown territory markers for comeback kings.', 0, FALSE, TRUE, 'comeback_king')
ON CONFLICT (cosmetic_id) DO NOTHING;

-- 2. First Steps. The tutorial's game is abandoned when the player leaves its
--    last card, so the game-end check that granted First Steps never ran for a
--    finished lesson. It is now granted when the core lesson is recorded done
--    (POST /api/users/me/tutorial-modules/core); players who already finished
--    it get it here, dated when they did, with its XP as an unlock adds it.
WITH granted AS (
  INSERT INTO user_achievements (user_id, achievement_id, unlocked_at)
  SELECT utm.user_id, 'tutorial_complete', utm.completed_at
  FROM user_tutorial_modules utm
  WHERE utm.module_id = 'core'
  ON CONFLICT (user_id, achievement_id) DO NOTHING
  RETURNING user_id
)
UPDATE users u
SET xp = u.xp + a.xp_reward,
    level = FLOOR(SQRT((u.xp + a.xp_reward) / 250.0))::int + 1
FROM granted g, achievements a
WHERE u.user_id = g.user_id AND a.achievement_id = 'tutorial_complete';

-- 3. Perfect Campaign. An era that is lost is played again, and the retry
--    replaces the lost attempt's entry and its outcome, so nothing recorded
--    whether a campaign had a loss. Count the attempts that did not win their
--    era. A campaign started before this migration has NULL: its losses are
--    unknown, so it cannot be shown to be perfect.
ALTER TABLE user_campaigns ADD COLUMN IF NOT EXISTS failed_era_attempts INT;
ALTER TABLE user_campaigns ALTER COLUMN failed_era_attempts SET DEFAULT 0;
