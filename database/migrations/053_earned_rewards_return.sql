-- The Warlord Frame and the Emperor Marker come back, as the rewards of
-- Warlord and Perfect Campaign.
--
-- Migration 044 took them out of the catalog because nothing could earn them:
-- neither achievement was ever awarded. Both are now (051, 052), so the unlock
-- grants each one again (ACHIEVEMENT_COSMETIC_MAP in
-- backend/src/game-engine/achievements/achievementService.ts), and a player who
-- already holds the achievement gets the reward here.
--
-- They are earned-only, like the other medals: the store lists them and never
-- sells them. A row that 044 kept because somebody owned one is brought in line
-- rather than added again, and that copy stays with its owner.
INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium, rarity, earned_only, required_achievement) VALUES
  ('frame_warlord',  'profile_frame', 'Warlord Frame',  'Earned with Warlord: 50 ranked wins and a ranked rating of 1800.',  0, FALSE, 'legendary', TRUE, 'ranked_warlord'),
  ('marker_emperor', 'map_marker',    'Emperor Marker', 'Earned with Perfect Campaign: all 6 campaign eras without a loss.', 0, FALSE, 'legendary', TRUE, 'perfect_campaign')
ON CONFLICT (cosmetic_id) DO UPDATE
  SET type = EXCLUDED.type,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      price_gems = EXCLUDED.price_gems,
      is_premium = EXCLUDED.is_premium,
      rarity = EXCLUDED.rarity,
      earned_only = EXCLUDED.earned_only,
      required_achievement = EXCLUDED.required_achievement;

INSERT INTO user_cosmetics (user_id, cosmetic_id)
SELECT ua.user_id, reward.cosmetic_id
FROM user_achievements ua
JOIN (VALUES
  ('ranked_warlord',   'frame_warlord'),
  ('perfect_campaign', 'marker_emperor')
) AS reward (achievement_id, cosmetic_id) ON reward.achievement_id = ua.achievement_id
ON CONFLICT (user_id, cosmetic_id) DO NOTHING;
