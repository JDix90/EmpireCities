-- RTS-Fork: classic vs RTS discriminator + state snapshots
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS game_mode VARCHAR(16) NOT NULL DEFAULT 'classic';

CREATE TABLE IF NOT EXISTS rts_game_states (
  game_id   UUID PRIMARY KEY REFERENCES games (game_id) ON DELETE CASCADE,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rts_game_states_updated ON rts_game_states (updated_at DESC);

COMMENT ON COLUMN games.game_mode IS 'classic | rts';
COMMENT ON TABLE rts_game_states IS 'Server-authoritative RTS game snapshots (MVP0).';
