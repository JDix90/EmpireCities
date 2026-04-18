// ============================================================
// Shared backend types for Eras of Empire
// ============================================================

import type { GamePhase, ConnectionType, MapConnectionEdge } from '@erasofempire/shared';

export type { GamePhase, ConnectionType, MapConnectionEdge };

export type EraId = 'ancient' | 'medieval' | 'discovery' | 'ww2' | 'coldwar' | 'modern' | 'acw' | 'risorgimento' | 'custom';
export type GameStatus = 'waiting' | 'in_progress' | 'completed' | 'abandoned';
export type VictoryType = 'domination' | 'secret_mission' | 'capital' | 'threshold';
/** Victory condition that ended the game, including fallback for last-player-standing. */
export type VictoryConditionKey = VictoryType | 'last_standing' | 'alliance_victory';

/** Per-player hidden objective when secret_mission victory is enabled. */
export type SecretMission =
  | { kind: 'capture_territories'; territory_ids: [string, string] }
  | { kind: 'eliminate_player'; target_player_id: string }
  | { kind: 'control_regions'; region_ids: string[] }
  | { kind: 'alliance'; ally_player_id: string; territory_threshold: number };
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
  /** Buildings constructed on this territory (economy feature). */
  buildings?: BuildingType[];
  /** Cached production income from buildings (refreshed each turn start). */
  production_bonus?: number;
  /** Fleet count stationed in this territory (naval warfare feature). */
  naval_units?: number;
  /** Stability rating 0-100 (population/stability feature). */
  stability?: number;
  /** Population level 1-10 (population/stability feature). Grows when stable, multiplies production. */
  population?: number;
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
  /** Set when capital victory is allowed; lexicographically first owned territory at init. */
  capital_territory_id: string | null;
  /** Hidden from other clients via buildClientState when secret_mission mode is on. */
  secret_mission: SecretMission | null;
  /** Faction chosen at game start (maps to an era faction definition). */
  faction_id?: string;
  /** Accumulated technology points (economy feature). */
  tech_points?: number;
  /** Special/strategic resource count for era abilities. */
  special_resource?: number;
  /** Tech node IDs that have been researched. */
  unlocked_techs?: string[];
  /** Per-ability use count this turn (keyed by ability_id). */
  ability_uses?: Record<string, number>;
  /** Ability IDs consumed permanently (once-per-game abilities, e.g. atom_bomb). */
  used_game_abilities?: string[];
  /** Active temporary modifiers from event cards (diminishes each turn). */
  temporary_modifiers?: TemporaryModifier[];
  /** Cumulative card sets redeemed this game (card_shark achievement). */
  cards_redeemed_count?: number;
  /** Territories captured in the current turn; reset at turn start (blitzkrieg achievement). */
  territories_captured_this_turn?: number;
  /** Max territories captured in any single turn this game (blitzkrieg achievement). */
  territories_captured_turn_max?: number;
  /** Player IDs with whom this player has established at least one truce (diplomat achievement). */
  truces_established?: string[];
  /** ID of the last opponent this player attacked (used for event card truce targeting). */
  last_attacked_player_id?: string;
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
  /** @deprecated Prefer allowed_victory_conditions; kept for legacy DB rows. */
  victory_type?: VictoryType;
  /** OR semantics: a player wins if they satisfy any listed condition (plus universal elimination). */
  allowed_victory_conditions?: VictoryType[];
  victory_threshold?: number;    // for 'threshold' mode (1–99 %)
  turn_timer_seconds: number;    // 0 = no timer
  initial_unit_count: number;
  card_set_escalating: boolean;
  diplomacy_enabled: boolean;
  tutorial?: boolean;
  tutorial_step?: number;
  /** When true, the game runs asynchronously with long turn deadlines and notifications. */
  async_mode?: boolean;
  /** Async turn deadline in seconds: 43200 (12h), 86400 (24h), or 259200 (72h). */
  async_turn_deadline_seconds?: number;
  /** Enable asymmetric faction starting positions (Phase B). */
  factions_enabled?: boolean;
  /** Enable territory economy layer: buildings, production, resource income (Phase C). */
  economy_enabled?: boolean;
  /** Enable per-era technology trees (Phase D). */
  tech_trees_enabled?: boolean;
  /** Enable era-specific event cards that fire each game round. */
  events_enabled?: boolean;
  /** Enable naval warfare: fleets, ports, sea-lane gating. */
  naval_enabled?: boolean;
  /** Enable population stability mechanics. */
  stability_enabled?: boolean;
  /** Players take turns selecting starting territories instead of auto-assignment. */
  territory_selection?: boolean;
  /** True when this game is part of a campaign sequence. */
  is_campaign?: boolean;
  /** Attack bonus units from campaign prestige carry-over (applied for first 3 turns). */
  campaign_prestige_bonus?: number;
}

// ── User Preferences / Push Tokens ────────────────────────────────────────────
export interface UserPreferences {
  push_enabled: boolean;
  email_notifications: boolean;
}

export interface PushToken {
  token_id: string;
  user_id: string;
  token: string;
  platform: 'web' | 'ios' | 'android';
}

/** Optional per-era combat / economy tweaks. */
export interface EraModifiers {
  // Ancient
  legion_reroll?: boolean;
  // Discovery
  sea_lanes?: boolean;
  // WW2
  wartime_logistics?: boolean;
  // Cold War
  influence_spread?: boolean;
  influence_range?: number;         // hop limit for influence_spread (default 1)
  // Modern
  precision_strike?: boolean;
  // ACW
  rifle_doctrine?: boolean;
  // Risorgimento
  carbonari_network?: boolean;
}

/** Building tiers: production (income), defense (dice/fortify), tech generation, era specials, and era wonders. */
export type BuildingType =
  | 'production_1' | 'production_2' | 'production_3'
  | 'defense_1' | 'defense_2' | 'defense_3'
  | 'tech_gen_1' | 'tech_gen_2'
  | 'special_a' | 'special_b'
  | 'port' | 'naval_base'
  | 'wonder_colosseum'   // ancient
  | 'wonder_cathedral'   // medieval
  | 'wonder_lighthouse'  // discovery
  | 'wonder_manhattan'   // ww2
  | 'wonder_sputnik'     // coldwar
  | 'wonder_cern'        // modern
  | 'wonder_arsenal'     // acw
  | 'wonder_unification' // risorgimento;

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
  /** Pending truce proposals awaiting target player response. */
  pending_truces?: Array<{ proposer_id: string; target_id: string }>;
  settings: GameSettings;
  draft_units_remaining: number;
  turn_started_at: number;       // Unix timestamp ms
  winner_id?: string;
  /** All winner IDs — more than one when alliance_victory occurs. */
  winner_ids?: string[];
  /** Which victory condition triggered the win. */
  victory_condition?: VictoryConditionKey;
  win_probability_history?: WinProbabilitySnapshot[];
  era_modifiers?: EraModifiers;
  /** Number of fortify moves used this turn (limit enforced by wartime_logistics). */
  fortify_moves_used?: number;
  /** Turns remaining before the influence ability can be used again (0 = ready). */
  influence_cooldown_remaining?: number;
  /** Whether a Blitzkrieg (WW2) bonus attack has been used this turn. */
  blitzkrieg_attacked?: boolean;
  /** Currently active event card awaiting resolution (events feature). */
  active_event?: EventCard;
  /** Transient: result of last instant event effect application (cleared after broadcast). */
  active_event_result?: EventEffectResult;
  /** Seasonal event cards injected at game start — merged into era deck when drawing. */
  seasonal_event_cards?: EventCard[];
  /** Transient: territory IDs that rebelled last tick (cleared after broadcast). */
  last_rebellion_territories?: string[];
}

// ── Event Cards ───────────────────────────────────────────────────────────────
export type EventEffectType =
  | 'units_added'
  | 'units_removed'
  | 'enemy_units_removed'
  | 'production_bonus'
  | 'attack_modifier'
  | 'defense_modifier'
  | 'truce'
  | 'region_disaster'
  | 'stability_change';

export type EventCategory = 'global' | 'regional' | 'player_targeted' | 'natural_disaster';

export interface EventEffect {
  type: EventEffectType;
  target: 'player' | 'territory' | 'region';
  value: number;
  /** Specific territory or region ID when target is 'territory' or 'region'. */
  target_id?: string;
  /** How many turns this modifier persists (omit for instant effects). */
  duration_turns?: number;
}

/** Structured summary of what applyEventEffect actually did. */
export interface EventEffectResult {
  affected_territories?: Array<{ territory_id: string; delta: number }>;
  global?: boolean; // region_disaster touched all territories
}

export interface EventChoice {
  choice_id: string;
  label: string;
  effect: EventEffect;
}

export interface EventCard {
  card_id: string;
  title: string;
  description: string;
  category: EventCategory;
  era_id: EraId;
  /** Instant effect (applied immediately if no choices). */
  effect?: EventEffect;
  /** If present, player must choose one option. */
  choices?: EventChoice[];
  /** When true, all players see the card (not just the current player). */
  affects_all_players?: boolean;
  /** Populated server-side after applying an instant effect — carries result details for the UI. */
  result_summary?: Array<{ territory_id: string; name: string; delta: number }>;
}

export interface TemporaryModifier {
  type: EventEffectType;
  value: number;
  turns_remaining: number;
}

// ── Combat ────────────────────────────────────────────────────────────────────
export interface CombatResult {
  attacker_rolls: number[];
  defender_rolls: number[];
  attacker_losses: number;
  defender_losses: number;
  territory_captured: boolean;
  error?: string;
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
