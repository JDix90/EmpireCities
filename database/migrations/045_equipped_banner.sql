-- A banner slot of its own. Banners (type profile_banner) have shared
-- equipped_frame with frames, so wearing a banner took the frame off. With
-- store_v2_enabled the equip route puts banners here instead; a banner still
-- sitting in equipped_frame from before is read as the banner until its
-- owner next changes their frame (backend/src/modules/users/loadout.ts).
--
-- No foreign key (see 029): the equip route checks ownership and type, and
-- every renderer ignores an id it doesn't know.
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_banner VARCHAR(64);
