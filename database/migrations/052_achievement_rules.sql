-- Every achievement says what it takes.
--
-- The definitions as they stand, written over whatever a database holds
-- (migration 051 only added missing rows). Changed from 051:
--
-- - First Blood: granted for the first win, whenever it comes, not only a win
--   in the first game played.
-- - Diplomat: AI players always decline a truce, so it counts the other human
--   players.
-- - The era wins (Ancient Master to Iron Brigade): a game's rules era decides
--   them, and any map can be played under any era's rules, so they name the
--   era, as the lobby does, rather than its map.
-- - Grand Strategist: 1500 is the rating every player starts at, so a first
--   ranked win earned it. It now asks for 1700.
-- - Warlord: it asks for 50 ranked wins in all and a rating of 1800, not 50
--   wins while rated 1800, as it read.
-- - Immortal Streak, Perfect Campaign: worded like the rest.
--
-- Comeback King, Perfect Defense, Underdog Victory and Blitzkrieg keep their
-- words; the code now checks what they say (backend game-engine/achievements).
INSERT INTO achievements (achievement_id, name, description, xp_reward) VALUES
  ('first_blood',       'First Blood',      'Win a game for the first time.',                                    200),
  ('conqueror',         'Conqueror',        'Control all territories on the map.',                               500),
  ('diplomat',          'Diplomat',         'Establish a truce with every other human player in a single game.', 150),
  ('card_shark',        'Card Shark',       'Redeem 5 card sets in a single game.',                              250),
  ('blitzkrieg',        'Blitzkrieg',       'Capture 10 or more territories in a single turn.',                  300),
  ('ancient_master',    'Ancient Master',   'Win a game with Ancient World rules.',                              400),
  ('medieval_lord',     'Medieval Lord',    'Win a game with Medieval Era rules.',                               400),
  ('age_of_sail',       'Age of Sail',      'Win a game with Age of Discovery rules.',                           400),
  ('iron_cross',        'Iron Cross',       'Win a game with World War II rules.',                               400),
  ('cold_warrior',      'Cold Warrior',     'Win a game with Cold War rules.',                                   400),
  ('map_maker',         'Map Maker',        'Publish your first custom map.',                                    300),
  ('popular_creator',   'Popular Creator',  'Have your custom map played 100 times.',                            500),
  ('veteran',           'Veteran',          'Complete 50 games.',                                                600),
  ('strategist',        'Grand Strategist', 'Reach a ranked rating of 1700.',                                    750),
  ('fog_master',        'Ghost in the Fog', 'Win a game with Fog of War enabled.',                               350),
  ('tutorial_complete', 'First Steps',      'Complete the interactive tutorial.',                                100),
  ('comeback_king',     'Comeback King',    'Win after holding the fewest territories at any point mid-game.',   400),
  ('perfect_defense',   'Perfect Defense',  'Win without losing a single territory after turn 3.',               350),
  ('speed_demon',       'Speed Demon',      'Win a game in 8 turns or fewer.',                                   300),
  ('underdog',          'Underdog Victory', 'Win a ranked game against a player rated 200+ above you.',          500),
  ('first_ranked_win',  'First Ranked Win', 'Win your first ranked match.',                                      250),
  ('ten_streak',        'Unstoppable',      'Achieve a 10-game win streak.',                                     600),
  ('iron_brigade',      'Iron Brigade',     'Win a game with American Civil War rules.',                         400),
  ('ranked_warlord',    'Warlord',          'Have 50 ranked wins and a ranked rating of 1800 or more.',         1000),
  ('immortal_streak',   'Immortal Streak',  'Achieve a 25-game win streak.',                                    1000),
  ('perfect_campaign',  'Perfect Campaign', 'Complete all 6 campaign eras without a loss.',                      800)
ON CONFLICT (achievement_id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      xp_reward = EXCLUDED.xp_reward;
