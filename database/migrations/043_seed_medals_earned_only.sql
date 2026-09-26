-- The six gameplay medals from database/seeds/002_seed_medals.sql are
-- earned-only: achievementService grants them (first win, total domination,
-- a 10-game win streak, a comeback win, an 8-turn win, a 1600 ranked rating),
-- never the store.
--
-- Migration 030 marked them, but only where the seed had already run. SQL
-- seeds run after migrations, and only when someone runs them (the first
-- deploy's --seed), so on a database migrated first and seeded second the
-- seed inserted these rows after 030, with earned_only = false. The store
-- then listed them as "Get Free" and granted them to anyone who clicked.
--
-- The seed now inserts them earned-only itself; this corrects the rows that
-- were inserted the old way.
UPDATE cosmetics
  SET earned_only = true
  WHERE cosmetic_id IN (
    'frame_bronze', 'frame_silver', 'frame_gold', 'frame_champion',
    'marker_skull', 'marker_crown'
  );
