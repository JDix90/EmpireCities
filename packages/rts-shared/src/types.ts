import { RTS_SCHEMA_VERSION } from './constants.js';

export type RtsSchemaVersion = typeof RTS_SCHEMA_VERSION;

export interface RtsTuning {
  marketIncomeIntervalMs: number;
}

export interface RtsMapNode {
  id: string;
  /** Normalized 0–1 for rendering */
  u: number;
  v: number;
}

export interface RtsMapEdge {
  from: string;
  to: string;
}

export interface RtsFrontierPair {
  thisNode: string;
  neighborNode: string;
}

export interface RtsTerritoryTerrain {
  nodes: RtsMapNode[];
  edges: RtsMapEdge[];
  /** One pair per connection to a neighbor (undirected) */
  frontiers: Record<string, RtsFrontierPair[]>;
  /** Where new units and initial stack appear */
  spawnNodeId: string;
}

export interface RtsMapTerrain {
  mapId: string;
  territories: Record<string, RtsTerritoryTerrain>;
}

export type RtsPhase = 'lobby' | 'picking' | 'playing' | 'ended';

export interface RtsPlayer {
  playerIndex: number;
  userId: string;
  color: string;
  gold: number;
}

export interface RtsTerritory {
  name: string;
  /** null = neutral */
  ownerPlayerIndex: number | null;
  hasTownHall: boolean;
  hasMarket: boolean;
}

export type RtsWorkAssignment = {
  kind: 'market';
  territoryId: string;
  /**
   * Game-time tick (ms) at which the unit was assigned. Income only counts
   * units whose assignment is at least one full income interval old, so
   * rapid-fire assign/unassign cycles cannot harvest extra gold by toggling
   * around the tick boundary.  Optional for back-compat with saved games
   * created before the anti-flicker rule was introduced; missing values are
   * treated as "grandfathered" (earn from the very next tick).
   */
  assignedAtMs?: number;
};

export interface RtsUnit {
  id: string;
  playerIndex: number;
  territoryId: string;
  nodeId: string;
  work: RtsWorkAssignment | null;
}

export interface RtsPendingClaim {
  playerIndex: number;
  territoryId: string;
}

export interface RtsGameState {
  schemaVersion: RtsSchemaVersion;
  mapId: string;
  phase: RtsPhase;
  /** Monotonic game time in ms, advanced by server tick; used for income. */
  gameTimeMs: number;
  lastIncomeAccrualTimeMs: number;
  tuning: RtsTuning;
  players: RtsPlayer[];
  /** All territory ids on map */
  territoryOrder: string[];
  territories: Record<string, RtsTerritory>;
  units: RtsUnit[];
  /** Picks in order: which player must pick next (one start each) */
  pickingOrder: number[];
  /** Territory ids still available for start pick */
  availableStartIds: string[];
  winnerPlayerIndex: number | null;
  /** When a neutral has 2+ units of a player, that player must resolve. */
  pendingClaim: RtsPendingClaim | null;
}

export type RtsCommandResult =
  | { ok: true; state: RtsGameState }
  | { ok: false; error: string };
