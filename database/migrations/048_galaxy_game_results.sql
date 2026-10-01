-- Galactic Age results: one row per finished Galactic Age game, and one per
-- seat, written by finalizeGame (game-engine/state/galaxyResults.ts) and read
-- by the admin report (GET /api/admin/metrics/galaxy).
--
-- The dealt board (which world split, each seat's house, side and role) lives
-- only in the game state, and a finished game's state snapshots are pruned after
-- GAME_STATE_RETENTION_DAYS. These rows keep what the report needs for good.
--
-- A seat's user_id is ON DELETE SET NULL, as in game_players: deleting an
-- account keeps the game on record and drops the personal link.

CREATE TABLE IF NOT EXISTS galaxy_game_results (
  game_id     UUID        PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seats       SMALLINT    NOT NULL,
  -- colonies | home_worlds | 2v2 | partial_schism | schism | scattered
  mode        VARCHAR(24) NOT NULL,
  -- concord | civil_war | allied on a Schism board, else NULL
  relations   VARCHAR(16),
  -- Partial Schism: the worlds that split (schismSplitKey), else NULL
  board       VARCHAR(64),
  -- state.victory_condition: how the game ended
  victory     VARCHAR(32),
  turns       INTEGER     NOT NULL,
  -- The seat that moved first (starting_player_index)
  first_seat  SMALLINT,
  humans      SMALLINT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_galaxy_game_results_finished ON galaxy_game_results(finished_at DESC);

CREATE TABLE IF NOT EXISTS galaxy_game_result_seats (
  game_id         UUID        NOT NULL REFERENCES galaxy_game_results(game_id) ON DELETE CASCADE,
  -- Turn order: team boards reseat players, so this is not game_players.player_index
  seat            SMALLINT    NOT NULL,
  user_id         UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  is_ai           BOOLEAN     NOT NULL,
  ai_difficulty   VARCHAR(16),
  faction_id      VARCHAR(32),
  world_id        VARCHAR(32),
  -- Schism: the house's name, e.g. "Western Mandate"
  house           VARCHAR(64),
  -- home | rival | alone | ally | whole | scattered
  role            VARCHAR(16) NOT NULL,
  -- Team games: the seat's team_id
  side            VARCHAR(64),
  -- Units a turn the seat's own board number added (Schism houses and whole worlds)
  reinforce_bonus SMALLINT,
  won             BOOLEAN     NOT NULL,
  eliminated      BOOLEAN     NOT NULL,
  resigned        BOOLEAN     NOT NULL DEFAULT FALSE,
  territories     INTEGER     NOT NULL,
  PRIMARY KEY (game_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_galaxy_game_result_seats_user ON galaxy_game_result_seats(user_id);
