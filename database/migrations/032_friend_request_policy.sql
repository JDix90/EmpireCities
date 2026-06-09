-- Friend request privacy policy per user
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS friend_requests_policy TEXT NOT NULL DEFAULT 'everyone'
  CHECK (friend_requests_policy IN ('everyone', 'friends_of_friends', 'nobody'));
