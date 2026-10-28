-- Player feedback from inside the game: the Galactic Age beta's "Send
-- feedback" form (source beta_panel) and its game-over thumbs (game_over).
-- Written by POST /api/feedback, read by Admin → Feedback.
--
-- The context columns are filled by the client, not typed by the player: the
-- game, the turn it was sent on, and the device class and screen size, so a
-- report like "the chart covers the button" can be matched to a screen.
--
-- user_id is ON DELETE CASCADE: deleting an account deletes what it wrote.
-- game_id is ON DELETE SET NULL: the feedback outlives the game's record.

CREATE TABLE IF NOT EXISTS game_feedback (
  feedback_id UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  -- What the feedback is about; galactic_age is the only topic so far.
  topic       VARCHAR(32) NOT NULL CHECK (topic IN ('galactic_age')),
  -- Where it was sent from: the BETA panel's form, or the game-over thumbs.
  source      VARCHAR(16) NOT NULL CHECK (source IN ('beta_panel', 'game_over')),
  rating      VARCHAR(4)  CHECK (rating IN ('up', 'down')),
  comment     TEXT        CHECK (char_length(comment) <= 1000),
  game_id     UUID        REFERENCES games(game_id) ON DELETE SET NULL,
  turn_number INTEGER,
  -- phone | tablet | desktop (frontend utils/device.ts deviceClass)
  device      VARCHAR(8),
  -- The browser window, e.g. 390x844
  viewport    VARCHAR(16),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (rating IS NOT NULL OR comment IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_game_feedback_topic_created ON game_feedback(topic, created_at DESC);

-- One game-over answer per player per game: a comment added after the thumb
-- updates the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_feedback_game_over
  ON game_feedback(user_id, game_id)
  WHERE source = 'game_over';
