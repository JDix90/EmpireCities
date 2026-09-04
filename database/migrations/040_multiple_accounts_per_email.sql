-- One email address may hold more than one account.
--
-- A player who wants to start over under a new name had no way to do it: the
-- UNIQUE constraint on users.email meant a second account required a second
-- address. Usernames stay unique — they are the public identity and the thing
-- an opponent sees — but an address may now carry several of them.
--
-- Dropping a UNIQUE constraint also drops the index behind it, and both login
-- and password reset look accounts up by email, so a plain index replaces it.
-- Those lookups now match several rows by design; auth.routes.ts resolves them
-- deterministically rather than taking an arbitrary first row.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (LOWER(TRIM(BOTH FROM email)));
