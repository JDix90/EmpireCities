/**
 * Client mirror of the server's heritage / modernize rules
 * (`backend/src/game-engine/eraAdvancement/buildingHeritage.ts`).
 *
 * Display only — the server decides what may be built and what a building
 * yields. This exists so the build panel can say "inherited from the Ancient
 * era" and "aged, research Masonry to modernize" instead of offering a button
 * the server then refuses, or showing a yield the player does not actually get.
 */

export type BuildingModernization = 'current' | 'aged' | 'modernized';

/** Mirrors AGED_BUILDING_YIELD_MULT / MODERNIZED_BUILDING_YIELD_BONUS. */
export const AGED_BUILDING_YIELD_MULT = 0.75;
export const MODERNIZED_BUILDING_YIELD_BONUS = 1;

interface HeritageSettings {
  era_advancement_enabled?: boolean;
  tech_trees_enabled?: boolean;
  era_heritage_buildings_enabled?: boolean;
}

interface HeritagePlayer {
  current_era_index?: number;
  unlocked_techs?: string[];
  legacy_building_unlocks?: string[];
}

interface HeritageTerritory {
  building_eras?: Record<string, number>;
}

/**
 * Only the fields this module needs. `name` and `cost` are optional because the
 * territory panel is handed a narrowed projection of the tech tree, not the
 * full node.
 */
export interface HeritageTechNode {
  tech_id: string;
  name?: string;
  cost?: number;
  unlocks_building?: string;
}

export function heritageEnabled(settings: HeritageSettings | undefined): boolean {
  return (
    settings?.era_heritage_buildings_enabled === true &&
    settings?.era_advancement_enabled === true &&
    settings?.tech_trees_enabled === true
  );
}

/** The upgrade ladder a building belongs to (tier-3 walls share it with tier-1). */
export function buildingLineageKey(buildingType: string): string {
  if (buildingType.startsWith('production_')) return 'production';
  if (buildingType.startsWith('defense_')) return 'defense';
  if (buildingType.startsWith('tech_gen_')) return 'tech_gen';
  if (buildingType === 'port' || buildingType === 'naval_base') return 'naval';
  return buildingType;
}

/** Current-era techs covering this building's ladder, cheapest first. */
export function lineageTechs(
  techTree: HeritageTechNode[],
  buildingType: string,
): HeritageTechNode[] {
  const lineage = buildingLineageKey(buildingType);
  return techTree
    .filter((n) => n.unlocks_building && buildingLineageKey(n.unlocks_building) === lineage)
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));
}

/** Cheapest research that would modernize this building, or undefined if none applies. */
export function modernizingTech(
  techTree: HeritageTechNode[],
  player: HeritagePlayer | undefined,
  buildingType: string,
): HeritageTechNode | undefined {
  const unlocked = new Set(player?.unlocked_techs ?? []);
  const options = lineageTechs(techTree, buildingType);
  if (options.some((n) => unlocked.has(n.tech_id))) return undefined;
  return options[0];
}

export function buildingModernization(
  settings: HeritageSettings | undefined,
  player: HeritagePlayer | undefined,
  territory: HeritageTerritory | undefined,
  buildingType: string,
  techTree: HeritageTechNode[],
): BuildingModernization {
  if (!heritageEnabled(settings) || !player) return 'current';
  const builtAt = territory?.building_eras?.[buildingType];
  if (builtAt == null) return 'current';
  if (builtAt >= (player.current_era_index ?? 0)) return 'current';

  const options = lineageTechs(techTree, buildingType);
  if (options.length === 0) return 'current';
  const unlocked = new Set(player.unlocked_techs ?? []);
  return options.some((n) => unlocked.has(n.tech_id)) ? 'modernized' : 'aged';
}

/** An aged building's yield — floored at 1, matching the server. */
export function agedYield(base: number): number {
  if (base <= 0) return base;
  return Math.max(1, Math.floor(base * AGED_BUILDING_YIELD_MULT));
}

/** What one building actually yields on a stat, given its base table value. */
export function effectiveYield(state: BuildingModernization, base: number): number {
  if (base <= 0) return base;
  if (state === 'aged') return agedYield(base);
  if (state === 'modernized') return base + MODERNIZED_BUILDING_YIELD_BONUS;
  return base;
}

/**
 * True when the player may raise this building only because of a right they
 * inherited from an era they have left — the case the build panel labels, so
 * the affordance is not mistaken for an unlock they never bought.
 */
export function isHeritageOnlyUnlock(
  settings: HeritageSettings | undefined,
  player: HeritagePlayer | undefined,
  buildingType: string,
  techTree: HeritageTechNode[],
): boolean {
  if (!heritageEnabled(settings) || !player) return false;
  if (!(player.legacy_building_unlocks ?? []).includes(buildingType)) return false;
  const gate = techTree.find((n) => n.unlocks_building === buildingType);
  if (!gate) return false;
  return !(player.unlocked_techs ?? []).includes(gate.tech_id);
}
