-- Last-seen timestamp for the admin dashboard. Stamped (fire-and-forget) on
-- login, registration, guest creation, guest upgrade, and refresh rotation —
-- the rotation stamp makes it an hourly-granularity "last active" signal.
-- Distinct from users.last_login_date (DATE), which belongs to the daily-login
-- reward flow and is only set when a registered user claims the bonus.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
