import { create } from 'zustand';
import type { GamePhase } from '@borderfall/shared';
import { useUiStore } from './uiStore';

export interface TerritoryState {
  territory_id: string;
  owner_id: string | null;
  unit_count: number;
  unit_type: string;
  buildings?: string[];
  production_bonus?: number;
  naval_units?: number;
  stability?: number;
  population?: number;
}

export interface SecretMissionPayload {
  kind: 'capture_territories' | 'eliminate_player' | 'control_regions';
  territory_ids?: [string, string];
  target_player_id?: string;
  region_ids?: string[];
}

export interface PlayerState {
  player_id: string;
  player_index: number;
  username: string;
  color: string;
  is_ai: boolean;
  ai_difficulty?: string | null;
  is_eliminated: boolean;
  territory_count: number;
  cards: { card_id: string; symbol: string }[];
  mmr: number;
  capital_territory_id?: string | null;
  secret_mission?: SecretMissionPayload | null;
  faction_id?: string | null;
  tech_points?: number;
  unlocked_techs?: string[];
  special_resource?: number;
  ability_uses?: Record<string, number>;
  temporary_modifiers?: { type: string; value: number; turns_remaining: number; source: string }[];
  used_game_abilities?: string[];
  /** Pending retaliation bonuses: +dice_bonus attack dice on next land attack vs against_player_id. */
  truce_break_retaliations?: Array<{ against_player_id: string; dice_bonus: number }>;
  /** Space Age: true when the player has triggered launch_space_station ability (gates moon access). */
  space_station_launched?: boolean;
  pending_pre_attack_damage?: number;
  pending_extra_attack_die?: boolean;
  pending_ignore_defense_building?: boolean;
  pending_negate_attacker_losses?: boolean;
  march_to_sea_active?: boolean;
  /** ACW Total War: chain captures that have received the +1 die bonus (0–3). */
  march_to_sea_hops_used?: number;
  /** ACW Total War: territory captured in the prior chain hop. */
  march_to_sea_last_capture_id?: string | null;
  current_era_index?: number;
  era_transition_turns_remaining?: number;
  last_turn_production_income?: number;
  era_advancement_tech_echo?: Record<string, number>;
  medieval_signature_charges?: number;
  era_advanced_this_turn?: boolean;
  bonus_fortify_moves?: number;
  pending_tech_discount?: number;
}

export interface GameState {
  game_id: string;
  era: string;
  map_id: string;
  phase: GamePhase;
  current_player_index: number;
  starting_player_index?: number;
  turn_number: number;
  players: PlayerState[];
  territories: Record<string, TerritoryState>;
  card_set_redemption_count: number;
  diplomacy?: Array<{
    player_index_a: number;
    player_index_b: number;
    status: 'neutral' | 'truce' | 'nap' | 'war';
    truce_turns_remaining: number;
  }>;
  pending_truces?: Array<{ proposer_id: string; target_id: string }>;
  settings: {
    fog_of_war: boolean;
    turn_timer_seconds: number;
    diplomacy_enabled: boolean;
    async_mode?: boolean;
    async_turn_deadline_seconds?: number;
    tutorial?: boolean;
    tutorial_step?: number;
    tutorial_lesson_module?: 'core' | 'advanced_settings' | 'faction_ability' | 'tech_tree';
    tutorial_grant_tech_points?: number;
    tutorial_settings_lab_applied?: boolean;
    victory_type?: string;
    allowed_victory_conditions?: string[];
    victory_threshold?: number;
    factions_enabled?: boolean;
    economy_enabled?: boolean;
    tech_trees_enabled?: boolean;
    events_enabled?: boolean;
    naval_enabled?: boolean;
    stability_enabled?: boolean;
    coaching_enabled?: boolean;
    era_advancement_enabled?: boolean;
    era_advancement_cost_mult?: number;
    era_advancement_cost_escalation?: number;
    era_advancement_max_era_index?: number;
    era_advancement_tech_gate_pct?: number;
    era_advancement_tech_gate_mode?: 'milestone' | 'percent';
    era_advancement_min_tier1_techs?: number;
    era_advancement_min_tier2_techs?: number;
    era_advancement_min_buildings?: number;
    economy_tech_starting_tech_points?: number;
    economy_tech_starting_gold?: number;
    era_advancement_stability_gate?: number;
    daily_challenge_date?: string;
    /** True when this game is an era of a solo campaign. Set server-side in campaign.routes.ts. */
    is_campaign?: boolean;
    campaign_path_id?: string;
    /** Faction id that the human player is locked into for the current era. */
    campaign_locked_faction?: string;
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
    /** Numeric carry-forward stats for the campaign engine. */
    campaign_carry?: { survivor_bonus?: number; revolutionary_spirit?: number };
    /** Attack bonus from prior-era prestige (applied for first 3 turns). */
    campaign_prestige_bonus?: number;
    /** Daily puzzle metadata (when playing a daily challenge). */
    daily_challenge_spec?: {
      archetype?: string;
      title?: string;
      intro?: string;
      goal?: string;
      hint?: string;
      max_turns?: number;
      player_count?: number;
    };
  };
  era_modifiers?: {
    legion_reroll?: boolean;
    castle_fortification?: boolean;
    sea_lanes?: boolean;
    wartime_logistics?: boolean;
    influence_spread?: boolean;
    influence_range?: number;
    precision_strike?: boolean;
    rifle_doctrine?: boolean;
    carbonari_network?: boolean;
  };
  /** Server-authoritative; may be absent on older saved games. */
  draft_units_remaining?: number;
  turn_started_at: number;
  /**
   * Server-authoritative deadline (Unix ms) for the current phase's timer.
   * Re-armed per phase (including timeout auto-advances). Absent on older
   * servers — fall back to turn_started_at + turn_timer_seconds.
   */
  phase_deadline_at?: number | null;
  winner_id?: string;
  win_probability_history?: Array<{
    step: number;
    turn: number;
    probabilities: Record<string, number>;
  }>;
  coaching_eligible?: boolean;
  blitzkrieg_active?: boolean;
  blitzkrieg_bonus_attacks_remaining?: number;
  blitzkrieg_bonus_source_id?: string | null;
}

export interface CombatResult {
  attacker_rolls: number[];
  defender_rolls: number[];
  attacker_losses: number;
  defender_losses: number;
  territory_captured: boolean;
  attacker_bonus_breakdown?: {
    tech?: number;
    faction?: number;
    event?: number;
    pending?: number;
    total?: number;
    [key: string]: number | undefined;
  };
  defender_bonus_breakdown?: {
    building?: number;
    tech?: number;
    faction?: number;
    event?: number;
    wonder?: number;
    sea?: number;
    total?: number;
    [key: string]: number | undefined;
  };
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
  fromName?: string;
  toName?: string;
  attackerId?: string | null;
  defenderId?: string | null;
  attackerName?: string;
  defenderName?: string;
}

interface GameStoreState {
  gameState: GameState | null;
  lastCombatResult: CombatResult | null;
  draftUnitsRemaining: number;
  hasMovedThisTurn: boolean;
  hasEarnedCardThisTurn: boolean;

  /** Replay Theater */
  replayMode: boolean;
  replaySnapshots: GameState[];
  replayFrame: number;

  setGameState: (state: GameState) => void;
  setLastCombatResult: (result: CombatResult | null) => void;
  setDraftUnitsRemaining: (n: number) => void;
  setHasMovedThisTurn: (v: boolean) => void;
  loadReplay: (snapshots: GameState[]) => void;
  setReplayFrame: (n: number) => void;
  clearGame: () => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  gameState: null,
  lastCombatResult: null,
  draftUnitsRemaining: 0,
  hasMovedThisTurn: false,
  hasEarnedCardThisTurn: false,

  replayMode: false,
  replaySnapshots: [],
  replayFrame: 0,

  setGameState: (state) => set({ gameState: state }),
  setLastCombatResult: (result) => set({ lastCombatResult: result }),
  setDraftUnitsRemaining: (n) => set({ draftUnitsRemaining: n }),
  setHasMovedThisTurn: (v) => set({ hasMovedThisTurn: v }),
  loadReplay: (snapshots) => set({ replayMode: true, replaySnapshots: snapshots, replayFrame: 0, gameState: snapshots[0] ?? null }),
  setReplayFrame: (n) => set((s) => ({
    replayFrame: n,
    gameState: s.replaySnapshots[n] ?? null,
  })),
  clearGame: () => {
    useUiStore.getState().reset();
    set({
      gameState: null,
      lastCombatResult: null,
      draftUnitsRemaining: 0,
      hasMovedThisTurn: false,
      hasEarnedCardThisTurn: false,
      replayMode: false,
      replaySnapshots: [],
      replayFrame: 0,
    });
  },
}));
