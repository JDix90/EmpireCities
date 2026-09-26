-- Take the store items that do nothing off sale and refund what their buyers
-- paid; take back items that were handed out without being paid for or
-- earned; drop earned rewards that nothing can grant.
--
-- It pays out only once. The runner records it in _migrations, and the refund
-- is keyed on ownership rows that this file then deletes, so even a re-run
-- finds nothing left to refund.

-- No purchase may land between the refund and the deletes below.
LOCK TABLE user_cosmetics IN SHARE ROW EXCLUSIVE MODE;

-- Leaving the store. Nothing in the game draws unit skins (units are a number
-- on the map) or map themes (neither map has a theme hook), and the free
-- starters draw nothing: wearing nothing already looks classic.
CREATE TEMP TABLE IF NOT EXISTS retired_cosmetics (cosmetic_id VARCHAR(64) PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retired_cosmetics (cosmetic_id) VALUES
  ('roman_legionary'), ('wwii_sherman'),
  ('parchment_theme'), ('radar_theme'),
  ('default_unit'), ('default_dice'), ('default_banner')
ON CONFLICT DO NOTHING;

-- 1. Refund each owner of a retired item what the ledger says they paid, one
--    ledger row per item. An owner with no "Purchased:" row never paid (a 402
--    used to leave the item granted) and gets nothing back.
WITH paid AS (
  SELECT uc.user_id, c.name, -SUM(gt.amount) AS amount
  FROM user_cosmetics uc
  JOIN retired_cosmetics r ON r.cosmetic_id = uc.cosmetic_id
  JOIN cosmetics c ON c.cosmetic_id = uc.cosmetic_id
  JOIN gold_transactions gt
    ON gt.user_id = uc.user_id
   AND gt.reason = 'Purchased: ' || c.name
   AND gt.amount < 0
  GROUP BY uc.user_id, c.name
),
credit AS (
  UPDATE users u
  SET gold = COALESCE(u.gold, 0) + t.total
  FROM (SELECT user_id, SUM(amount) AS total FROM paid GROUP BY user_id) t
  WHERE u.user_id = t.user_id
)
INSERT INTO gold_transactions (user_id, amount, reason)
SELECT user_id, amount, 'Refund: ' || name || ' (retired from the store)'
FROM paid;

-- 2. Take the retired items out of every collection.
DELETE FROM user_cosmetics uc
USING retired_cosmetics r
WHERE uc.cosmetic_id = r.cosmetic_id;

-- 3. Before the buy route's fix (shipped with migration 043), pressing Buy
--    with too little gold still granted the item. Copies of the items that
--    stay on sale with no purchase row were never paid for.
DELETE FROM user_cosmetics uc
USING cosmetics c
WHERE c.cosmetic_id = uc.cosmetic_id
  AND c.cosmetic_id IN ('general_banner', 'emperor_title', 'bone_dice', 'holo_dice')
  AND NOT EXISTS (
    SELECT 1 FROM gold_transactions gt
    WHERE gt.user_id = uc.user_id
      AND gt.reason = 'Purchased: ' || c.name
      AND gt.amount < 0
  );

-- 4. On databases seeded after migration 030, the store handed out the
--    gameplay medals free (see 043). Copies owned without the achievement
--    that grants them were never earned. Silver Strategist is granted at a
--    1600 ranked rating the player may since have dropped below, so it can't
--    be judged and stays.
DELETE FROM user_cosmetics uc
USING (VALUES
  ('frame_bronze',   'first_blood'),
  ('frame_gold',     'conqueror'),
  ('frame_champion', 'ten_streak'),
  ('marker_crown',   'comeback_king'),
  ('marker_skull',   'speed_demon')
) AS medal (cosmetic_id, achievement_id)
WHERE uc.cosmetic_id = medal.cosmetic_id
  AND NOT EXISTS (
    SELECT 1 FROM user_achievements ua
    WHERE ua.user_id = uc.user_id AND ua.achievement_id = medal.achievement_id
  );

-- 5. Nobody keeps wearing an item they no longer own.
UPDATE users u SET equipped_frame = NULL
WHERE u.equipped_frame IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_cosmetics uc WHERE uc.user_id = u.user_id AND uc.cosmetic_id = u.equipped_frame
  );
UPDATE users u SET equipped_marker = NULL
WHERE u.equipped_marker IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_cosmetics uc WHERE uc.user_id = u.user_id AND uc.cosmetic_id = u.equipped_marker
  );
UPDATE users u SET equipped_dice = NULL
WHERE u.equipped_dice IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_cosmetics uc WHERE uc.user_id = u.user_id AND uc.cosmetic_id = u.equipped_dice
  );

-- 6. The retired items leave the catalog.
DELETE FROM cosmetics c
USING retired_cosmetics r
WHERE c.cosmetic_id = r.cosmetic_id;

-- 7. The store lists six rewards as "Earn in game" that nothing can grant:
--    their achievements are never awarded (Warlord Frame, Emperor Marker),
--    prestige never rises (Prestige I and II Frames), and nothing counts games
--    against the same opponent (Rival and Nemesis Badges). They go until those
--    systems exist. One that somebody owns anyway stays.
DELETE FROM cosmetics c
WHERE c.cosmetic_id IN (
    'frame_warlord', 'marker_emperor', 'frame_prestige_1', 'frame_prestige_2',
    'badge_rival', 'badge_nemesis'
  )
  AND NOT EXISTS (SELECT 1 FROM user_cosmetics uc WHERE uc.cosmetic_id = c.cosmetic_id)
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE c.cosmetic_id IN (u.equipped_frame, u.equipped_marker, u.equipped_dice)
  );
