-- Chat safety (chat_safety_enabled): a player can block another, so that
-- player's chat no longer reaches them, and can report a chat message, which
-- lands in Admin → Reports. Required of an app with chat on the App Store
-- (guideline 1.2: report offensive content, block abusive users).
--
-- user_blocks: one row per (blocker, blocked). Both ends cascade: deleting
-- either account removes the block.
--
-- chat_reports: what was reported and why. The message is the server's own
-- copy when the server still held it (message_verified), else the reporter's
-- copy. reported_username is kept as text so a report still reads after the
-- reported account is deleted; both user columns are then set to NULL.

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  blocked_id UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- Each chat message asks who has blocked its sender.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS chat_reports (
  report_id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id       UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  reported_id       UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  reported_username VARCHAR(64) NOT NULL,
  game_id           UUID        REFERENCES games(game_id) ON DELETE SET NULL,
  -- Which chat: the game's, its lobby's, or its spectators'.
  channel           VARCHAR(16) NOT NULL CHECK (channel IN ('game', 'lobby', 'spectator')),
  message_id        UUID,
  message           TEXT        CHECK (char_length(message) <= 600),
  message_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
  reason            VARCHAR(16) NOT NULL CHECK (reason IN ('harassment', 'hate', 'sexual', 'spam', 'name', 'other')),
  details           TEXT        CHECK (char_length(details) <= 500),
  status            VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolution_note   TEXT        CHECK (char_length(resolution_note) <= 500),
  resolved_by       UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_reports_status_created ON chat_reports(status, created_at DESC);

-- One report per reporter per message: a second tap does not file twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_reports_reporter_message
  ON chat_reports(reporter_id, message_id)
  WHERE message_id IS NOT NULL;
