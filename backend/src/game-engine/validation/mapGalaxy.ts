/**
 * Offline validation for multi-world (`map_kind: "galaxy"`) maps.
 *
 * A galaxy map is several globes joined by `orbit` lanes, and most of what makes
 * it playable is invisible to the generic connection check: that check only asks
 * whether the whole graph is connected, which the lanes guarantee even when a
 * world has split in two. The invariants here are the ones the Galactic Age
 * start, rendering and rules actually lean on:
 *
 *   • every territory names a declared world, and each world is connected by its
 *     own land and sea borders — orbit lanes join worlds, never two tiles on one;
 *   • every region is declared, non-empty and sits on a single world (region
 *     bonuses and the per-world region list both assume it);
 *   • a world's `rules.vault.region_id` is a region on that world;
 *   • every faction's `home_region_ids` resolve to regions on ONE world, and
 *     different factions to different worlds — otherwise
 *     `tryDistributeGalaxyAgeFactionHomeworlds` falls back to a random deal
 *     without a word, which is how the Nexus Vault once emptied unnoticed;
 *   • geo polygons are closed rings of in-range coordinates;
 *   • a world unlocks all at once (one `unlock_era_index` per world).
 */

export interface GalaxyTerritory {
  territory_id: string;
  region_id?: string;
  world_id?: string;
  geo_polygon?: [number, number][];
  unlock_era_index?: number;
}

export interface GalaxyWorld {
  world_id: string;
  rules?: { vault?: { region_id?: string } };
}

export interface GalaxyMapDocument {
  map_id?: string;
  map_kind?: string;
  worlds?: GalaxyWorld[];
  regions?: Array<{ region_id: string }>;
  territories: GalaxyTerritory[];
  connections: Array<{ from: string; to: string; type?: string }>;
}

export interface GalaxyHomeFaction {
  faction_id: string;
  home_region_ids: string[];
}

/** Returns human-readable errors; empty array means valid (or not a galaxy map). */
export function validateMapGalaxy(map: GalaxyMapDocument, factions: GalaxyHomeFaction[] = []): string[] {
  if (map.map_kind !== 'galaxy') return [];
  const errors: string[] = [];
  const worldIds = new Set((map.worlds ?? []).map((w) => w.world_id));
  const worldOf = new Map<string, string>();

  // ── Worlds ────────────────────────────────────────────────────────────
  for (const t of map.territories) {
    if (!t.world_id) errors.push(`${t.territory_id} has no world_id`);
    else if (!worldIds.has(t.world_id)) errors.push(`${t.territory_id} is on undeclared world "${t.world_id}"`);
    else worldOf.set(t.territory_id, t.world_id);
  }
  for (const w of worldIds) {
    if (![...worldOf.values()].includes(w)) errors.push(`world "${w}" has no territories`);
  }

  // ── Edges: lanes leave their world, borders stay on it ────────────────
  const adjacency = new Map<string, string[]>();
  for (const id of worldOf.keys()) adjacency.set(id, []);
  for (const c of map.connections) {
    const a = worldOf.get(c.from);
    const b = worldOf.get(c.to);
    if (!a || !b) continue; // unknown endpoints are validateMapConnections' job
    if (c.type === 'orbit') {
      if (a === b) errors.push(`orbit lane ${c.from}–${c.to} does not leave world "${a}"`);
    } else if (a !== b) {
      errors.push(`${c.type ?? 'land'} edge ${c.from}–${c.to} crosses worlds (${a}→${b}); only orbit lanes may`);
    } else {
      adjacency.get(c.from)!.push(c.to);
      adjacency.get(c.to)!.push(c.from);
    }
  }
  for (const w of worldIds) {
    const tiles = [...worldOf].filter(([, tw]) => tw === w).map(([id]) => id);
    if (tiles.length === 0) continue;
    const seen = new Set([tiles[0]]);
    const queue = [tiles[0]];
    while (queue.length) {
      for (const n of adjacency.get(queue.pop()!)!) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    const cut = tiles.filter((id) => !seen.has(id));
    if (cut.length) {
      errors.push(`world "${w}" is split without its lanes: ${cut.join(', ')} unreachable from ${tiles[0]} over land/sea`);
    }
  }

  // ── Regions ───────────────────────────────────────────────────────────
  const declared = new Set((map.regions ?? []).map((r) => r.region_id));
  const regionWorlds = new Map<string, Set<string>>();
  for (const t of map.territories) {
    if (!t.region_id) { errors.push(`${t.territory_id} has no region_id`); continue; }
    if (!declared.has(t.region_id)) errors.push(`${t.territory_id} is in undeclared region "${t.region_id}"`);
    const set = regionWorlds.get(t.region_id) ?? new Set<string>();
    if (t.world_id) set.add(t.world_id);
    regionWorlds.set(t.region_id, set);
  }
  for (const r of declared) {
    const ws = regionWorlds.get(r);
    if (!ws) errors.push(`region "${r}" has no territories`);
    else if (ws.size > 1) errors.push(`region "${r}" spans worlds ${[...ws].join(', ')}`);
  }
  const worldOfRegion = (r: string): string | undefined => {
    const ws = regionWorlds.get(r);
    return ws && ws.size === 1 ? [...ws][0] : undefined;
  };

  // ── Vaults ────────────────────────────────────────────────────────────
  for (const w of map.worlds ?? []) {
    const vault = w.rules?.vault?.region_id;
    if (vault === undefined) continue;
    if (worldOfRegion(vault) !== w.world_id) {
      errors.push(`world "${w.world_id}" vault region "${vault}" is not a populated region on that world`);
    }
  }

  // ── Faction homeworlds ────────────────────────────────────────────────
  const homeOwner = new Map<string, string>();
  for (const f of factions) {
    const ws = new Set(f.home_region_ids.map(worldOfRegion));
    if (ws.has(undefined) || ws.size !== 1) {
      const missing = f.home_region_ids.filter((r) => !worldOfRegion(r));
      errors.push(
        `faction ${f.faction_id} home regions do not resolve to one world`
        + (missing.length ? ` (missing or empty: ${missing.join(', ')})` : ` (${[...ws].join(', ')})`),
      );
      continue;
    }
    const home = [...ws][0]!;
    const other = homeOwner.get(home);
    if (other) errors.push(`factions ${other} and ${f.faction_id} share homeworld "${home}"`);
    else homeOwner.set(home, f.faction_id);
  }

  // ── Geometry ──────────────────────────────────────────────────────────
  for (const t of map.territories) {
    const g = t.geo_polygon;
    if (!g) continue;
    if (g.length < 4) { errors.push(`${t.territory_id} geo_polygon has ${g.length} points`); continue; }
    const [fx, fy] = g[0];
    const [lx, ly] = g[g.length - 1];
    if (fx !== lx || fy !== ly) errors.push(`${t.territory_id} geo_polygon is not closed`);
    if (g.some(([lng, lat]) => !(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90))) {
      errors.push(`${t.territory_id} geo_polygon has a coordinate outside [-180,180]×[-90,90]`);
    }
  }

  // ── Unlocks ───────────────────────────────────────────────────────────
  const unlocks = new Map<string, Set<number | undefined>>();
  for (const t of map.territories) {
    if (!t.world_id) continue;
    const set = unlocks.get(t.world_id) ?? new Set<number | undefined>();
    set.add(t.unlock_era_index);
    unlocks.set(t.world_id, set);
  }
  for (const [w, set] of unlocks) {
    if (set.size > 1) errors.push(`world "${w}" mixes unlock_era_index values: ${[...set].map(String).join(', ')}`);
  }

  return errors;
}
