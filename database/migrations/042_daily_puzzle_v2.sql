-- Daily Challenge v2 (docs/DAILY_PUZZLE_V2.md): the daily as a decision
-- puzzle, scored by accuracy against an exact solver.
--
-- A v1 entry is a win/loss plus a par-based score. A v2 entry records how
-- well the player chose: accuracy (100 minus the mean win-probability lost
-- across the run's graded decisions), how many attempts the run took (one
-- plus takebacks), whether it was first-try, and the graded decisions
-- themselves for the review panel and the archive. puzzle_version tells the
-- leaderboard which ordering a row belongs to; existing rows are v1.
ALTER TABLE daily_challenge_entries
  ADD COLUMN IF NOT EXISTS puzzle_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS accuracy       NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS attempts       INT,
  ADD COLUMN IF NOT EXISTS first_try      BOOLEAN,
  ADD COLUMN IF NOT EXISTS decisions_json JSONB;
