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

/** Undirected adjacency map (territory id → neighbor ids) built once per call. */
function buildAdjacency(connections: MapConnection[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const conn of connections) {
    add(conn.from, conn.to);
    add(conn.to, conn.from);
  }
  return adj;
}

/**
 * Territories reachable from `sourceId` through a connected chain of territories
 * all owned by `ownerId` — the client mirror of the backend fortify `pathExists`
 * BFS (gameSocket.ts). Excludes the source itself. Used to decide whether a
 * territory is a valid fortify SOURCE (can it move anywhere?) and, for the map,
 * which owned territories a selected source can reach beyond direct neighbors.
 *
 * Advisory only — the server stays authoritative. Like the backend BFS it walks
 * every connection type (land/sea/orbit); the optional `filter` scopes results
 * to the active world for galaxy maps.
 */
export function computeFortifyReachable(
  gameState: GameState,
  connections: MapConnection[],
  sourceId: string,
  ownerId: string,
  filter: (territoryId: string) => boolean = () => true,
): Set<string> {
  const reachable = new Set<string>();
  if (!gameState) return reachable;
  const adjacency = buildAdjacency(connections);
  const visited = new Set<string>([sourceId]);
  const queue: string[] = [sourceId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      // Mirror pathExists: only traverse (and count) territories the owner holds.
      if (!visited.has(neighbor) && gameState.territories[neighbor]?.owner_id === ownerId && filter(neighbor)) {
        visited.add(neighbor);
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return reachable;
}

/**
 * The set of territories the viewer can act FROM this phase — the "which of my
 * territories can do something?" hint that guides a new player's first click:
 *  - attack:  owned, ≥2 units, and bordering at least one valid attack target
 *             (enemy, or an era-advancement neutral frontier).
 *  - fortify: owned, ≥2 units (must leave one behind), and able to reach at least
 *             one other owned territory via a connected friendly path.
 * Empty outside attack/fortify. Advisory — the server validates every action.
 *
 * Turn-level gates that aren't adjacency rules (era-advanced-this-turn lockout,
 * fortify-move-limit) are applied by the caller (see GamePage's validSourceOwnerId).
 * Orbit/moon access + sealed-lane gates are NOT mirrored here: on the globe the
 * caller's per-world territoryFilter drops cross-world endpoints, and on maps
 * without orbit lanes it never applies — a residual orbit false-positive just
 * yields the server's clear rejection toast.
 */
export function computeValidSources(
  gameState: GameState,
  connections: MapConnection[],
  viewerId: string | null | undefined,
  options: { territoryFilter?: (territoryId: string) => boolean } = {},
): Set<string> {
  const result = new Set<string>();
  if (!gameState || !viewerId) return result;
  const phase = gameState.phase;
  if (phase !== 'attack' && phase !== 'fortify') return result;

  const filter = options.territoryFilter ?? (() => true);

  for (const [territoryId, territory] of Object.entries(gameState.territories)) {
    if (territory.owner_id !== viewerId) continue;
    if (!filter(territoryId)) continue;
    // ≥2 units: an attack needs 2 (one must stay to hold); a fortify must leave 1 behind.
    if ((territory.unit_count ?? 0) < 2) continue;

    if (phase === 'attack') {
      const targets = computePhaseAdjacencyTargets(gameState, connections, {
        sourceTerritoryId: territoryId,
        attackSource: territoryId,
        territoryFilter: options.territoryFilter,
      });
      if (targets.size > 0) result.add(territoryId);
    } else {
      const reachable = computeFortifyReachable(gameState, connections, territoryId, viewerId, filter);
      if (reachable.size > 0) result.add(territoryId);
    }
  }

  return result;
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

  // Off-world neutrals (the Space Age Moon, neutral galaxy worlds) are reached via
  // `orbit` connections. The backend allows conquering them once the attacker holds
  // orbit access — in ANY mode, including standalone Space Age (executeLandAttack's
  // neutralOffworldCaptureAllowed path), not just era-advancement games. Collect the
  // source's orbit-connected neighbors so we can admit them below.
  const orbitNeighbors = new Set<string>();
  for (const conn of connections) {
    if (conn.type !== 'orbit') continue;
    if (conn.from === source) orbitNeighbors.add(conn.to);
    else if (conn.to === source) orbitNeighbors.add(conn.from);
  }

  for (const neighborId of neighborsOf(source, connections)) {
    if (!filter(neighborId)) continue;
    const neighborOwner = gameState.territories[neighborId]?.owner_id;

    if (gameState.phase === 'attack') {
      if (neighborOwner && neighborOwner !== sourceOwner) {
        result.add(neighborId);
      } else if (!neighborOwner && (gameState.settings?.era_advancement_enabled === true || orbitNeighbors.has(neighborId))) {
        // Neutral (unowned) capturable targets the UI must offer or they'd be
        // invisible:
        //  - era-advancement growth spawns NEUTRAL Earth frontiers (EA games), and
        //  - orbit-connected neutrals are the off-world race (Moon/galaxy), takeable
        //    in any mode once the attacker has access.
        // The picker renders orbit targets with a lock when access is denied, and
        // the server stays authoritative on the access check either way. On the
        // globe the caller's per-world `territoryFilter` drops cross-world endpoints
        // (line above), so the Moon only surfaces in the unfiltered quick-list.
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
  /**
   * Reached via an `orbit` (hyperspace) connection — i.e. this target sits on a
   * different world. Drives the hyperspace treatment + lock badge in the picker
   * so a cross-world strike never reads as a plain land attack.
   */
  isOrbit: boolean;
  /** Destination world's display name (only set for orbit / cross-world targets). */
  targetWorldName?: string;
}

export function listNeighborTargets(
  gameState: GameState,
  connections: MapConnection[],
  sourceTerritoryId: string,
  territoryNames: Map<string, string>,
  options: {
    attackSource?: string | null;
    territoryFilter?: (id: string) => boolean;
    /** Resolve a territory's world display name (galaxy maps) for orbit targets. */
    worldNameOf?: (territoryId: string) => string | undefined;
  } = {},
): NeighborTargetRow[] {
  const targets = computePhaseAdjacencyTargets(gameState, connections, {
    sourceTerritoryId,
    attackSource: options.attackSource ?? sourceTerritoryId,
    territoryFilter: options.territoryFilter,
  });

  const seaPairs = new Set<string>();
  const orbitPairs = new Set<string>();
  for (const conn of connections) {
    if (conn.type === 'sea') {
      seaPairs.add(`${conn.from}:${conn.to}`);
      seaPairs.add(`${conn.to}:${conn.from}`);
    } else if (conn.type === 'orbit') {
      orbitPairs.add(`${conn.from}:${conn.to}`);
      orbitPairs.add(`${conn.to}:${conn.from}`);
    }
  }

  const source = options.attackSource ?? sourceTerritoryId;
  const rows: NeighborTargetRow[] = [];

  for (const territoryId of targets) {
    const tState = gameState.territories[territoryId];
    if (!tState) continue;
    const owner = gameState.players.find((pl) => pl.player_id === tState.owner_id);
    const isSea = seaPairs.has(`${source}:${territoryId}`);
    const isOrbit = orbitPairs.has(`${source}:${territoryId}`);
    rows.push({
      territoryId,
      name: territoryNames.get(territoryId) ?? territoryId,
      unitCount: tState.unit_count === -1 ? -1 : tState.unit_count,
      ownerName: owner?.username,
      isSea,
      isOrbit,
      targetWorldName: isOrbit ? options.worldNameOf?.(territoryId) : undefined,
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
