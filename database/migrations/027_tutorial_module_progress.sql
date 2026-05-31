-- Track which optional tutorial modules each user has completed.
-- Allows syncing progress across devices and seeding TutorialPage with server state.
CREATE TABLE IF NOT EXISTS user_tutorial_modules (
  user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  module_id   TEXT        NOT NULL CHECK (module_id IN ('core', 'advanced_settings', 'faction_ability', 'tech_tree')),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tutorial_modules_user_id ON user_tutorial_modules(user_id);
