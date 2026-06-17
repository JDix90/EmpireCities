-- Migration 035: index user_ratings(rating_type, mu DESC) for the leaderboard.
--
-- GET /api/leaderboards/top runs `ORDER BY ur.mu DESC LIMIT 5` plus a
-- ROW_NUMBER() OVER (ORDER BY ur.mu DESC) rank window, both over user_ratings
-- filtered to rating_type = 'ranked'. The only index is the PK on
-- (user_id, rating_type), so each cache miss is a full scan + sort of every
-- ratings row. This composite index lets the order-by and the rank computation
-- use an index scan instead.
--
-- Non-concurrent CREATE INDEX briefly locks writes while it builds; user_ratings
-- is one row per user per rating_type, so the build is quick. IF NOT EXISTS
-- makes the migration safe to re-run.
CREATE INDEX IF NOT EXISTS idx_user_ratings_ranked_mu
  ON user_ratings (rating_type, mu DESC);
