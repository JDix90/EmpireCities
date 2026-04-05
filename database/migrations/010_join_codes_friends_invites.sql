-- Join codes for games, friendship direction, game invites

ALTER TABLE games ADD COLUMN IF NOT EXISTS join_code VARCHAR(8);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_join_code ON games(join_code) WHERE join_code IS NOT NULL;

ALTER TABLE friendships ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS game_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  CONSTRAINT game_invites_no_self CHECK (inviter_id <> invitee_id),
  UNIQUE (game_id, invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_game_invites_invitee_open
  ON game_invites(invitee_id) WHERE consumed_at IS NULL;
