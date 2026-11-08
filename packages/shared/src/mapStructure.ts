/**
 * What a map's shape says about how it plays, from the graph alone: how many
 * ways into each region and how many territories it holds, which territories
 * are chokepoints (cut one and the map splits), which are dead ends, how far
 * apart the corners are, and whether a bonus is rich for its size. Instant,
 * so the editor shows it live; the bot simulation on the server says what the
 * graph cannot.
 */

export interface StructureTerritory {
  territory_id: string;
  name?: string;
  region_id: string;
}

export interface StructureConnection {
  from: string;
  to: string;
  type?: string;
}

export interface StructureRegion {
  region_id: string;
  name?: string;
  bonus: number;
}

export interface StructureInput {
  territories: StructureTerritory[];
  connections: StructureConnection[];
  regions: StructureRegion[];
}

export interface TerritoryStructure {
  territory_id: string;
  name: string;
  region_id: string;
  /** Connections, land and sea alike. */
  degree: number;
  /** Removing it disconnects the map. */
  chokepoint: boolean;
  /** One connection only. */
  deadEnd: boolean;
}

export interface RegionStructure {
  region_id: string;
  name: string;
  size: number;
  bonus: number;
  /** Territories with a connection to another region: the ones to defend. */
  borderTerritories: number;
  /** Connections crossing the region's edge: the ways in. */
  entrances: number;
  /** The rule of thumb for this size and these borders (0 when too small to pay). */
  suggestedBonus: number;
  /** Bonus per territory held; above 1 is rich. */
  payoutPerTerritory: number;
  /** Territories per entrance; higher is easier to hold. Null for a region nothing enters. */
  defensibility: number | null;
}

export type StructureNoteCode =
  | 'rich_region'
  | 'exposed_region'
  | 'fortress_region'
  | 'chokepoints'
  | 'dead_ends'
  | 'sparse'
  | 'dense'
  | 'long_map';

export interface StructureNote {
  code: StructureNoteCode;
  severity: 'info' | 'warning';
  message: string;
  territoryIds?: string[];
  regionIds?: string[];
}

export interface MapStructureReport {
  territories: TerritoryStructure[];
  regions: RegionStructure[];
  chokepoints: string[];
  deadEnds: string[];
  degree: { min: number; max: number; mean: number };
  /** The longest shortest path between two territories; null when the map is not connected. */
  diameter: number | null;
  /** The average shortest path over all pairs; null when the map is not connected. */
  meanDistance: number | null;
  notes: StructureNote[];
}

/**
 * A region bonus in the classic proportions: a third of the territories plus
 * half the border territories, since a region with many ways in is harder to
 * hold. On the original board it gives North America (9, 3) → 5 and Asia
 * (12, 5) → 7 exactly, and lands within one everywhere else. Zero for a
 * region too small to ever pay.
 */
export function suggestRegionBonus(territoryCount: number, borderTerritoryCount: number): number {
  if (territoryCount < 2) return 0;
  const raw = territoryCount / 3 + borderTerritoryCount / 2;
  return Math.max(1, Math.min(20, Math.round(raw)));
}

function listNames(names: string[], limit = 4): string {
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} and ${names.length - limit} more` : shown;
}

/** Territories whose removal disconnects the graph (Tarjan, iterative). */
export function articulationPoints(ids: string[], adjacency: Map<string, Set<string>>): Set<string> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const result = new Set<string>();
  let counter = 0;

  for (const root of ids) {
    if (index.has(root)) continue;
    parent.set(root, null);
    let rootChildren = 0;
    const stack: Array<{ node: string; iterator: Iterator<string> }> = [];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push({ node: root, iterator: (adjacency.get(root) ?? new Set()).values() });

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = frame.iterator.next();
      if (!next.done) {
        const neighbour = next.value;
        if (!index.has(neighbour)) {
          parent.set(neighbour, frame.node);
          index.set(neighbour, counter);
          low.set(neighbour, counter);
          counter += 1;
          if (frame.node === root) rootChildren += 1;
          stack.push({ node: neighbour, iterator: (adjacency.get(neighbour) ?? new Set()).values() });
        } else if (neighbour !== parent.get(frame.node)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(neighbour)!));
        }
        continue;
      }
      stack.pop();
      const up = parent.get(frame.node);
      if (up !== null && up !== undefined) {
        low.set(up, Math.min(low.get(up)!, low.get(frame.node)!));
        if (up !== root && low.get(frame.node)! >= index.get(up)!) result.add(up);
      }
    }
    if (rootChildren > 1) result.add(root);
  }
  return result;
}

export function analyzeMapStructure(input: StructureInput): MapStructureReport {
  const ids = input.territories.map((t) => t.territory_id);
  const idSet = new Set(ids);
  const nameOf = new Map(input.territories.map((t) => [t.territory_id, t.name ?? t.territory_id] as const));
  const regionOf = new Map(input.territories.map((t) => [t.territory_id, t.region_id] as const));
  const regionName = new Map(input.regions.map((r) => [r.region_id, r.name ?? r.region_id] as const));

  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) adjacency.set(id, new Set());
  const edges: Array<[string, string]> = [];
  for (const c of input.connections) {
    if (c.from === c.to || !idSet.has(c.from) || !idSet.has(c.to)) continue;
    const a = adjacency.get(c.from)!;
    if (a.has(c.to)) continue;
    a.add(c.to);
    adjacency.get(c.to)!.add(c.from);
    edges.push([c.from, c.to]);
  }

  const cut = articulationPoints(ids, adjacency);
  const territories: TerritoryStructure[] = ids.map((id) => {
    const degree = adjacency.get(id)!.size;
    return {
      territory_id: id,
      name: nameOf.get(id)!,
      region_id: regionOf.get(id)!,
      degree,
      chokepoint: cut.has(id),
      deadEnd: degree === 1,
    };
  });

  // Regions: members, borders, entrances.
  const members = new Map<string, string[]>();
  for (const t of input.territories) {
    const list = members.get(t.region_id) ?? [];
    list.push(t.territory_id);
    members.set(t.region_id, list);
  }
  const borderIds = new Set<string>();
  const entrances = new Map<string, number>();
  for (const [a, b] of edges) {
    const ra = regionOf.get(a)!;
    const rb = regionOf.get(b)!;
    if (ra === rb) continue;
    borderIds.add(a);
    borderIds.add(b);
    entrances.set(ra, (entrances.get(ra) ?? 0) + 1);
    entrances.set(rb, (entrances.get(rb) ?? 0) + 1);
  }
  const regions: RegionStructure[] = input.regions.map((r) => {
    const list = members.get(r.region_id) ?? [];
    const size = list.length;
    const borderTerritories = list.filter((id) => borderIds.has(id)).length;
    const ways = entrances.get(r.region_id) ?? 0;
    return {
      region_id: r.region_id,
      name: regionName.get(r.region_id)!,
      size,
      bonus: r.bonus,
      borderTerritories,
      entrances: ways,
      suggestedBonus: suggestRegionBonus(size, borderTerritories),
      payoutPerTerritory: size > 0 ? r.bonus / size : 0,
      defensibility: ways > 0 ? size / ways : null,
    };
  });

  // Degrees and distances.
  const degrees = territories.map((t) => t.degree);
  const degree = {
    min: degrees.length ? Math.min(...degrees) : 0,
    max: degrees.length ? Math.max(...degrees) : 0,
    mean: degrees.length ? degrees.reduce((s, d) => s + d, 0) / degrees.length : 0,
  };

  let diameter: number | null = null;
  let meanDistance: number | null = null;
  if (ids.length > 1) {
    let connected = true;
    let longest = 0;
    let sum = 0;
    let pairs = 0;
    for (const start of ids) {
      const dist = new Map<string, number>([[start, 0]]);
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const d = dist.get(current)!;
        for (const next of adjacency.get(current)!) {
          if (!dist.has(next)) {
            dist.set(next, d + 1);
            queue.push(next);
          }
        }
      }
      if (dist.size !== ids.length) {
        connected = false;
        break;
      }
      for (const [id, d] of dist) {
        if (id === start) continue;
        longest = Math.max(longest, d);
        sum += d;
        pairs += 1;
      }
    }
    if (connected) {
      diameter = longest;
      meanDistance = pairs > 0 ? sum / pairs : 0;
    }
  }

  // Notes: what the numbers mean for play.
  const notes: StructureNote[] = [];
  for (const r of regions) {
    if (r.size < 2) continue;
    if (r.payoutPerTerritory > 1) {
      notes.push({
        code: 'rich_region',
        severity: 'warning',
        message: `${r.name} pays +${r.bonus} for ${r.size} territories — more than a unit per territory. Whoever takes it early tends to run away with the game (the rule of thumb says +${r.suggestedBonus})`,
        regionIds: [r.region_id],
      });
    }
    if (r.entrances > r.size) {
      notes.push({
        code: 'exposed_region',
        severity: 'info',
        message: `${r.name} has ${r.entrances} ways in for ${r.size} territories: hard to hold, so its bonus is rarely paid`,
        regionIds: [r.region_id],
        territoryIds: (members.get(r.region_id) ?? []).filter((id) => borderIds.has(id)),
      });
    } else if (r.defensibility !== null && r.defensibility >= 3 && r.size >= 4) {
      notes.push({
        code: 'fortress_region',
        severity: 'info',
        message: `${r.name} has ${r.entrances} way${r.entrances === 1 ? '' : 's'} in for ${r.size} territories: a fortress once taken`,
        regionIds: [r.region_id],
      });
    }
  }
  const chokepoints = territories.filter((t) => t.chokepoint).map((t) => t.territory_id);
  if (chokepoints.length > 0) {
    notes.push({
      code: 'chokepoints',
      severity: chokepoints.length >= 3 ? 'warning' : 'info',
      message: `${chokepoints.length === 1 ? 'One chokepoint' : `${chokepoints.length} chokepoints`}: ${listNames(chokepoints.map((id) => nameOf.get(id)!))} — hold ${chokepoints.length === 1 ? 'it' : 'them'} and the map splits in two`,
      territoryIds: chokepoints,
    });
  }
  const deadEnds = territories.filter((t) => t.deadEnd).map((t) => t.territory_id);
  if (deadEnds.length >= 3) {
    notes.push({
      code: 'dead_ends',
      severity: 'info',
      message: `${deadEnds.length} dead ends (one connection each): ${listNames(deadEnds.map((id) => nameOf.get(id)!))} — safe to hold, slow to attack from`,
      territoryIds: deadEnds,
    });
  }
  if (ids.length >= 6) {
    if (degree.mean < 2.2) {
      notes.push({
        code: 'sparse',
        severity: 'info',
        message: `Few connections per territory (${degree.mean.toFixed(1)} on average): expect long, defensive games`,
      });
    } else if (degree.mean > 5) {
      notes.push({
        code: 'dense',
        severity: 'info',
        message: `Very connected (${degree.mean.toFixed(1)} per territory): fast, swingy games where nothing is safe`,
      });
    }
  }
  if (diameter !== null && diameter >= 10) {
    notes.push({
      code: 'long_map',
      severity: 'info',
      message: `The far corners are ${diameter} steps apart: a player can turtle at one end for a long time`,
    });
  }

  return { territories, regions, chokepoints, deadEnds, degree, diameter, meanDistance, notes };
}
