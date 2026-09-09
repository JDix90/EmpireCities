import type { GameState } from '../store/gameStore';

export interface MapConnection {
  from: string;
  to: string;
  type?: 'land' | 'sea' | 'orbit' | string;
  /**
   * Set to 'launch_pad' on a lane a Launch Pad opened, rather than one the map
   * authored. The Space Age Orbital Blockade may only seal authored lanes, so
   * the client needs to tell them apart to avoid offering a button the server
   * always refuses.
   */
  source?: string;
}

export interface AdjacencyTargetOptions {
  /** When set, only connections touching this territory are considered. */
  sourceTerritoryId?: string | null;
  /** Active attack source (falls back to selected territory in callers). */
  attackSource?: string | null;
  /** Limit to territories on this world (galaxy maps). */
  territoryFilter?: (territoryId: string) => boolean;
  /**
   * Fortify only: offer every territory the source can REACH through a chain of
   * the owner's own ground, not just its direct neighbours — what the server
   * actually allows.
   *
   * Opt-in, and deliberately so. The maps want it, because highlighting a far
   * destination costs nothing extra on a board the player is already looking at.
   * The territory panel's picker must NOT have it: reachability is the size of
   * your connected empire, measured at 25-37 rows on a mid-size map at 60%
   * board control, which is a wall of text on a phone.
   */
  fortifyReachable?: boolean;
  /** Per-edge rule (orbit access, sealed lanes) — see `fortifyTraversalFilter`. */
  canTraverse?: (conn: MapConnection) => boolean;
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
 * Advisory only — the server stays authoritative. The optional `filter` scopes
 * results to the active world for galaxy maps; `canTraverse` mirrors the
 * backend's per-edge fortify rule and is how orbit lanes get excluded.
 *
 * `canTraverse` is not optional in spirit. The backend BFS used to walk every
 * connection type and gate the endpoints afterwards, so walking orbit lanes here
 * matched it. It no longer does: the server refuses a lane the player cannot
 * cross even when the fortify's own endpoints are ordinary land tiles. Callers
 * that omit it get the old, now over-generous answer.
 */
export function computeFortifyReachable(
  gameState: GameState,
  connections: MapConnection[],
  sourceId: string,
  ownerId: string,
  filter: (territoryId: string) => boolean = () => true,
  canTraverse: (conn: MapConnection) => boolean = () => true,
): Set<string> {
  const reachable = new Set<string>();
  if (!gameState) return reachable;
  const adjacency = buildAdjacency(connections.filter(canTraverse));
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
 * Orbit access and sealed lanes ARE mirrored, through `options.canTraverse` —
 * see `fortifyTraversalFilter` in utils/orbitAccess. They used not to be, on the
 * grounds that a stray orbit false-positive only cost the player a rejection
 * toast. That reasoning expired when the server started refusing lanes inside
 * the BFS rather than at the endpoints: a Space Age player with no Launch Pad
 * would otherwise have every Moon tile counted as reachable.
 */
export function computeValidSources(
  gameState: GameState,
  connections: MapConnection[],
  viewerId: string | null | undefined,
  options: {
    territoryFilter?: (territoryId: string) => boolean;
    canTraverse?: (conn: MapConnection) => boolean;
  } = {},
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
      const reachable = computeFortifyReachable(
        gameState, connections, territoryId, viewerId, filter, options.canTraverse,
      );
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

  // Fortify, when the caller asked for the full picture: the server walks any
  // chain of the owner's own territories, so the map can light all of them
  // rather than only the ring of direct neighbours. Same action, same styling —
  // a far destination is not a different move, just a longer one.
  if (gameState.phase === 'fortify' && options.fortifyReachable) {
    return computeFortifyReachable(
      gameState, connections, source, sourceOwner, filter, options.canTraverse,
    );
  }

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

/**
 * The attacker must leave one unit behind to hold the ground, so a stack of 1
 * can't attack at all — the server rejects `unit_count < 2` outright
 * (gameSocket's attack handler, executeLandAttack, executeBlitzAttack).
 */
export const MIN_ATTACK_UNITS = 2;

/** Can this territory legally launch an attack for `viewerId` right now? */
export function canAttackFrom(
  gameState: GameState,
  territoryId: string,
  viewerId: string | null | undefined,
): boolean {
  if (!gameState || !viewerId) return false;
  const t = gameState.territories[territoryId];
  return t?.owner_id === viewerId && (t.unit_count ?? 0) >= MIN_ATTACK_UNITS;
}

export interface DirectAttackSourceRow {
  territoryId: string;
  name: string;
  unitCount: number;
  /** Connection linking this source to the target — blitz eligibility reads it. */
  connectionType?: string;
}

/**
 * The viewer's territories that border `territoryId`, whatever their strength.
 *
 * Distinguishes "you have nothing next to this" from "what you have next to it
 * is too thin to attack with" — two very different pieces of advice, and the
 * panel says which rather than leaving an empty Combat section.
 */
export function listBorderingOwned(
  gameState: GameState,
  connections: MapConnection[],
  territoryId: string,
  viewerId: string | null | undefined,
): string[] {
  if (!gameState || !viewerId) return [];
  const owned = new Set<string>();
  for (const conn of connections) {
    const other = conn.from === territoryId ? conn.to : conn.to === territoryId ? conn.from : null;
    if (!other) continue;
    if (gameState.territories[other]?.owner_id === viewerId) owned.add(other);
  }
  return [...owned];
}

/**
 * Which of the viewer's territories could strike `targetTerritoryId` right now,
 * strongest stack first.
 *
 * This is the "click theirs, then pick who swings" half of the attack flow.
 * Without it, opening an enemy's panel with no attacker armed was a dead end —
 * the panel's own attack button needs an armed source and "Select as Attacker"
 * needs the territory to be yours, so neither rendered and the only way forward
 * was to navigate back to one of your own territories first.
 *
 * Legality is delegated to `listNeighborTargets`, the same helper the neighbour
 * picker runs on, so this can never offer an attack the server would reject.
 * Returns [] when it isn't the viewer's attack phase or the target isn't an
 * enemy — callers don't have to re-check.
 */
export function listDirectAttackSources(
  gameState: GameState,
  connections: MapConnection[],
  targetTerritoryId: string,
  viewerId: string | null | undefined,
  territoryNames: Map<string, string>,
  options: { worldNameOf?: (territoryId: string) => string | undefined } = {},
): DirectAttackSourceRow[] {
  if (!gameState || !viewerId || gameState.phase !== 'attack') return [];
  const targetOwner = gameState.territories[targetTerritoryId]?.owner_id;
  // Enemy-held or a capturable neutral; never your own territory.
  if (targetOwner === viewerId) return [];

  return listBorderingOwned(gameState, connections, targetTerritoryId, viewerId)
    .filter((sourceId) => canAttackFrom(gameState, sourceId, viewerId))
    .filter((sourceId) =>
      listNeighborTargets(gameState, connections, sourceId, territoryNames, {
        attackSource: sourceId,
        worldNameOf: options.worldNameOf,
      }).some((n) => n.territoryId === targetTerritoryId),
    )
    .map((sourceId) => ({
      territoryId: sourceId,
      name: territoryNames.get(sourceId) ?? sourceId,
      unitCount: gameState.territories[sourceId]?.unit_count ?? 0,
      connectionType: connections.find(
        (c) =>
          (c.from === sourceId && c.to === targetTerritoryId) ||
          (c.from === targetTerritoryId && c.to === sourceId),
      )?.type,
    }))
    // Strongest first: the stack most likely to win leads. Name breaks ties so
    // the order is stable across renders.
    .sort((a, b) => b.unitCount - a.unitCount || a.name.localeCompare(b.name));
}
