-- When a refresh token was replaced by rotation, and by which token.
--
-- /auth/refresh revokes the token it is shown and issues a new one. Until now
-- a revoked row could not say why it was revoked, so a token that rotation had
-- retired a second ago looked the same as one ended by logout, a password
-- change or a ban, and was refused the same way. Two requests carrying the
-- same cookie (two tabs, or a phone waking with several requests queued) got
-- one success and one 401, and the browser treated the 401 as signed out; so
-- did a retry after a reply that never reached the phone.
--
-- With these, /auth/refresh accepts a token replaced in the last few minutes
-- whose replacement has never been used (session_refresh_grace_enabled).
-- Revocations that end a session leave rotated_at NULL. replaced_by is not a
-- foreign key: the token sweep deletes rows independently.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by UUID;
