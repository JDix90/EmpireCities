-- Era sets: twelve cosmetics in three themed sets, sold with store_v2_enabled
-- on. cosmetic_set names an item's set; the store lists and sells items with
-- one only while the flag is on, so with it off the catalog is the old list.
--
-- Priced on the store's ladder: common 200-250 gold, uncommon 450, rare 1,000.
-- Legendary and mythic are never sold. How each item is drawn lives in
-- @borderfall/shared (COSMETIC_LOOKS); a test holds the catalog to it.
ALTER TABLE cosmetics ADD COLUMN IF NOT EXISTS cosmetic_set VARCHAR(32);

INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium, rarity, earned_only, cosmetic_set) VALUES
  -- Imperium: the ancient world.
  ('frame_imperium_laurel',    'profile_frame',  'Laurel Wreath',     'A victor''s wreath of olive and gold.',        1000, TRUE, 'rare',     FALSE, 'imperium'),
  ('banner_imperium_standard', 'profile_banner', 'Legate''s Standard', 'The standard a legion marched behind.',       250,  TRUE, 'common',   FALSE, 'imperium'),
  ('dice_imperium_marble',     'dice_skin',      'Marble Dice',       'Dice cut from veined white marble.',           250,  TRUE, 'common',   FALSE, 'imperium'),
  ('marker_imperium_temple',   'map_marker',     'Temple Marker',     'A temple raised over your capital.',           450,  TRUE, 'uncommon', FALSE, 'imperium'),
  -- Navigator: the age of sail.
  ('frame_navigator_compass',  'profile_frame',  'Brass Compass',     'A ring of polished ship''s brass.',             450,  TRUE, 'uncommon', FALSE, 'navigator'),
  ('banner_navigator_pennant', 'profile_banner', 'Admiral''s Pennant', 'An admiral''s pennant, anchor and all.',        250,  TRUE, 'common',   FALSE, 'navigator'),
  ('dice_navigator_teak',      'dice_skin',      'Teak Dice',         'Dice turned from a ship''s teak deck.',         450,  TRUE, 'uncommon', FALSE, 'navigator'),
  ('marker_navigator_rose',    'map_marker',     'Compass Rose',      'A compass rose to steer by, on your capital.', 200,  TRUE, 'common',   FALSE, 'navigator'),
  -- Orbital: the space age.
  ('frame_orbital_ring',       'profile_frame',  'Orbit Ring',        'A ring with a satellite forever circling it.', 1000, TRUE, 'rare',     FALSE, 'orbital'),
  ('banner_orbital_patch',     'profile_banner', 'Mission Patch',     'A mission patch, rocket and all.',             450,  TRUE, 'uncommon', FALSE, 'orbital'),
  ('dice_orbital_starfield',   'dice_skin',      'Starfield Dice',    'Dice of deep space, scattered with stars.',    1000, TRUE, 'rare',     FALSE, 'orbital'),
  ('marker_orbital_satellite', 'map_marker',     'Satellite Marker',  'A satellite keeping watch over your capital.', 200,  TRUE, 'common',   FALSE, 'orbital')
ON CONFLICT (cosmetic_id) DO NOTHING;
