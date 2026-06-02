-- Map documents (formerly MongoDB custommaps) and per-user ratings (formerly MapRating collection).

CREATE TABLE IF NOT EXISTS maps (
  map_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  era_theme TEXT,
  background_image_url TEXT,
  canvas_width INTEGER NOT NULL DEFAULT 1200,
  canvas_height INTEGER NOT NULL DEFAULT 700,
  projection_bounds JSONB,
  globe_view JSONB,
  map_kind TEXT CHECK (map_kind IS NULL OR map_kind IN ('standard', 'galaxy')),
  worlds JSONB,
  orbit_access TEXT CHECK (
    orbit_access IS NULL OR orbit_access IN ('none', 'space_age_moon', 'galaxy_hyperspace')
  ),
  rts_terrain JSONB,
  territories JSONB NOT NULL,
  connections JSONB NOT NULL,
  regions JSONB NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  is_moderated BOOLEAN NOT NULL DEFAULT false,
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  rating NUMERIC(4, 1) NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maps_creator_id ON maps (creator_id);
CREATE INDEX IF NOT EXISTS idx_maps_community_hub ON maps (is_public, moderation_status, play_count DESC)
  WHERE is_public = true AND moderation_status = 'approved' AND creator_id <> 'system';
CREATE INDEX IF NOT EXISTS idx_maps_era_system ON maps (creator_id, moderation_status)
  WHERE creator_id = 'system';
CREATE INDEX IF NOT EXISTS idx_maps_rating ON maps (rating DESC);
CREATE INDEX IF NOT EXISTS idx_maps_created_at ON maps (created_at DESC);

CREATE TABLE IF NOT EXISTS map_ratings (
  map_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_map_ratings_map_id ON map_ratings (map_id);
