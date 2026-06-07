-- Authoritative "earned through gameplay, not claimable in the store" flag.
--
-- The store's free-claim path previously granted ANY price_gems = 0 cosmetic,
-- which leaked every prestige/level/season/rating/achievement reward (e.g.
-- frame_silver, frame_level_10, frame_immortal) to anyone who clicked
-- "Get Free". Rather than re-deriving each unlock rule in the route, mark every
-- earned cosmetic with a single flag and let services be the only grant path.
--
-- Rule: every price-0 cosmetic is earned-only EXCEPT the three genuine starter
-- defaults. Paid cosmetics (price_gems > 0) stay purchasable via the gold path.
-- This is future-proof: any new price-0 reward is locked out of the store by
-- default until explicitly whitelisted here.
ALTER TABLE cosmetics
  ADD COLUMN IF NOT EXISTS earned_only BOOLEAN NOT NULL DEFAULT false;

UPDATE cosmetics
  SET earned_only = true
  WHERE COALESCE(price_gems, 0) = 0
    AND cosmetic_id NOT IN ('default_unit', 'default_dice', 'default_banner');
