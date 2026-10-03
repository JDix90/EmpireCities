-- Accounts whose play stays out of the admin stats.
--
-- Admin accounts are left out by `is_admin`; this marks the others an admin
-- uses for testing (Admin → Users → "Test account"). The operator plays far more
-- than anyone else, so without it their own games dominate every count on the
-- Overview, Analytics and Balance tabs. See backend/src/services/statsExclusion.ts.

ALTER TABLE users ADD COLUMN IF NOT EXISTS exclude_from_stats BOOLEAN NOT NULL DEFAULT FALSE;
