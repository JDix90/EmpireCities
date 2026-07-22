-- Migration 038: variable-size ranked matchmaking — preferred opponent count.
-- A queued player's preferred_opponents P means they want a (P+1)-player game.
-- Cohort matching groups the queue by (era_id, bucket, preferred_opponents);
-- the index serves both the grouped candidate scan and the "one seat left"
-- offer query (COUNT per preference ordered by enqueued_at).

ALTER TABLE ranked_queue
  ADD COLUMN IF NOT EXISTS preferred_opponents SMALLINT NOT NULL DEFAULT 1;

-- Guarded ADD CONSTRAINT: Postgres has no IF NOT EXISTS for table constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ranked_queue_preferred_opponents_range'
  ) THEN
    ALTER TABLE ranked_queue
      ADD CONSTRAINT ranked_queue_preferred_opponents_range
      CHECK (preferred_opponents BETWEEN 1 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ranked_queue_cohort
  ON ranked_queue (era_id, bucket, preferred_opponents, enqueued_at);
