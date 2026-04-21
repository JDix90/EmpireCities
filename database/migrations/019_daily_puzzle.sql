-- Daily puzzle-style challenges: kind + JSON spec; entry analytics

ALTER TABLE daily_challenges
  ADD COLUMN IF NOT EXISTS kind VARCHAR(32) NOT NULL DEFAULT 'puzzle',
  ADD COLUMN IF NOT EXISTS spec_json JSONB NOT NULL DEFAULT '{}';

-- Existing rows: legacy full-map daily (domination-only) before puzzle system
UPDATE daily_challenges
SET kind = 'full_solo',
    spec_json = jsonb_build_object('archetype', 'domination', 'legacy', true)
WHERE spec_json = '{}'::jsonb OR spec_json IS NULL;

ALTER TABLE daily_challenge_entries
  ADD COLUMN IF NOT EXISTS puzzle_score INTEGER,
  ADD COLUMN IF NOT EXISTS objective_met BOOLEAN,
  ADD COLUMN IF NOT EXISTS archetype VARCHAR(32),
  ADD COLUMN IF NOT EXISTS move_feedback_mistakes INTEGER;
