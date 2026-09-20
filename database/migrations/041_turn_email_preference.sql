-- Turn emails are transactional, not marketing — give them their own switch.
--
-- The signup checkbox reads "Email me streak reminders and comeback bonuses":
-- that is marketing consent, opt-in, stored in
-- user_preferences.email_notifications. The same column also gated the
-- "it's your turn" email for async games, and the Settings toggle described it
-- exactly that way — so anyone who declined marketing at signup silently
-- declined turn alerts they were never offered, and with push unconfigured
-- that left them with no notification at all.
--
-- A player who joined a multi-day game expects to be told when it is their
-- move; that is service, not promotion, so it defaults ON. Marketing keeps its
-- opt-in column untouched. The one-click unsubscribe link (which turn emails
-- carry too) now clears BOTH: a recipient who clicks it on a turn email means
-- "stop these", and must not keep receiving them.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS turn_emails_enabled BOOLEAN NOT NULL DEFAULT true;
