-- Permanent marker for guest→registered conversions. Without it an upgraded
-- account is indistinguishable from a born-registered one, making the
-- guest-funnel conversion rate (the metric the upgrade CTA exists to move)
-- unmeasurable. Set once by POST /api/auth/upgrade; never cleared.
ALTER TABLE users ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMPTZ;
