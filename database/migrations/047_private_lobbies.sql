-- A private lobby: shared by its host's link and join code only, never listed
-- in Open Games (GET /api/games/public). Challenge-a-friend creates these: its
-- open seat is for the friend, and a listed game let any stranger take it.
ALTER TABLE games ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
