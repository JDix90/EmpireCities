-- Guest sessions: minimal accounts so game_players.user_id FK remains valid.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;
