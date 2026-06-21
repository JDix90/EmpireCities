-- ── Product analytics events ──────────────────────────────────────────────
-- First-party, queryable funnel/retention store. Backs `recordServerEvent`
-- (backend/src/services/analyticsEvents.ts), which until now only printed JSON
-- to stdout. Server-side only — no third-party SDKs, no client cookies — so it
-- stays inside the existing privacy policy.
--
-- user_id is NULLABLE (some events are pre-auth / anonymous) and ON DELETE SET
-- NULL so a user's account deletion keeps the aggregate funnel intact while
-- dropping the personal linkage (GDPR-friendly anonymization).

CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  event       VARCHAR(64) NOT NULL,
  user_id     UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  properties  JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Funnel slices ("how many `game_created` last week"): event + time.
CREATE INDEX IF NOT EXISTS idx_analytics_event_time ON analytics_events(event, created_at DESC);
-- Per-user retention/cohort joins.
CREATE INDEX IF NOT EXISTS idx_analytics_user_time  ON analytics_events(user_id, created_at DESC);
-- Time-range scans across all events.
CREATE INDEX IF NOT EXISTS idx_analytics_created    ON analytics_events(created_at DESC);
