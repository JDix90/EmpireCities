-- ChronoConquest Seed Data
-- Seed 001: Achievements and starter cosmetics

-- ============================================================
-- ACHIEVEMENTS
-- ============================================================
INSERT INTO achievements (achievement_id, name, description, xp_reward) VALUES
  ('first_blood',       'First Blood',          'Win your very first game.',                                   200),
  ('conqueror',         'Conqueror',             'Control all territories on the map.',                         500),
  ('diplomat',          'Diplomat',              'Establish a truce with every other player in a single game.', 150),
  ('card_shark',        'Card Shark',            'Redeem 5 card sets in a single game.',                        250),
  ('blitzkrieg',        'Blitzkrieg',            'Capture 10 or more territories in a single turn.',            300),
  ('ancient_master',    'Ancient Master',        'Win a game on the Ancient World map.',                        400),
  ('medieval_lord',     'Medieval Lord',         'Win a game on the Medieval Era map.',                         400),
  ('age_of_sail',       'Age of Sail',           'Win a game on the Age of Discovery map.',                     400),
  ('iron_cross',        'Iron Cross',            'Win a game on the World War II map.',                         400),
  ('cold_warrior',      'Cold Warrior',          'Win a game on the Cold War map.',                             400),
  ('map_maker',         'Map Maker',             'Publish your first custom map.',                              300),
  ('popular_creator',   'Popular Creator',       'Have your custom map played 100 times.',                      500),
  ('veteran',           'Veteran',               'Complete 50 games.',                                          600),
  ('strategist',        'Grand Strategist',      'Reach MMR 1500 in any era.',                                  750),
  ('fog_master',        'Ghost in the Fog',      'Win a game with Fog of War enabled.',                         350)
ON CONFLICT (achievement_id) DO NOTHING;

-- ============================================================
-- STARTER COSMETICS (free items)
-- ============================================================
INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium) VALUES
  ('default_unit',      'unit_skin',      'Standard Infantry',   'The default unit skin.',           0,   FALSE),
  ('default_dice',      'dice_skin',      'Classic Dice',        'The default dice skin.',           0,   FALSE),
  ('default_banner',    'profile_banner', 'Recruit Banner',      'The default profile banner.',      0,   FALSE)
ON CONFLICT (cosmetic_id) DO NOTHING;

-- ============================================================
-- PREMIUM COSMETICS
-- ============================================================
INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium) VALUES
  ('roman_legionary',   'unit_skin',      'Roman Legionary',     'Ancient Rome era unit skin.',      300, TRUE),
  ('wwii_sherman',      'unit_skin',      'Sherman Tank',        'WWII era armored unit skin.',      350, TRUE),
  ('bone_dice',         'dice_skin',      'Ancient Bone Dice',   'Carved bone dice with unique roll animation.', 200, TRUE),
  ('holo_dice',         'dice_skin',      'Holographic Dice',    'Futuristic holographic dice.',     250, TRUE),
  ('parchment_theme',   'map_theme',      'Parchment & Ink',     'Ancient parchment visual theme for any map.', 600, TRUE),
  ('radar_theme',       'map_theme',      'Radar Screen',        'Cold War radar screen visual theme.', 600, TRUE),
  ('general_banner',    'profile_banner', 'General Banner',      'Gold-trimmed general profile banner.', 150, TRUE),
  ('emperor_title',     'profile_banner', 'Emperor Title',       'Exclusive Emperor profile title.', 200, TRUE)
ON CONFLICT (cosmetic_id) DO NOTHING;
