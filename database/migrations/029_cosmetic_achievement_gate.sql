-- Gate achievement-locked cosmetics so they can only be claimed in the store
-- once the linked achievement has been earned. Previously these items had
-- price_gems = 0 + rarity = 'common', so the store's "Get Free" path granted
-- them with no prerequisite check (progression/achievement bypass).
--
-- No FK constraint: this migration runs automatically on backend startup, and
-- a hard FK to achievements(achievement_id) would crash boot if the achievement
-- seeds had not been applied yet. The store gate checks user_achievements at
-- claim time, so a value with no matching achievement simply fails closed
-- (no user can have earned a non-existent achievement).
ALTER TABLE cosmetics
  ADD COLUMN IF NOT EXISTS required_achievement VARCHAR(64);

-- Mirror the one-way grants in
-- backend/src/game-engine/achievements/achievementService.ts
-- (ACHIEVEMENT_COSMETIC_MAP) as an inverse claim gate.
UPDATE cosmetics SET required_achievement = 'first_blood'   WHERE cosmetic_id = 'frame_bronze';
UPDATE cosmetics SET required_achievement = 'conqueror'     WHERE cosmetic_id = 'frame_gold';
UPDATE cosmetics SET required_achievement = 'comeback_king' WHERE cosmetic_id = 'marker_crown';
UPDATE cosmetics SET required_achievement = 'speed_demon'   WHERE cosmetic_id = 'marker_skull';
UPDATE cosmetics SET required_achievement = 'ten_streak'    WHERE cosmetic_id = 'frame_champion';

-- frame_silver is granted by a ranked-rating check in achievementService
-- (mu >= 1600), not a named achievement row, so it stays NULL here and keeps
-- its existing service grant path.
