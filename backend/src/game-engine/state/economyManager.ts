// ============================================================
// Economy Manager — buildings, production, tech point income
// ============================================================

import type { GameState, BuildingType } from '../../types';
import { getStabilityMultiplier, getPopulationMultiplier } from './stabilityManager';
import { getTemporaryModifierValue } from '../events/eventCardManager';
import { isWonderId, isWonderBuilt } from './wonderManager';
import { getEconomyConfig } from '../../services/adminConfig';
import { getWorldModifier, applyWorldBuildCost } from './worldModifiers';

// ── Building definitions ──────────────────────────────────────────────────────

/** Gold / production units required to build each type. */
const DEFAULT_BUILDING_COSTS: Record<BuildingType, number> = {
  production_1: 3,
  production_2: 6,
  production_3: 10,
  production_4: 15,
  defense_1: 3,
  defense_2: 6,
  defense_3: 10,
  tech_gen_1: 4,
  tech_gen_2: 8,
  special_a: 5,
  special_b: 8,
  port: 5,
  naval_base: 10,
  coastal_battery: 4,
  // Era wonders
  wonder_colosseum:   18,
  wonder_cathedral:   20,
  wonder_lighthouse:  18,
  wonder_manhattan:   25,
  wonder_sputnik:     20,
  wonder_cern:        22,
  wonder_arsenal:     18,
  wonder_unification: 20,
  wonder_space_elevator: 25,
  wonder_hyperlane_anchor: 22,
  // Space Age buildings
  launch_pad: 8,
};

/** The building a tier must upgrade from (null = no prerequisite). */
export const BUILDING_PREREQUISITES: Partial<Record<BuildingType, BuildingType>> = {
  production_2: 'production_1',
  production_3: 'production_2',
  production_4: 'production_3',
  defense_2: 'defense_1',
  defense_3: 'defense_2',
  tech_gen_2: 'tech_gen_1',
  naval_base: 'port',
};

/** Extra reinforcement units produced per territory per turn from production buildings. */
const DEFAULT_BUILDING_PRODUCTION_INCOME: Partial<Record<BuildingType, number>> = {
  production_1: 1,
  production_2: 2,
  production_3: 4,
  production_4: 7,
};

/** Tech points generated per turn from tech-gen buildings. */
export const BUILDING_TECH_INCOME: Partial<Record<BuildingType, number>> = {
  tech_gen_1: 2,
  tech_gen_2: 4,
};

/** Defender dice bonus when a defense building is present. */
export const BUILDING_DEFENSE_BONUS: Partial<Record<BuildingType, number>> = {
  defense_1: 1,
  defense_2: 2,
  defense_3: 3,
};

/**
 * Maximum one building of each category per territory:
 * production (any tier), defense (any tier), tech_gen (any tier), special_a, special_b.
 */
function buildingCategory(b: BuildingType): string {
  if (b.startsWith('production')) return 'production';
  if (b.startsWith('defense')) return 'defense';
  if (b.startsWith('tech_gen')) return 'tech_gen';
  if (b === 'port' || b === 'naval_base') return 'naval';
  if (isWonderId(b)) return 'wonder';
  return b; // special_a, special_b — unique each
}

function resolveBuildingCosts(state: GameState): Record<BuildingType, number> {
  return state.settings.economy_snapshot?.building_costs as Record<BuildingType, number>
    ?? getEconomyConfig().building_costs
    ?? DEFAULT_BUILDING_COSTS;
}

function resolveProductionIncome(state: GameState): Partial<Record<BuildingType, number>> {
  return state.settings.economy_snapshot?.production_income
    ?? getEconomyConfig().production_income
    ?? DEFAULT_BUILDING_PRODUCTION_INCOME;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface BuildValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Check whether a player may construct `buildingType` on `territoryId`.
 *
 * Rules enforced:
 * - Economy feature must be enabled on the game.
 * - Territory must be owned by the requesting player.
 * - Player must have enough accumulated production points (PlayerState.special_resource).
 * - Only one building per category allowed per territory.
 * - Prerequisite tier must be present.
 * - If tech trees are enabled, the player must have unlocked the corresponding
 *   tech node (verified externally — caller may pass `techUnlocked` flag).
 */
export function validateBuild(
  state: GameState,
  playerId: string,
  territoryId: string,
  buildingType: BuildingType,
  techUnlocked = true
): BuildValidationResult {
  if (!state.settings.economy_enabled) {
    return { valid: false, error: 'Economy feature is not enabled for this game' };
  }

  const territory = state.territories[territoryId];
  if (!territory || territory.owner_id !== playerId) {
    return { valid: false, error: 'Territory not owned by you' };
  }

  if (!techUnlocked) {
    return { valid: false, error: 'You must research the required technology first' };
  }

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return { valid: false, error: 'Player not found' };

  const cost = applyWorldBuildCost(state, territory.world_id, resolveBuildingCosts(state)[buildingType]);
  const playerProduction = player.special_resource ?? 0;
  if (playerProduction < cost) {
    return { valid: false, error: `Not enough production points (need ${cost}, have ${playerProduction})` };
  }

  const existingBuildings = territory.buildings ?? [];
  const category = buildingCategory(buildingType);

  // Wonders are globally unique per era per game
  if (category === 'wonder') {
    if (isWonderBuilt(state)) {
      return { valid: false, error: 'The Wonder for this era has already been built' };
    }
    // Only 1 wonder slot per territory (no two wonders can share a territory)
    if (existingBuildings.some((b) => isWonderId(b))) {
      return { valid: false, error: 'This territory already has a Wonder' };
    }
  }

  if (category !== 'wonder') {
    // Allow upgrades: if this is an upgrade (has a prerequisite), allow if the prerequisite exists and the upgrade is not already present
    const prereq = BUILDING_PREREQUISITES[buildingType];
    if (prereq) {
      // If the upgrade is already present, block
      if (existingBuildings.includes(buildingType)) {
        return { valid: false, error: `Territory already has a ${BUILDING_LABEL(buildingType)}` };
      }
      // If the prerequisite is present, allow (upgrade path)
      if (existingBuildings.includes(prereq)) {
        // OK to upgrade
      } else {
        return { valid: false, error: `Must build ${prereq} before ${buildingType}` };
      }
    } else {
      // Not an upgrade: block if any building of this category exists
      const hasCategory = existingBuildings.some((b) => buildingCategory(b) === category);
      if (hasCategory) {
        return { valid: false, error: `Territory already has a ${category} building` };
      }
    }
  }


  // Prerequisite check is now handled above for upgrades

  // Wonders have no tier prerequisites
  if (category === 'wonder') return { valid: true };

  // Naval buildings require a coastal territory (naval_units is set on coastal territories)
  if ((buildingType === 'port' || buildingType === 'naval_base') && territory.naval_units == null) {
    return { valid: false, error: 'Can only build naval structures on coastal territories' };
  }

  // Coastal Battery ("Fortify the Coast"): requires an existing harbor (Port or Naval Base)
  // on the territory. Because Port must itself be coastal, this transitively enforces the
  // sea-adjacency requirement without needing the map document here.
  if (buildingType === 'coastal_battery') {
    const hasHarbor = existingBuildings.includes('port') || existingBuildings.includes('naval_base');
    if (!hasHarbor) {
      return { valid: false, error: 'Coastal Battery requires a Port or Naval Base on this territory' };
    }
  }

  return { valid: true };
}

// Human-readable label for a building type. Lifted out of validateBuild so the
// helper isn't redeclared on every call (it was previously a nested function
// declaration whose hoisting masked the fact that a duplicate prevTier check
// after the early `return { valid: true }` was permanently dead code).
function BUILDING_LABEL(buildingType: string): string {
  switch (buildingType) {
    case 'production_1': return 'Camp';
    case 'production_2': return 'Barracks';
    case 'production_3': return 'Arsenal';
    case 'production_4': return 'Trade Hub';
    case 'defense_1': return 'Palisade';
    case 'defense_2': return 'Fortress';
    case 'defense_3': return 'Citadel';
    case 'tech_gen_1': return 'Laboratory';
    case 'tech_gen_2': return 'Research Center';
    case 'port': return 'Port';
    case 'naval_base': return 'Naval Base';
    case 'coastal_battery': return 'Coastal Battery';
    default: return buildingType;
  }
}

/**
 * Apply a successful build: deduct cost and add (or upgrade) building.
 * Upgrade replaces the previous tier; other buildings are added.
 */
export function applyBuild(
  state: GameState,
  playerId: string,
  territoryId: string,
  buildingType: BuildingType
): void {
  const territory = state.territories[territoryId];
  const player = state.players.find((p) => p.player_id === playerId);
  if (!territory || !player) return;

  const cost = applyWorldBuildCost(state, territory.world_id, resolveBuildingCosts(state)[buildingType]);
  player.special_resource = (player.special_resource ?? 0) - cost;

  if (!territory.buildings) territory.buildings = [];

  // Upgrade: remove previous tier in same category
  const prevTierMap: Partial<Record<BuildingType, BuildingType>> = {
    production_2: 'production_1',
    production_3: 'production_2',
    production_4: 'production_3',
    defense_2: 'defense_1',
    defense_3: 'defense_2',
    tech_gen_2: 'tech_gen_1',
    naval_base: 'port',
  };
  const prevTier = prevTierMap[buildingType];
  if (prevTier) {
    territory.buildings = territory.buildings.filter((b) => b !== prevTier);
  }

  territory.buildings.push(buildingType);
}

// ── Production tick ───────────────────────────────────────────────────────────

/**
 * Called at the start of a player's turn.
 * Accumulates production units (→ PlayerState.special_resource) and tech points
 * (→ PlayerState.tech_points) from all owned territories' buildings.
 *
 * Returns a summary for logging / client notification.
 */
export function collectProduction(
  state: GameState,
  playerId: string,
): { productionEarned: number; techPointsEarned: number } {
  if (!state.settings.economy_enabled) return { productionEarned: 0, techPointsEarned: 0 };

  let productionEarned = 0;
  let techPointsEarned = 0;
  let ownedCount = 0;
  let worldProdAccum = 0;
  let worldTechAccum = 0;

  for (const territory of Object.values(state.territories)) {
    if (territory.owner_id !== playerId) continue;
    ownedCount++;
    const worldMod = getWorldModifier(state, territory.world_id);
    worldProdAccum += worldMod.production_bonus ?? 0;
    worldTechAccum += worldMod.tech_bonus ?? 0;
    const stabilityScale = state.settings.stability_enabled
      ? getStabilityMultiplier(territory.stability)
      : 1;
    const popScale = state.settings.stability_enabled
      ? getPopulationMultiplier(territory.population)
      : 1;
    for (const building of territory.buildings ?? []) {
      productionEarned += Math.floor((resolveProductionIncome(state)[building] ?? 0) * stabilityScale * popScale);
      techPointsEarned += Math.floor((BUILDING_TECH_INCOME[building] ?? 0) * stabilityScale * popScale);
    }
  }

  // Base income: 1 resource per 3 territories (min 1), so players can bootstrap
  productionEarned += Math.max(1, Math.floor(ownedCount / 3));
  // Base tech income: 1 TP per 5 territories when tech trees are enabled
  if (state.settings.tech_trees_enabled) {
    techPointsEarned += Math.max(1, Math.floor(ownedCount / 5));
  }

  // Galaxy per-world identity: production/tech bonus per owned territory on a world
  // (accumulated fractionally, then floored — bounded by how much of the world you hold).
  if (worldProdAccum > 0) productionEarned += Math.floor(worldProdAccum);
  if (state.settings.tech_trees_enabled && worldTechAccum > 0) {
    techPointsEarned += Math.floor(worldTechAccum);
  }

  // Apply production_bonus temporary modifier from event cards (may be negative)
  const productionModifier = getTemporaryModifierValue(state, playerId, 'production_bonus');
  if (productionModifier !== 0) {
    productionEarned = Math.max(0, productionEarned + productionModifier);
  }

  const player = state.players.find((p) => p.player_id === playerId);
  if (player) {
    player.special_resource = (player.special_resource ?? 0) + productionEarned;
    if (state.settings.era_advancement_enabled) {
      player.last_turn_production_income = productionEarned;
    }
    if (state.settings.tech_trees_enabled) {
      player.tech_points = (player.tech_points ?? 0) + techPointsEarned;
    }
  }

  return { productionEarned, techPointsEarned };
}

/** Count non-wonder buildings across all territories owned by a player. */
export function countPlayerBuildings(state: GameState, playerId: string): number {
  let count = 0;
  for (const territory of Object.values(state.territories)) {
    if (territory.owner_id !== playerId) continue;
    for (const building of territory.buildings ?? []) {
      if (!isWonderId(building)) count += 1;
    }
  }
  return count;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calculate the total defender dice bonus from buildings on a territory.
 * Note: this is the *unconditional* defense bonus (applies regardless of attack vector).
 * Sea-only bonuses (e.g. Coastal Battery) are returned separately by `getSeaDefenseBonus`
 * so callers can gate them on the connection type.
 */
export function getBuildingDefenseBonus(state: GameState, territoryId: string): number {
  const territory = state.territories[territoryId];
  if (!territory || !state.settings.economy_enabled) return 0;
  let bonus = 0;
  for (const building of territory.buildings ?? []) {
    bonus += BUILDING_DEFENSE_BONUS[building] ?? 0;
  }
  return bonus;
}

/** Defender dice bonus (per coastal_battery) that applies ONLY when the incoming
 *  attack traverses a sea connection. The caller is responsible for checking that
 *  the attack route is a sea connection before adding this to the total.
 */
export const COASTAL_BATTERY_SEA_DEFENSE_BONUS = 1;

/**
 * Returns the defender dice bonus from sea-conditional buildings on this territory
 * (currently: `coastal_battery`). Returns 0 when:
 *   - `economy_enabled` is off,
 *   - the territory does not exist, or
 *   - the territory has no coastal battery.
 *
 * This intentionally does NOT check the connection type — callers pass the result
 * through only when the attack is confirmed to come via a sea connection.
 */
export function getSeaDefenseBonus(state: GameState, territoryId: string): number {
  const territory = state.territories[territoryId];
  if (!territory || !state.settings.economy_enabled) return 0;
  return (territory.buildings ?? []).includes('coastal_battery')
    ? COASTAL_BATTERY_SEA_DEFENSE_BONUS
    : 0;
}

/**
 * When a territory is captured, destroy all buildings EXCEPT wonders (which survive capture).
 */
export function onTerritoryCapture(state: GameState, territoryId: string): void {
  const territory = state.territories[territoryId];
  if (!territory) return;
  if (state.settings.economy_enabled) {
    // Preserve wonders — raze everything else
    territory.buildings = (territory.buildings ?? []).filter((b) => isWonderId(b));
    territory.production_bonus = 0;
  }
  // Raze fleet on capture regardless of economy toggle — port is destroyed
  if (territory.naval_units != null) {
    territory.naval_units = 0;
  }
}
