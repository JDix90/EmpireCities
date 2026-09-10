/**
 * Era Advancement — territory growth.
 *
 * As players climb eras, the shared battlefield GROWS: territories tagged with
 * `unlock_era_index > 0` are held out of the live board at game start and added
 * when the global era floor (the highest era index any player has reached)
 * catches up. Newly unlocked territories appear NEUTRAL with a small garrison —
 * a frontier to be conquered — matching the existing neutral-garrison pattern
 * used for lunar/offworld worlds (see state/moonAccess.ts).
 *
 * Design decisions (locked with the product owner):
 *   • Growth is GLOBAL and triggers on the FIRST player to reach an era.
 *   • New territories spawn NEUTRAL with a light garrison (must be conquered).
 *   • Geometry comes from the authored map; maps that tag no territories no-op.
 *
 * This module is map-data-driven and side-effect-light: it reads the authored
 * GameMap and mutates `state.territories` / `state.map_era_floor` only.
 */

import { inferWorldId } from '@borderfall/shared';
import { getCoastalTerritoryIds } from '../state/navalManager';
import { orbitGatewayTerritoryIds, territoryRequiresOrbitAccessForClaim } from '../state/moonAccess';
import { vaultRegionGarrisons } from '../state/worldRules';
import type { EraId, GameMap, GameState, TerritoryState } from '../../types';

/**
 * Garrison placed on a freshly unlocked neutral frontier. Scales with the unlock
 * era so deeper frontiers — reached later, when players are stronger — defend
 * harder (era 1 → 3, era 2 → 4, …), capped so they stay takeable.
 */
export function unlockGarrisonForEra(unlockEraIndex: number): number {
  return Math.min(8, 2 + Math.max(1, unlockEraIndex));
}

/**
 * Garrison on a freshly unlocked frontier that sits on an OFF-WORLD world (one
 * flagged `requires_orbit_access`) — the Space to Stars exo worlds.
 *
 * A landing zone (one end of a hyperspace lane) keeps the era-scaled number, so
 * the lanes stay the way in; the interior behind it gets one more, so a world is
 * a campaign rather than a single push.
 *
 * ONE more, and no further. The first version of this rule was 4/6, on the
 * argument that a world reached after a whole Space Program should not defend
 * like a field next door. Measured over 200-game runs on two seeds, weight here
 * does almost nothing for the thing it was meant to do — exo tiles owned at the
 * end sat at 29-30 of 48 whether the frontier defended with 3/4, 4/6 or 6/8, and
 * neither the turn-10 snowball (58-63%) nor the faction spread moved at all —
 * while the heavier settings cost decisive games outright: 46.5% and 53.0% at
 * 4/6 against 55.5% and 60.5% at 3/4, purely from grinding more games into the
 * turn cap. The lighter frontier is contested exactly as much and finishes.
 */
export const OFFWORLD_FRONTIER_GATEWAY_GARRISON = 3;
export const OFFWORLD_FRONTIER_INTERIOR_GARRISON = 4;

/**
 * Garrison sizer for one map's frontiers. Returns a closure so the gateway set
 * (a scan of every connection) is computed once per unlock, not once per tile.
 */
export function frontierGarrisonSizer(map: GameMap): (t: GameMap['territories'][number]) => number {
  let gateways: Set<string> | null = null;
  // A vault region (the Nexus Gate Ring) carries its own authored garrison. It
  // is applied at init for a world that starts in play; a world that ARRIVES
  // has to get the same number here or the prize would be cheaper depending on
  // which board it showed up on.
  const vault = vaultRegionGarrisons(map);
  return (t) => {
    const authored = vault.get(t.territory_id);
    if (authored != null) return authored;
    if (!territoryRequiresOrbitAccessForClaim(map, t.territory_id)) {
      return unlockGarrisonForEra(territoryUnlockEra(t));
    }
    gateways = gateways ?? orbitGatewayTerritoryIds(map);
    return gateways.has(t.territory_id)
      ? OFFWORLD_FRONTIER_GATEWAY_GARRISON
      : OFFWORLD_FRONTIER_INTERIOR_GARRISON;
  };
}

/** The advancement era index at which a map territory enters play (0 = start). */
export function territoryUnlockEra(t: { unlock_era_index?: number }): number {
  return Math.max(0, t.unlock_era_index ?? 0);
}

/**
 * Maps that ship Era-Advancement growth content (`unlock_era_index` frontiers).
 * Used to gate the migration's one-time map refresh (gameRoomManager) to a fast
 * static-file `resolveMap`, so it never hits the DB for a synthetic/community map.
 * Keep in sync when growth content is added to a new map.
 */
export const ERA_GROWTH_MAP_IDS: ReadonlySet<string> = new Set([
  'era_ancient',
  'era_medieval',
  'era_discovery',
  'era_ww2',
  'era_coldwar',
  'era_modern',
  'era_space_age',
  // Space to Stars: Earth + Moon in play from turn one, the three exo worlds
  // tagged `unlock_era_index: 1` for the Galactic Age step.
  'era_ascension_galaxy',
]);

/** True when the map tags any territory for later-era unlocking. */
export function mapHasEraGrowth(map: GameMap): boolean {
  return map.territories.some((t) => territoryUnlockEra(t) > 0);
}

/** Highest `unlock_era_index` authored on the map (0 when the map has no growth). */
export function maxUnlockEra(map: GameMap): number {
  let max = 0;
  for (const t of map.territories) {
    const e = territoryUnlockEra(t);
    if (e > max) max = e;
  }
  return max;
}

/**
 * Build a neutral, garrisoned frontier territory-state from a map tile. Single
 * source of truth for the garrison size / world / region across the two spawn
 * paths (progressive era-advancement unlock and the standalone full-board seeder)
 * so they can't drift. Coastal `naval_units` is deliberately NOT set here — each
 * caller handles it: init seeding leaves it to `initializeNavalUnits` (called
 * after, naval-aware, exactly like base tiles + the neutral Moon), while mid-game
 * unlock sets it directly since naval init has already run.
 */
function buildNeutralFrontier(
  t: GameMap['territories'][number],
  garrisonFor: (t: GameMap['territories'][number]) => number,
): TerritoryState {
  return {
    territory_id: t.territory_id,
    owner_id: null,
    unit_count: garrisonFor(t),
    unit_type: 'infantry',
    world_id: inferWorldId(t),
    region_id: t.region_id,
  };
}

/**
 * True when a game should seed the FULL authored board (all `unlock_era_index`
 * frontiers, neutral) at start instead of growing it via era advancement. This is
 * the standalone Space Age case: with advancement OFF the progressive-unlock
 * machinery never runs (`globalEraFloor` stays 0), so the authored 2100 frontiers
 * would be permanently dead content. Scoped to space_age and gated by the
 * `space_age_frontiers_enabled` dark-launch flag (baked into settings at create
 * from featureFlags), so the blast radius is one board and it can be flipped from
 * the admin panel.
 */
export function seedsFullBoardAtStart(
  era: EraId,
  settings: { era_advancement_enabled?: boolean; space_age_frontiers_enabled?: boolean },
  map: GameMap,
): boolean {
  return (
    era === 'space_age' &&
    settings.era_advancement_enabled !== true &&
    settings.space_age_frontiers_enabled === true &&
    mapHasEraGrowth(map)
  );
}

/**
 * Insert every `unlock_era_index > 0` tile into `territories` as a neutral
 * garrisoned frontier (in place), for a standalone full-board start. Returns the
 * era floor to record on the state (the map's max unlock era) so
 * `projectMapToEraFloor` includes them in every emission. Idempotent — never
 * overwrites an existing entry.
 */
export function seedStandaloneFrontierTerritories(
  territories: Record<string, TerritoryState>,
  map: GameMap,
): number {
  const garrisonFor = frontierGarrisonSizer(map);
  for (const t of map.territories) {
    if (territoryUnlockEra(t) <= 0) continue;
    if (!territories[t.territory_id]) territories[t.territory_id] = buildNeutralFrontier(t, garrisonFor);
  }
  return maxUnlockEra(map);
}

/** Map territory_ids that are NOT yet in play at the given era floor. */
export function lockedTerritoryIds(map: GameMap, floor: number): Set<string> {
  return new Set(
    map.territories.filter((t) => territoryUnlockEra(t) > floor).map((t) => t.territory_id),
  );
}

/**
 * The highest era index any living (or, defensively, any) player has reached.
 * Drives the "first to reach an era unlocks it for everyone" rule.
 */
export function globalEraFloor(state: GameState): number {
  let max = 0;
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    const idx = p.current_era_index ?? 0;
    if (idx > max) max = idx;
  }
  // Defensive: if every player is somehow eliminated, fall back to the recorded floor.
  return Math.max(max, state.map_era_floor ?? 0);
}

/**
 * Project the authored map down to the territories (and connections) that are
 * actually in play at the given era floor. Used at every `game:map` emission so
 * clients only ever see / render in-play territories; connections that touch a
 * still-locked territory are withheld until both endpoints exist. No-op (returns
 * a structurally-equal map) for maps without era-growth tags.
 */
export function projectMapToEraFloor(map: GameMap, floor: number): GameMap {
  if (!mapHasEraGrowth(map)) return map;
  const visible = new Set(
    map.territories.filter((t) => territoryUnlockEra(t) <= floor).map((t) => t.territory_id),
  );
  return {
    ...map,
    territories: map.territories.filter((t) => visible.has(t.territory_id)),
    connections: map.connections.filter((c) => visible.has(c.from) && visible.has(c.to)),
  };
}

/**
 * Add any territories newly unlocked by the current global era floor into the
 * live game state as neutral, garrisoned frontiers. Idempotent: only inserts
 * territories that aren't already present and only ever raises `map_era_floor`.
 *
 * Returns the list of territory_ids actually added (empty when nothing changed),
 * so callers can re-emit the projected map and surface a "new lands" cue.
 */
export function unlockTerritoriesForFloor(state: GameState, map: GameMap): string[] {
  const prevFloor = state.map_era_floor ?? 0;
  const newFloor = globalEraFloor(state);
  if (newFloor <= prevFloor) {
    // Keep the recorded floor monotonic even if nothing unlocks this call.
    state.map_era_floor = Math.max(prevFloor, newFloor);
    return [];
  }

  const added: string[] = [];
  const coastal = getCoastalTerritoryIds(map);
  const garrisonFor = frontierGarrisonSizer(map);
  for (const t of map.territories) {
    const unlockEra = territoryUnlockEra(t);
    if (unlockEra <= prevFloor || unlockEra > newFloor) continue; // outside the (prev, new] window
    if (state.territories[t.territory_id]) continue; // already in play — never duplicate
    const territory = buildNeutralFrontier(t, garrisonFor);
    // Coastal marker: naval buildings + sea attacks read `naval_units != null`
    // as "coastal" (navalManager.initializeNavalUnits sets it at game start,
    // which runs before frontiers exist — without this, unlocked frontiers
    // could never build a Port / Naval Base).
    if (coastal.has(t.territory_id)) territory.naval_units = 0;
    state.territories[t.territory_id] = territory;
    added.push(t.territory_id);
  }

  state.map_era_floor = newFloor;
  return added;
}

/**
 * Migration backfill for in-progress games. A game started before its map gained
 * growth content (or before this feature shipped) has a territory set frozen at the
 * base board. On room load, if the live map now carries growth tags and the game is
 * an Era-Advancement game, insert any frontiers that should already be in play at
 * the current global era floor.
 *
 * Idempotent and a no-op for non-growth maps / non-era-advancement games, so it is
 * safe to run on every room load (see gameRoomManager.repairRoom). The geometry then
 * reaches clients via the projected `game:map` re-emit on (re)connect.
 */
export function repairEraTerritoryGrowth(state: GameState, map: GameMap): void {
  if (state.settings?.era_advancement_enabled !== true) return;
  // Heal the coastal marker on territories inserted before unlock/transform set
  // it (frontiers and board-transform arrivals shipped without `naval_units`,
  // permanently blocking Ports / Naval Bases there). Idempotent per load.
  const coastal = getCoastalTerritoryIds(map);
  for (const t of Object.values(state.territories)) {
    if (t.naval_units == null && coastal.has(t.territory_id)) t.naval_units = 0;
  }
  // Prune NEUTRAL orphans: a map update can retire a territory id (e.g. the old
  // single `antarctica` frontier, split into four sectors). A live game that had
  // already unlocked it keeps a state entry with no map counterpart — invisible,
  // unattackable, and excluded from every map-driven computation. Removing it is
  // safe only while unowned; owned territories are never silently deleted.
  const mapIds = new Set(map.territories.map((t) => t.territory_id));
  for (const t of Object.values(state.territories)) {
    if (t.owner_id == null && !mapIds.has(t.territory_id)) {
      delete state.territories[t.territory_id];
    }
  }
  if (!mapHasEraGrowth(map)) return;
  unlockTerritoriesForFloor(state, map);
}
