-- Seed 002: New milestone achievements and cosmetic rewards

INSERT INTO achievements (achievement_id, name, description, xp_reward) VALUES
  ('comeback_king',     'Comeback King',      'Win after holding the fewest territories at any point mid-game.', 400),
  ('perfect_defense',   'Perfect Defense',    'Win without losing a single territory after turn 3.',              350),
  ('speed_demon',       'Speed Demon',        'Win a game in 8 turns or fewer.',                                 300),
  ('underdog',          'Underdog Victory',   'Win a ranked game against a player rated 200+ above you.',        500),
  ('first_ranked_win',  'First Ranked Win',   'Win your first ranked match.',                                    250),
  ('ten_streak',        'Unstoppable',        'Achieve a 10-game win streak.',                                   600)
ON CONFLICT (achievement_id) DO NOTHING;

-- Earned-only, set here rather than left to migration 030: seeds run after
-- migrations, so a row this file inserts never passes through 030's UPDATE.
-- Without the flag the store's free-claim path handed these out (see 043).
INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium, earned_only) VALUES
  ('frame_bronze',   'profile_frame', 'Bronze Commander',     'A bronze ring for your first victory.',       0, FALSE, TRUE),
  ('frame_silver',   'profile_frame', 'Silver Strategist',    'Earned by reaching 1600 ranked rating.',      0, FALSE, TRUE),
  ('frame_gold',     'profile_frame', 'Gold Conqueror',       'Awarded for total map domination.',            0, FALSE, TRUE),
  ('frame_champion', 'profile_frame', 'Champion Frame',       'A mark of a 10-game win streak.',             0, FALSE, TRUE),
  ('marker_skull',   'map_marker',    'Skull Marker',         'Skull territory markers for speed demons.',    0, FALSE, TRUE),
  ('marker_crown',   'map_marker',    'Crown Marker',         'Crown territory markers for comeback kings.',  0, FALSE, TRUE)
ON CONFLICT (cosmetic_id) DO NOTHING;
