// ============================================================
// Shared backend types for Borderfall
// ============================================================

import type {
  GamePhase,
  ConnectionType,
  MapConnectionEdge,
  MapKind,
  OrbitAccessMode,
  MapWorldDefinition,
} from '@borderfall/shared';

export type { GamePhase, ConnectionType, MapConnectionEdge, MapKind, OrbitAccessMode, MapWorldDefinition };

export type EraId = 'ancient' | 'medieval' | 'discovery' | 'ww2' | 'coldwar' | 'modern' | 'acw' | 'risorgimento' | 'space_age' | 'galaxy_age' | 'custom';
export type GameStatus = 'waiting' | 'in_progress' | 'completed' | 'abandoned';
export type VictoryType = 'domination' | 'secret_mission' | 'capital' | 'threshold';
/** Victory condition that ended the game, including fallback for last-player-standing. */
export type VictoryConditionKey = VictoryType | 'last_standing' | 'alliance_victory' | 'abandoned';

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
  admin?: boolean;
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
  /** Legacy globe discriminator (Space Age). Prefer `world_id` on maps that define it. */
  globe_id?: 'earth' | 'moon';
  /** Canonical world id mirrored from map data for multi-world games. */
  world_id?: string;
  /**
   * Region/continent the territory belongs to (mirrored from `MapTerritory.region_id`
   * at game-start). Some event effects target a region by id (e.g. "Plague hits
   * Western Europe" removing units only from that area). Denormalizing the value
   * avoids handing the heavy map document through every effect handler.
   *
   * Optional because pre-snapshot game state from older saves may not have it.
   */
  region_id?: string;
}

export interface PlayerState {
  player_id: string;        // user_id or 'ai_<index>'
  player_index: number;
  username: string;
  color: string;
  is_ai: boolean;
  ai_difficulty?: AiDifficulty;
  is_eliminated: boolean;
  /** True when the player voluntarily resigned (ranks below other eliminated players). */
  has_resigned?: boolean;
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
  /** Cumulative draft-unit bonus accrued from card redemptions this game. */
  card_set_bonus_units?: number;
  /** High-water mark of territory count (updated whenever territory_count changes). */
  peak_territory_count?: number;
  /** Territories captured in the current turn; reset at turn start (blitzkrieg achievement). */
  territories_captured_this_turn?: number;
  /**
   * True once this player has received a territory card on the current turn.
   * Classic Risk rule: max one card per turn regardless of capture count.
   * Reset to false at turn start in `advanceToNextPlayer`.
   */
  card_earned_this_turn?: boolean;
  /** Max territories captured in any single turn this game (blitzkrieg achievement). */
  territories_captured_turn_max?: number;
  /** Player IDs with whom this player has established at least one truce (diplomat achievement). */
  truces_established?: string[];
  /** ID of the last opponent this player attacked (used for event card truce targeting). */
  last_attacked_player_id?: string;
  /**
   * Pending retaliation bonuses earned when an opponent broke a truce with this player.
   * Each entry grants +dice_bonus attack dice on the player's NEXT land attack against
   * `against_player_id`. The entry is consumed (removed) after the first such attack,
   * regardless of combat outcome.
   */
  truce_break_retaliations?: Array<{ against_player_id: string; dice_bonus: number }>;
  /** Space Age: true after the player has used the launch_space_station ability (Moon-gating step). */
  space_station_launched?: boolean;
  /** Bonus defender losses applied before the next land attack resolves (air_strike). */
  pending_pre_attack_damage?: number;
  /** +1 attack die on the next land attack (knights_charge, bersaglieri_charge). */
  pending_extra_attack_die?: boolean;
  /** Next land attack ignores defense-building bonus (activated siege abilities). */
  pending_ignore_defense_building?: boolean;
  /** Next land attack the player makes inflicts 0 attacker losses (testudo). */
  pending_negate_attacker_losses?: boolean;
  /** Extra fortify moves granted this turn (armored_push). Reset at turn start. */
  bonus_fortify_moves?: number;
  /**
   * Per-turn defensive charge (greek_fire / great_wall) consumed on the first
   * attack against this player each turn. Reset for all players at every turn
   * transition in advanceToNextPlayer.
   */
  defensive_charge_used_this_turn?: boolean;
  /** Per-turn influence-block charge (papal_dispensation). Reset at turn start. */
  influence_block_used_this_turn?: boolean;
  /**
   * Tech-point discount applied to the player's NEXT research (House of Wisdom).
   * Consumed (reset to 0) when a tech is applied. Effective cost never drops below 1.
   */
  pending_tech_discount?: number;
  /** ACW Total War: chain attacks enabled for remainder of turn after activation. */
  march_to_sea_active?: boolean;
  /** ACW Total War: number of consecutive chain captures that have received the +1 die bonus (0–3). */
  march_to_sea_hops_used?: number;
  /** ACW Total War: territory captured in the prior chain hop; the next hop must continue from here. */
  march_to_sea_last_capture_id?: string | null;
  /** Per-player era tier when era advancement is enabled (0 = Ancient in PoC). */
  current_era_index?: number;
  /** Turns remaining in post-advance vulnerability window (defense penalty). */
  era_transition_turns_remaining?: number;
  /** Gross production income from the prior economy tick (advancement cost basis). */
  last_turn_production_income?: number;
  /** Permanent passive bonuses echoed from prior-era completed tech. */
  era_advancement_tech_echo?: Record<string, number>;
  /** PoC signature payoff: +1 attack die on next land combat. */
  medieval_signature_charges?: number;
  /** Set when advancing during attack phase — blocks further attacks this turn. */
  era_advanced_this_turn?: boolean;
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
  /** Active lesson pack when `tutorial` is true (core, advanced_settings, faction_ability, tech_tree). */
  tutorial_lesson_module?: 'core' | 'advanced_settings' | 'faction_ability' | 'tech_tree';
  /** Bonus TP granted at tutorial module start (tech_tree lesson). */
  tutorial_grant_tech_points?: number;
  /** True after Settings Lab choices are applied in the advanced_settings lesson. */
  tutorial_settings_lab_applied?: boolean;
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
  /** Starting tech points when economy + tech trees are enabled (non-tutorial). */
  economy_tech_starting_tech_points?: number;
  /** Starting gold when economy + tech trees are enabled (non-tutorial). */
  economy_tech_starting_gold?: number;
  /** Enable era-specific event cards that fire each game round. */
  events_enabled?: boolean;
  /** Enable naval warfare: fleets, ports, sea-lane gating. */
  naval_enabled?: boolean;
  /** Enable population stability mechanics. */
  stability_enabled?: boolean;
  /** Players take turns selecting starting territories instead of auto-assignment. */
  territory_selection?: boolean;
  /**
   * In-turn coaching opt-in. Surfaces a single advisory tip at the start of
   * each human draft phase. Server-side eligibility (1 human + all AI + unranked)
   * is enforced separately via `GameState.coaching_eligible`; this flag is the
   * player's preference *within* an eligible game.
   */
  coaching_enabled?: boolean;
  /** Mid-match per-player era advancement (PoC: Ancient → Medieval). */
  era_advancement_enabled?: boolean;
  era_advancement_conversion_ratio?: number;
  era_advancement_strength_step?: number;
  era_advancement_cost_step?: number;
  era_advancement_cost_mult?: number;
  era_advancement_cost_escalation?: number;
  era_advancement_stability_gate?: number;
  era_advancement_tech_gate_pct?: number;
  era_advancement_tech_gate_mode?: 'milestone' | 'percent';
  era_advancement_min_tier1_techs?: number;
  era_advancement_min_tier2_techs?: number;
  era_advancement_min_buildings?: number;
  era_advancement_vuln_defense_mult?: number;
  era_advancement_vuln_turns?: number;
  era_advancement_max_era_index?: number;
  era_advancement_combat_gap_dice?: number;
  /** True when this game is part of a campaign sequence. */
  is_campaign?: boolean;
  /** Attack bonus units from campaign prestige carry-over (applied for first 3 turns). */
  campaign_prestige_bonus?: number;
  /** Campaign path identifier — determines locked factions, narrative text, and carry stat rules. */
  campaign_path_id?: string;
  /** Faction id that the human player is locked into for this era (faction picker disabled). */
  campaign_locked_faction?: string;
  /** Numeric carry-forward stats injected from path_carry at game creation time. */
  campaign_carry?: {
    survivor_bonus?: number;
    revolutionary_spirit?: number;
  };
  /** Display: campaign path name (e.g. "Blood & Empire") or "Classic Campaign". */
  campaign_path_name?: string;
  /** Display: campaign path tagline shown in the era intro modal. */
  campaign_path_tagline?: string;
  /** Display: human-readable label for the active path's signature carry stat. */
  campaign_signature_carry_label?: string;
  /** Display: 0-based era index inside the campaign. */
  campaign_era_index?: number;
  /** Display: total era count for this campaign (typically 6). */
  campaign_era_count?: number;
  /** Display: narrative intro text for this era (path campaigns only). */
  campaign_intro_text?: string;
  /** Daily challenge date (YYYY-MM-DD) when this session is the daily. */
  daily_challenge_date?: string;
  /** Serialized daily puzzle spec from `daily_challenges.spec_json`. */
  daily_challenge_spec?: Record<string, unknown>;
  /** Lobby / daily generator seed. */
  seed?: number;
  /** Snapshot of economy tuning used for this game instance. */
  economy_snapshot?: {
    building_costs?: Partial<Record<BuildingType, number>>;
    production_income?: Partial<Record<BuildingType, number>>;
  };
  /** Snapshot of XP tuning used for this game instance. */
  xp_snapshot?: {
    base?: number;
    win_bonus?: number;
    per_territory?: number;
    placement_bonus_max?: number;
    multipliers?: Partial<Record<'solo' | 'multiplayer' | 'hybrid', number>>;
  };
  max_players?: number;
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
  // Space Age
  space_program?: boolean;
}

/** Building tiers: production (income), defense (dice/fortify), tech generation, era specials, and era wonders. */
export type BuildingType =
  | 'production_1' | 'production_2' | 'production_3'
  | 'defense_1' | 'defense_2' | 'defense_3'
  | 'tech_gen_1' | 'tech_gen_2'
  | 'special_a' | 'special_b'
  | 'port' | 'naval_base' | 'coastal_battery'
  | 'wonder_colosseum'   // ancient
  | 'wonder_cathedral'   // medieval
  | 'wonder_lighthouse'  // discovery
  | 'wonder_manhattan'   // ww2
  | 'wonder_sputnik'     // coldwar
  | 'wonder_cern'        // modern
  | 'wonder_arsenal'     // acw
  | 'wonder_unification' // risorgimento
  | 'launch_pad'         // space_age: orbital launch infrastructure
  | 'wonder_space_elevator' // space_age
  | 'wonder_hyperlane_anchor'; // galaxy_age

/** Snapshots for end-of-game win-probability chart (territory + army blend, renormalized). */
export interface WinProbabilitySnapshot {
  step: number;
  turn: number;
  probabilities: Record<string, number>; // player_id → 0–1
}

/** Categorization of a logged player decision; powers post-match turning-point analysis. */
export type ActionDecisionType =
  | 'attack'
  | 'naval_attack'
  | 'fortify'
  | 'naval_move'
  | 'draft'
  | 'redeem_cards'
  | 'build'
  | 'research'
  | 'advance_era'
  | 'ability'
  | 'influence'
  | 'event_choice';

/**
 * Per-action win-probability attribution. The server captures a player's win
 * probability immediately before and after each mutating action; the delta is
 * the exact, observed contribution of that decision to the eventual outcome.
 *
 * Lives in-memory on the Room object during the game; persisted into
 * match_insight_reports.insights_json at finalize time so post-game analysis
 * can identify true turning points without inferring causation from outcomes.
 */
export interface ActionDecision {
  step: number;
  turn: number;
  player_id: string;
  action_type: ActionDecisionType;
  summary: string;
  prob_before: number;
  prob_after: number;
  prob_delta: number;
}

/** Categories of in-turn coaching tips, ranked by display priority (lower = higher priority). */
export type CoachingTipCategory =
  | 'probability_drop'      // Win prob dropped meaningfully last turn — diagnostic
  | 'opponent_region_threat' // Opponent close to completing a region — defensive warning
  | 'region_opportunity'     // Player close to completing a region — offensive opportunity
  | 'thin_border';           // Owned border territory has 1 unit next to enemy

/**
 * A single coaching tip surfaced at the start of a human player's turn.
 * Only one tip is emitted per turn (highest priority detector wins). Suppressed
 * when no detector fires.
 */
export interface CoachingTip {
  turn: number;
  category: CoachingTipCategory;
  title: string;
  body: string;
}

export interface GameState {
  game_id: string;
  era: EraId;
  map_id: string;
  phase: GamePhase;
  current_player_index: number;
  /** Seat index chosen to act first at game start (randomized except tutorial/campaign/daily). */
  starting_player_index?: number;
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
  /** Per-draft-phase cumulative unit placements by territory (stability cap enforcement). */
  draft_placements_this_turn?: Record<string, number>;
  turn_started_at: number;       // Unix timestamp ms
  /**
   * Server-authoritative deadline (Unix ms) for the current phase's turn timer.
   * Reset every time the timer is (re)armed — including the fresh per-phase timer
   * granted after a timeout auto-advance — so client countdowns never go stale.
   * Null/absent when no timer is running (timer disabled or AI turn).
   */
  phase_deadline_at?: number | null;
  /** Unix ms timestamp when the game first transitioned to `in_progress`. Used for post-game duration. */
  game_started_at?: number;
  winner_id?: string;
  /** All winner IDs — more than one when alliance_victory occurs. */
  winner_ids?: string[];
  /** Which victory condition triggered the win. */
  victory_condition?: VictoryConditionKey;
  win_probability_history?: WinProbabilitySnapshot[];
  /**
   * True when the game qualifies for in-turn coaching: exactly one human
   * player, every other player is AI, and the game is not ranked. Locked at
   * game start; the human can still opt in/out via `settings.coaching_enabled`.
   */
  coaching_eligible?: boolean;
  era_modifiers?: EraModifiers;
  /** Number of fortify moves used this turn (limit enforced by wartime_logistics). */
  fortify_moves_used?: number;
  /** Turns remaining before the influence ability can be used again (0 = ready). */
  influence_cooldown_remaining?: number;
  /** Whether a Blitzkrieg (WW2) bonus attack has been used this turn. */
  blitzkrieg_attacked?: boolean;
  /**
   * Blitzkrieg active flag — set when the player activates the ability. While
   * true, the next territory the player captures unlocks a one-shot bonus
   * attack originating from the same source territory. Cleared when the
   * bonus is consumed or the turn ends.
   */
  blitzkrieg_active?: boolean;
  /**
   * Source territory id of the pending bonus attack. Non-null only between a
   * Blitzkrieg-eligible capture and the first attack from that same source.
   */
  blitzkrieg_bonus_source_id?: string | null;
  /**
   * Remaining Blitzkrieg bonus attacks this turn. Blitzkrieg arms 1; Double
   * Blitz (WW2 tech) arms 2. Each capture re-arms the bonus source while this
   * is > 0; each resolved bonus attack decrements it.
   */
  blitzkrieg_bonus_attacks_remaining?: number;
  /** Currently active event card awaiting resolution (events feature). */
  active_event?: EventCard;
  /** Transient: result of last instant event effect application (cleared after broadcast). */
  active_event_result?: EventEffectResult;
  /** Seasonal event cards injected at game start — merged into era deck when drawing. */
  seasonal_event_cards?: EventCard[];
  /** Transient: territory IDs that rebelled last tick (cleared after broadcast). */
  last_rebellion_territories?: string[];
  /** Daily puzzle: deterministic d6 stream for combat (Tier B). */
  puzzle_dice_queue?: number[];
  puzzle_dice_index?: number;
  puzzle_feedback_mistakes?: number;
  /** Set when a non-domination daily objective was achieved. */
  puzzle_objective_met?: boolean;
  /**
   * Random 128-bit salt used to seed secret-mission and capital-placement
   * RNGs. Generated server-side at game init; NEVER sent to clients (stripped
   * in `buildClientState`). Without this, a malicious client knowing the
   * public `game_id` could re-run `assignSecretMissions` locally to mine
   * every opponent's objective. The salt guarantees the PRNG stream is
   * unknowable to the client even though `game_id` is public.
   */
  mission_seed_salt?: string;
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
  | 'stability_change'
  | 'tech_bonus';

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
  /** Reinforcement bonus added to the current player's draft pool (not map auto-place). */
  draft_units_granted?: number;
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
  /** Optional server-computed attribution for why extra attack dice were granted. */
  attacker_bonus_breakdown?: {
    tech?: number;
    faction?: number;
    event?: number;
    total?: number;
  };
  /** Optional server-computed attribution for why extra defense dice were granted. */
  defender_bonus_breakdown?: {
    building?: number;
    tech?: number;
    faction?: number;
    event?: number;
    wonder?: number;
    sea?: number;
    total?: number;
  };
  /** Active/passive combat abilities that affected this exchange. */
  combat_ability_callouts?: Array<{
    id:
      | 'knights_charge'
      | 'cannon_barrage'
      | 'war_elephants'
      | 'ambush'
      | 'banzai_charge'
      | 'bersaglieri_charge'
      | 'siege_assault'
      | 'gunpowder_passive'
      | 'testudo'
      | 'air_strike'
      | 'extra_attack_die';
    detail?: string;
  }>;
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
  /** Which globe this territory belongs to (Space Age multi-globe support). Defaults to 'earth' when omitted. */
  globe_id?: 'earth' | 'moon';
  /** Canonical world id for multi-world / galaxy maps. */
  world_id?: string;
  /** Normalized disc coordinates [0–1, 0–1] for galaxy strategic view layout. */
  galaxy_position?: [number, number];
  /**
   * Optional per-territory globe diffuse / bump (Galactic Age Option A: each chart
   * node can show its own sphere skin while geo_polygons stay on the parent world).
   */
  globe_image_url?: string;
  bump_image_url?: string;
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
  /** Strategic galaxy overview + per-world globes when `galaxy`. */
  map_kind?: MapKind;
  /** Authored globe skins / labels / orbit-access flags per world (galaxy maps). */
  worlds?: MapWorldDefinition[];
  /** Overrides era-based defaults for orbit / hyperspace gating. */
  orbit_access?: OrbitAccessMode;
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
