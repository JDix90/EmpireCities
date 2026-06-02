/**
 * Offline validation for map JSON (seed files / editor output).
 * Ensures connection graph integrity before maps are persisted or used in gameplay.
 */

export interface MapConnection {
  from: string;
  to: string;
  type?: 'land' | 'sea' | 'orbit';
}

export interface MapTerritoryRef {
  territory_id: string;
}

export interface MapDocumentLike {
  map_id?: string;
  name?: string;
  territories: MapTerritoryRef[];
  connections: MapConnection[];
}

/**
 * Returns human-readable errors; empty array means valid.
 * Map JSON stores each **undirected** edge once (`from`/`to`). Gameplay treats connections as
 * undirected (see server adjacency check in gameSocket). We validate endpoints exist,
 * no self-loops, no duplicate territory pairs (including A→B plus B→A), and that the
 * combined land+sea graph is fully connected (no isolated territory islands).
 */
export function validateMapConnections(map: MapDocumentLike): string[] {
  const errors: string[] = [];
  const idSet = new Set(map.territories.map((t) => t.territory_id));
  const pairSeen = new Set<string>();

  // Build adjacency list for connectivity check (land + sea combined)
  const adjacency = new Map<string, Set<string>>();
  for (const id of idSet) adjacency.set(id, new Set());

  for (const c of map.connections) {
    const fromValid = idSet.has(c.from);
    const toValid = idSet.has(c.to);

    if (!fromValid) errors.push(`Connection references unknown territory "from": ${c.from}`);
    if (!toValid) errors.push(`Connection references unknown territory "to": ${c.to}`);
    if (c.from === c.to) {
      errors.push(`Self-loop connection: ${c.from}`);
      continue;
    }

    const a = c.from < c.to ? c.from : c.to;
    const b = c.from < c.to ? c.to : c.from;
    const pairKey = `${a}\0${b}`;
    if (pairSeen.has(pairKey)) {
      errors.push(`Duplicate connection between ${a} and ${b}`);
    }
    pairSeen.add(pairKey);

    if (fromValid && toValid) {
      adjacency.get(c.from)!.add(c.to);
      adjacency.get(c.to)!.add(c.from);
    }
  }

  // Connectivity check: BFS from first territory; every territory must be reachable.
  // A disconnected component means some players could be permanently isolated with
  // no path to attack or fortify to the rest of the map.
  if (map.territories.length > 0) {
    const start = map.territories[0].territory_id;
    const visited = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const neighbor of adjacency.get(curr) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const isolated: string[] = [];
    for (const id of idSet) {
      if (!visited.has(id)) isolated.push(id);
    }
    if (isolated.length > 0) {
      errors.push(
        `Disconnected territory component — ${isolated.length} territories unreachable from "${start}": ${isolated.slice(0, 5).join(', ')}${isolated.length > 5 ? ` …and ${isolated.length - 5} more` : ''}`,
      );
    }
  }

  return errors;
}
