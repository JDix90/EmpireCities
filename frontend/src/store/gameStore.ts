import { create } from 'zustand';
import type { GamePhase } from '@erasofempire/shared';
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
}

export interface GameState {
  game_id: string;
  era: string;
  map_id: string;
  phase: GamePhase;
  current_player_index: number;
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
  settings: {
    fog_of_war: boolean;
    turn_timer_seconds: number;
    diplomacy_enabled: boolean;
    async_mode?: boolean;
    async_turn_deadline_seconds?: number;
    tutorial?: boolean;
    tutorial_step?: number;
    victory_type?: string;
    allowed_victory_conditions?: string[];
    victory_threshold?: number;
    factions_enabled?: boolean;
    economy_enabled?: boolean;
    tech_trees_enabled?: boolean;
    events_enabled?: boolean;
    naval_enabled?: boolean;
    stability_enabled?: boolean;
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
  winner_id?: string;
  win_probability_history?: Array<{
    step: number;
    turn: number;
    probabilities: Record<string, number>;
  }>;
}

export interface CombatResult {
  attacker_rolls: number[];
  defender_rolls: number[];
  attacker_losses: number;
  defender_losses: number;
  territory_captured: boolean;
  fromName?: string;
  toName?: string;
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
