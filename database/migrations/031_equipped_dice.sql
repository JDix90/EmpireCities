-- Dice skins were purchasable/earnable but not equippable: the equip route and
-- profile only tracked frames and markers. Add an equipped_dice slot so the
-- Loadout can persist a chosen dice skin, mirroring equipped_frame/marker.
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_dice VARCHAR(64)
  REFERENCES cosmetics(cosmetic_id);
