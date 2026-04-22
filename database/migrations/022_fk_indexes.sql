-- Migration 022: add indexes on high-traffic FK columns that were missing.
--
-- Every FK column used in a WHERE clause or JOIN without a backing index
-- causes a sequential scan of the child table. The tables below are all
-- accessed on every active session (token rotation, player lookups,
-- leaderboard queries, gold balance reads) so the scans add up fast.
--
-- All created with IF NOT EXISTS so this is safe to re-run.

-- refresh_tokens.user_id: hit on every token rotation and session lookup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON refresh_tokens(user_id);

-- refresh_tokens.expires_at: used in cleanup sweeps to purge old tokens
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON refresh_tokens(expires_at)
  WHERE revoked = FALSE;

-- game_players.user_id: joins on every lobby load, active-games query,
-- and stats aggregation
CREATE INDEX IF NOT EXISTS idx_game_players_user_id
  ON game_players(user_id);

-- gold_transactions.user_id: audit log lookups and future balance history
CREATE INDEX IF NOT EXISTS idx_gold_transactions_user_id
  ON gold_transactions(user_id);

-- user_ratings: already has PK on (user_id, rating_type) but adding
-- a standalone user_id index accelerates queries that filter on user_id
-- alone (e.g. DELETE on account removal)
CREATE INDEX IF NOT EXISTS idx_user_ratings_user_id
  ON user_ratings(user_id);

-- ranked_queue.user_id: used in SELECT on every matchmaking sweep;
-- the ON CONFLICT clause already implies uniqueness but not a named index
CREATE INDEX IF NOT EXISTS idx_ranked_queue_user_id
  ON ranked_queue(user_id);

-- daily_challenge_entries: leaderboard queries filter by challenge_date
CREATE INDEX IF NOT EXISTS idx_daily_challenge_entries_date
  ON daily_challenge_entries(challenge_date, user_id);
