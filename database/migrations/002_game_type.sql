-- Migration 002: Add game_type column for solo/multiplayer/hybrid classification
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type VARCHAR(16) NOT NULL DEFAULT 'solo';
-- values: 'solo' | 'multiplayer' | 'hybrid'
