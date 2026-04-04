CREATE TABLE IF NOT EXISTS map_reports (
  report_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  map_id      TEXT NOT NULL,
  reporter_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(map_id, reporter_id)
);
