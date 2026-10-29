-- Feedback from the lobby's menu, about anything: topic `general`, sent from
-- the `menu`. Besides the Galactic Age beta's in-game form and game-over
-- thumbs (055), a player can now say what they think of the game as a whole.
--
-- category: what the player says it is about (a bug, an idea, or something
-- else), so Admin → Feedback can sort reports from suggestions.
-- page: the page it was sent from, e.g. /lobby.

ALTER TABLE game_feedback DROP CONSTRAINT IF EXISTS game_feedback_topic_check;
ALTER TABLE game_feedback ADD CONSTRAINT game_feedback_topic_check
  CHECK (topic IN ('galactic_age', 'general'));

ALTER TABLE game_feedback DROP CONSTRAINT IF EXISTS game_feedback_source_check;
ALTER TABLE game_feedback ADD CONSTRAINT game_feedback_source_check
  CHECK (source IN ('beta_panel', 'game_over', 'menu'));

ALTER TABLE game_feedback ADD COLUMN IF NOT EXISTS category VARCHAR(8)
  CHECK (category IN ('bug', 'idea', 'other'));
ALTER TABLE game_feedback ADD COLUMN IF NOT EXISTS page VARCHAR(64);
