// ============================================================
// Shared backend types for Eras of Empire
// ============================================================

import type { GamePhase, ConnectionType, MapConnectionEdge } from '@erasofempire/shared';

export type { GamePhase, ConnectionType, MapConnectionEdge };

export type EraId = 'ancient' | 'medieval' | 'discovery' | 'ww2' | 'coldwar' | 'modern' | 'acw' | 'risorgimento' | 'custom';
export type GameStatus = 'waiting' | 'in_progress' | 'completed' | 'abandoned';
export type VictoryType = 'domination' | 'secret_mission' | 'capital' | 'threshold';
export type AiDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'tutorial';
export type DiplomacyStatus = 'neutral' | 'truce' | 'nap' | 'war';

// ── User ──────────────────────────────────────────────────────────────────────
export interface User {
  user_id: string;
  username: string;
  email: string;
  level: number;
  xp: number;
  mmr: number;
  avatar_url?: string;
  created_at: Date;
}

export interface UserPublic {
  user_id: string;
  username: string;
  level: number;
  mmr: number;
  avatar_url?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface JwtAccessPayload {
  sub: string;       // user_id
  username: string;
  guest?: boolean;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;       // user_id
  tokenId: string;   // refresh_token row id
  iat?: number;
  exp?: number;
}

// ── Game State ────────────────────────────────────────────────────────────────
export interface TerritoryState {
  territory_id: string;
  owner_id: string | null;
  unit_count: number;
  unit_type: string;
}

export interface PlayerState {
  player_id: string;        // user_id or 'ai_<index>'
  player_index: number;
  username: string;
  color: string;
  is_ai: boolean;
  ai_difficulty?: AiDifficulty;
  is_eliminated: boolean;
  territory_count: number;
  cards: TerritoryCard[];
  mmr: number;
}

export interface DiplomacyEntry {
  player_index_a: number;
  player_index_b: number;
  status: DiplomacyStatus;
  truce_turns_remaining: number;
}

export interface TerritoryCard {
  card_id: string;
  territory_id: string | null;   // null = wild card
  symbol: 'infantry' | 'cavalry' | 'artillery' | 'wild';
}

export interface GameSettings {
  fog_of_war: boolean;
  victory_type: VictoryType;
  victory_threshold?: number;    // for 'threshold' mode
  turn_timer_seconds: number;    // 0 = no timer
  initial_unit_count: number;
  card_set_escalating: boolean;
  diplomacy_enabled: boolean;
  tutorial?: boolean;
  tutorial_step?: number;
  /** When true, turn notifications use email (requires SMTP). */
  async_mode?: boolean;
}

/** Optional per-era combat / economy tweaks (see implementation plan Step 08). */
export interface EraModifiers {
  legion_reroll?: boolean;
  castle_fortification?: boolean;
  sea_lanes?: boolean;
  wartime_logistics?: boolean;
  influence_spread?: boolean;
}

/** Snapshots for end-of-game win-probability chart (territory + army blend, renormalized). */
export interface WinProbabilitySnapshot {
  step: number;
  turn: number;
  probabilities: Record<string, number>; // player_id → 0–1
}

export interface GameState {
  game_id: string;
  era: EraId;
  map_id: string;
  phase: GamePhase;
  current_player_index: number;
  turn_number: number;
  players: PlayerState[];
  territories: Record<string, TerritoryState>;
  card_deck: TerritoryCard[];
  card_set_redemption_count: number;
  diplomacy: DiplomacyEntry[];
  settings: GameSettings;
  draft_units_remaining: number;
  turn_started_at: number;       // Unix timestamp ms
  winner_id?: string;
  win_probability_history?: WinProbabilitySnapshot[];
  era_modifiers?: EraModifiers;
}

// ── Combat ────────────────────────────────────────────────────────────────────
export interface CombatResult {
  attacker_rolls: number[];
  defender_rolls: number[];
  attacker_losses: number;
  defender_losses: number;
  territory_captured: boolean;
}

// ── Map Data ──────────────────────────────────────────────────────────────────
export interface GeoConfigItem {
  iso: string;
  clip_bbox?: [number, number, number, number];
}

export interface MapTerritory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
  /** Closed ring in WGS84 [lng, lat] — used by globe when set (avoids warped canvas→globe mapping). */
  geo_polygon?: [number, number][];
  /** ISO_A2 country codes for geographic boundaries */
  iso_codes?: string[];
  /** Clip merged geometry to [minLng, minLat, maxLng, maxLat] */
  clip_bbox?: [number, number, number, number];
  /** Per-country config for split regions */
  geo_config?: GeoConfigItem[];
}

export interface MapConnection {
  from: string;
  to: string;
  type: ConnectionType;
}

export interface MapRegion {
  region_id: string;
  name: string;
  bonus: number;
}

export interface GameMap {
  map_id: string;
  name: string;
  era?: EraId;
  territories: MapTerritory[];
  connections: MapConnection[];
  regions: MapRegion[];
  canvas_width?: number;
  canvas_height?: number;
  projection_bounds?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  globe_view?: {
    lock_rotation?: boolean;
    center_lat?: number;
    center_lng?: number;
    altitude?: number;
  };
}
