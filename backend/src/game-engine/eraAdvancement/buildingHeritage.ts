// ============================================================
// Building heritage — inherited build rights + the modernize rule
// ============================================================

import type { BuildingType, GameState, PlayerState, TerritoryState } from '../../types';
import type { TechNode } from '../eras/types';
import { getEraTechTree } from '../eras';
import { isWonderId } from '../state/wonderManager';
import { resolvePlayerEraId } from './constants';

/**
 * Advancing an era wipes `unlocked_techs`, and the build gate asks the ARRIVING
 * era's tree whether the building is unlocked. Every classic-spine era re-gates
 * the same building ids behind new tech ids, so a player who held tier-3 walls
 * in the Ancient era could not place a tier-1 wall on freshly taken ground in
 * the Medieval era until they re-bought the new era's first wall tech — while
 * their existing tier-3 walls kept working. That reads as a bug, not a design.
 *
 * Two rules replace it:
 *
 *  1. HERITAGE. The building types a player's research opened stay open for the
 *     rest of the game (`player.legacy_building_unlocks`). Knowing how to raise
 *     a wall is not something an empire forgets by living longer.
 *  2. MODERNIZE. A building keeps working, but a building raised in an earlier
 *     era yields less until the player researches the current era's tech for
 *     it, which restores it AND pays a premium over new construction. That is
 *     what makes the re-appearing tier-1 nodes worth buying instead of a tax.
 *
 * The premium deliberately does NOT apply to buildings raised in the current
 * era. Before anyone advances (and in every game's first era) nothing is aged
 * and nothing is modernized, so this feature changes no yield until the first
 * era advance — the balance the game ships with today is untouched at era 0.
 */

/** Multiplier on an aged building's yield, before the never-zero floor. */
export const AGED_BUILDING_YIELD_MULT = 0.75;

/** Flat premium added to a modernized building's yield. */
export const MODERNIZED_BUILDING_YIELD_BONUS = 1;

/**
 * How a building stands relative to its owner's current era.
 * - `current`: raised this era, or era-neutral, or the feature is off.
 * - `aged`: raised in an earlier era, current-era tech not researched.
 * - `modernized`: raised in an earlier era, current-era tech researched.
 */
export type BuildingModernization = 'current' | 'aged' | 'modernized';

/**
 * Heritage is inert without era advancement (nothing to inherit from) and
 * without tech trees (nothing gates a building in the first place, so aging one
 * would be a penalty with no way to lift it).
 */
export function heritageEnabled(state: GameState): boolean {
  return (
    state.settings.era_heritage_buildings_enabled === true &&
    state.settings.era_advancement_enabled === true &&
    state.settings.tech_trees_enabled === true
  );
}

/** The tech node in `era`'s tree that unlocks exactly `buildingType`, if any. */
function techUnlockingBuilding(era: string, buildingType: BuildingType): TechNode | undefined {
  return getEraTechTree(era as Parameters<typeof getEraTechTree>[0])
    .find((node) => node.unlocks_building === buildingType);
}

/**
 * The upgrade ladder a building belongs to, for modernization purposes.
 *
 * Distinct from the economy manager's build-SLOT category, which answers "may a
 * second one of these share a territory". This answers "does this era's
 * research into <this line of work> cover that building" — and it has to be a
 * ladder rather than an exact id, because a tier-3 wall replaced the tier-1 and
 * tier-2 walls beneath it. Matching on the exact id would mean the only thing
 * that modernizes a carried tier-3 fortress is the arriving era's tier-3 node,
 * which at the documented research pace most players never reach: the tax this
 * feature exists to remove, moved rather than removed.
 */
export function buildingLineageKey(buildingType: BuildingType): string {
  if (buildingType.startsWith('production_')) return 'production';
  if (buildingType.startsWith('defense_')) return 'defense';
  if (buildingType.startsWith('tech_gen_')) return 'tech_gen';
  if (buildingType === 'port' || buildingType === 'naval_base') return 'naval';
  return buildingType;
}

/**
 * Every tech in the player's current era that covers `buildingType`'s ladder,
 * cheapest first. Empty means this era has no research touching this line of
 * work at all. Researching ANY of them modernizes the building: an empire that
 * has taken up the age's fortification craft has modernized its walls, whatever
 * tier they happen to stand at.
 */
export function lineageTechsForBuilding(
  state: GameState,
  player: PlayerState,
  buildingType: BuildingType,
): TechNode[] {
  const lineage = buildingLineageKey(buildingType);
  return getEraTechTree(resolvePlayerEraId(state, player))
    .filter((node) => node.unlocks_building && buildingLineageKey(node.unlocks_building) === lineage)
    .sort((a, b) => a.cost - b.cost);
}

/**
 * The cheapest research that would modernize `buildingType` right now — for UI
 * that has to name it ("Research Masonry to modernize"). Returns undefined when
 * the building is already modernized or this era cannot modernize it.
 */
export function modernizingTechForBuilding(
  state: GameState,
  player: PlayerState,
  buildingType: BuildingType,
): TechNode | undefined {
  const unlocked = new Set(player.unlocked_techs ?? []);
  const options = lineageTechsForBuilding(state, player, buildingType);
  if (options.some((node) => unlocked.has(node.tech_id))) return undefined;
  return options[0];
}

/** The tech node in the player's CURRENT era that unlocks `buildingType`, if any. */
export function currentEraTechForBuilding(
  state: GameState,
  player: PlayerState,
  buildingType: BuildingType,
): TechNode | undefined {
  return techUnlockingBuilding(resolvePlayerEraId(state, player), buildingType);
}

/** Building types the player's researched techs opened in `eraId`. Wonders excluded. */
export function captureHeritageUnlocks(
  state: GameState,
  player: PlayerState,
  eraId: string,
): BuildingType[] {
  const unlocked = new Set(player.unlocked_techs ?? []);
  const opened: BuildingType[] = [];
  for (const node of getEraTechTree(eraId as Parameters<typeof getEraTechTree>[0])) {
    if (!node.unlocks_building) continue;
    if (!unlocked.has(node.tech_id)) continue;
    // Era wonders are one-per-era-per-game by design; inheriting the right to
    // raise a departed era's wonder would break that identity.
    if (isWonderId(node.unlocks_building)) continue;
    opened.push(node.unlocks_building);
  }
  return opened;
}

/** Merge newly-earned rights into the player's permanent heritage set. */
export function storeHeritageUnlocks(player: PlayerState, unlocks: BuildingType[]): void {
  if (unlocks.length === 0) return;
  player.legacy_building_unlocks = [
    ...new Set([...(player.legacy_building_unlocks ?? []), ...unlocks]),
  ];
}

/**
 * May this player construct `buildingType` as far as TECH is concerned?
 *
 * The single source of truth for the build gate. The human `game:build` handler
 * and the AI build loop each used to inline their own copy of this, which is
 * exactly the shape of drift the AI-parity rule exists to prevent.
 */
export function isBuildingTechUnlocked(
  state: GameState,
  playerId: string,
  buildingType: BuildingType,
): boolean {
  if (!state.settings.tech_trees_enabled) return true;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return false;

  const requiringNode = currentEraTechForBuilding(state, player, buildingType);
  // Nothing in this era's tree gates it (ports, coastal batteries, and whole
  // tiers on the Space/Galactic trees) — unchanged behavior: freely buildable.
  if (!requiringNode) return true;

  if ((player.unlocked_techs ?? []).includes(requiringNode.tech_id)) return true;
  if (!heritageEnabled(state)) return false;
  return (player.legacy_building_unlocks ?? []).includes(buildingType);
}

/**
 * Classify one building on one territory.
 *
 * A missing era stamp means "raised before this feature existed": treated as
 * current, so deploying it never retroactively ages an in-flight game's board.
 */
export function buildingModernization(
  state: GameState,
  player: PlayerState,
  territory: TerritoryState,
  buildingType: BuildingType,
): BuildingModernization {
  if (!heritageEnabled(state)) return 'current';

  const builtAt = territory.building_eras?.[buildingType];
  if (builtAt == null) return 'current';
  const playerEra = player.current_era_index ?? 0;
  if (builtAt >= playerEra) return 'current';

  // Era-neutral infrastructure (ports, coastal batteries, whole tiers on the
  // Space and Galactic trees) has no current-era research to buy, so aging it
  // would be an unavoidable penalty. It simply does not age.
  const options = lineageTechsForBuilding(state, player, buildingType);
  if (options.length === 0) return 'current';

  const unlocked = new Set(player.unlocked_techs ?? []);
  return options.some((node) => unlocked.has(node.tech_id)) ? 'modernized' : 'aged';
}

/**
 * An aged building's yield, floored at 1 so a lone tier-1 building never falls
 * to nothing. In practice tier 1 is untouched and the penalty lands on the
 * higher tiers, which is where "outdated" should bite.
 */
export function agedYield(base: number): number {
  if (base <= 0) return base;
  return Math.max(1, Math.floor(base * AGED_BUILDING_YIELD_MULT));
}

/** Yield for one building of `buildingType`, given its base table value. */
export function effectiveBuildingYield(
  state: GameState,
  player: PlayerState | undefined,
  territory: TerritoryState,
  buildingType: BuildingType,
  base: number,
): number {
  if (base <= 0 || !player) return base;
  switch (buildingModernization(state, player, territory, buildingType)) {
    case 'aged':
      return agedYield(base);
    case 'modernized':
      return base + MODERNIZED_BUILDING_YIELD_BONUS;
    default:
      return base;
  }
}

/** Record the era a freshly-raised building belongs to. */
export function stampBuildingEra(
  state: GameState,
  player: PlayerState | undefined,
  territory: TerritoryState,
  buildingType: BuildingType,
): void {
  if (!heritageEnabled(state) || !player) return;
  if (!territory.building_eras) territory.building_eras = {};
  territory.building_eras[buildingType] = player.current_era_index ?? 0;
}

/** Drop a building's era stamp (upgrade replaces a tier; capture razes them). */
export function clearBuildingEra(territory: TerritoryState, buildingType: BuildingType): void {
  if (!territory.building_eras) return;
  delete territory.building_eras[buildingType];
  if (Object.keys(territory.building_eras).length === 0) delete territory.building_eras;
}

/** Drop every era stamp on a territory (capture razes all non-wonder buildings). */
export function clearAllBuildingEras(territory: TerritoryState): void {
  if (!territory.building_eras) return;
  for (const key of Object.keys(territory.building_eras) as BuildingType[]) {
    if (!isWonderId(key)) delete territory.building_eras[key];
  }
  if (Object.keys(territory.building_eras).length === 0) delete territory.building_eras;
}
