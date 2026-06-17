-- Migration 034: index games(status) for the lobby's live/public game lists.
--
-- GET /api/games/live, /public and /stats/activity all filter
-- `status = 'in_progress'` / 'waiting' with no backing index, forcing a
-- sequential scan of the games table — which only grows (completed games are
-- retained). Under a launch burst these are among the most-hit authenticated
-- endpoints. A PARTIAL index on the active statuses stays small (the vast
-- majority of rows are 'completed'/'abandoned') while serving every active-game
-- lookup from an index scan.
--
-- Non-concurrent CREATE INDEX briefly locks writes while it builds; run at
-- deploy before the traffic burst (the table is still small). IF NOT EXISTS
-- makes it safe to re-run.
CREATE INDEX IF NOT EXISTS idx_games_status_active
  ON games(status)
  WHERE status IN ('waiting', 'in_progress');
