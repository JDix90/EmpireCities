-- Seed 002: New milestone achievements and cosmetic rewards

INSERT INTO achievements (achievement_id, name, description, xp_reward) VALUES
  ('comeback_king',     'Comeback King',      'Win after holding the fewest territories at any point mid-game.', 400),
  ('perfect_defense',   'Perfect Defense',    'Win without losing a single territory after turn 3.',              350),
  ('speed_demon',       'Speed Demon',        'Win a game in 8 turns or fewer.',                                 300),
  ('underdog',          'Underdog Victory',   'Win a ranked game against a player rated 200+ above you.',        500),
  ('first_ranked_win',  'First Ranked Win',   'Win your first ranked match.',                                    250),
  ('ten_streak',        'Unstoppable',        'Achieve a 10-game win streak.',                                   600)
ON CONFLICT (achievement_id) DO NOTHING;

INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium) VALUES
  ('frame_bronze',   'profile_frame', 'Bronze Commander',     'A bronze ring for your first victory.',       0, FALSE),
  ('frame_silver',   'profile_frame', 'Silver Strategist',    'Earned by reaching 1600 ranked rating.',      0, FALSE),
  ('frame_gold',     'profile_frame', 'Gold Conqueror',       'Awarded for total map domination.',            0, FALSE),
  ('frame_champion', 'profile_frame', 'Champion Frame',       'A mark of a 10-game win streak.',             0, FALSE),
  ('marker_skull',   'map_marker',    'Skull Marker',         'Skull territory markers for speed demons.',    0, FALSE),
  ('marker_crown',   'map_marker',    'Crown Marker',         'Crown territory markers for comeback kings.',  0, FALSE)
ON CONFLICT (cosmetic_id) DO NOTHING;
