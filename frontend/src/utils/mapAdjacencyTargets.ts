import type { GameState } from '../store/gameStore';

export interface MapConnection {
  from: string;
  to: string;
  type?: 'land' | 'sea' | 'orbit' | string;
}

export interface AdjacencyTargetOptions {
  /** When set, only connections touching this territory are considered. */
  sourceTerritoryId?: string | null;
  /** Active attack source (falls back to selected territory in callers). */
  attackSource?: string | null;
  /** Limit to territories on this world (galaxy maps). */
  territoryFilter?: (territoryId: string) => boolean;
}

function neighborsOf(
  territoryId: string,
  connections: MapConnection[],
): string[] {
  const out: string[] = [];
  for (const conn of connections) {
    if (conn.from === territoryId) out.push(conn.to);
    else if (conn.to === territoryId) out.push(conn.from);
  }
  return out;
}

/**
 * Valid neighbor territories for the current attack / fortify interaction.
 * Mirrors the adjacency arc rules in GlobeMap without depending on arc geometry.
 */
export function computePhaseAdjacencyTargets(
  gameState: GameState,
  connections: MapConnection[],
  options: AdjacencyTargetOptions = {},
): Set<string> {
  const source = options.attackSource ?? options.sourceTerritoryId ?? null;
  if (!source || !gameState) return new Set();

  const sourceOwner = gameState.territories[source]?.owner_id;
  if (!sourceOwner) return new Set();

  const filter = options.territoryFilter ?? (() => true);
  const result = new Set<string>();

  for (const neighborId of neighborsOf(source, connections)) {
    if (!filter(neighborId)) continue;
    const neighborOwner = gameState.territories[neighborId]?.owner_id;

    if (gameState.phase === 'attack') {
      if (neighborOwner && neighborOwner !== sourceOwner) {
        result.add(neighborId);
      }
    } else if (gameState.phase === 'fortify') {
      if (neighborOwner === sourceOwner) {
        result.add(neighborId);
      }
    }
  }

  return result;
}

export interface NeighborTargetRow {
  territoryId: string;
  name: string;
  unitCount: number;
  ownerName?: string;
  isSea: boolean;
}

export function listNeighborTargets(
  gameState: GameState,
  connections: MapConnection[],
  sourceTerritoryId: string,
  territoryNames: Map<string, string>,
  options: { attackSource?: string | null; territoryFilter?: (id: string) => boolean } = {},
): NeighborTargetRow[] {
  const targets = computePhaseAdjacencyTargets(gameState, connections, {
    sourceTerritoryId,
    attackSource: options.attackSource ?? sourceTerritoryId,
    territoryFilter: options.territoryFilter,
  });

  const seaPairs = new Set<string>();
  for (const conn of connections) {
    if (conn.type === 'sea') {
      seaPairs.add(`${conn.from}:${conn.to}`);
      seaPairs.add(`${conn.to}:${conn.from}`);
    }
  }

  const source = options.attackSource ?? sourceTerritoryId;
  const rows: NeighborTargetRow[] = [];

  for (const territoryId of targets) {
    const tState = gameState.territories[territoryId];
    if (!tState) continue;
    const owner = gameState.players.find((pl) => pl.player_id === tState.owner_id);
    const isSea = seaPairs.has(`${source}:${territoryId}`);
    rows.push({
      territoryId,
      name: territoryNames.get(territoryId) ?? territoryId,
      unitCount: tState.unit_count === -1 ? -1 : tState.unit_count,
      ownerName: owner?.username,
      isSea,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
