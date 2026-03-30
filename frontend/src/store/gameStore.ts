import { create } from 'zustand';

export interface TerritoryState {
  territory_id: string;
  owner_id: string | null;
  unit_count: number;
  unit_type: string;
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
}

export interface GameState {
  game_id: string;
  era: string;
  map_id: string;
  phase: 'draft' | 'attack' | 'fortify' | 'game_over';
  current_player_index: number;
  turn_number: number;
  players: PlayerState[];
  territories: Record<string, TerritoryState>;
  card_set_redemption_count: number;
  settings: {
    fog_of_war: boolean;
    turn_timer_seconds: number;
    diplomacy_enabled: boolean;
  };
  draft_units_remaining: number;
  turn_started_at: number;
  winner_id?: string;
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
  selectedTerritory: string | null;
  attackSource: string | null;
  lastCombatResult: CombatResult | null;
  draftUnitsRemaining: number;
  hasMovedThisTurn: boolean;
  hasEarnedCardThisTurn: boolean;

  setGameState: (state: GameState) => void;
  setSelectedTerritory: (id: string | null) => void;
  setAttackSource: (id: string | null) => void;
  setLastCombatResult: (result: CombatResult | null) => void;
  setDraftUnitsRemaining: (n: number) => void;
  setHasMovedThisTurn: (v: boolean) => void;
  clearGame: () => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  gameState: null,
  selectedTerritory: null,
  attackSource: null,
  lastCombatResult: null,
  draftUnitsRemaining: 0,
  hasMovedThisTurn: false,
  hasEarnedCardThisTurn: false,

  setGameState: (state) => set({ gameState: state }),
  setSelectedTerritory: (id) => set({ selectedTerritory: id }),
  setAttackSource: (id) => set({ attackSource: id }),
  setLastCombatResult: (result) => set({ lastCombatResult: result }),
  setDraftUnitsRemaining: (n) => set({ draftUnitsRemaining: n }),
  setHasMovedThisTurn: (v) => set({ hasMovedThisTurn: v }),
  clearGame: () => set({
    gameState: null,
    selectedTerritory: null,
    attackSource: null,
    lastCombatResult: null,
    draftUnitsRemaining: 0,
    hasMovedThisTurn: false,
    hasEarnedCardThisTurn: false,
  }),
}));
