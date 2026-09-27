/** Layout mode for maps that use the galaxy strategic overview + per-world globes. */
export type MapKind = 'standard' | 'galaxy';

/** How orbit / hyperspace connections are gated server-side. */
export type OrbitAccessMode = 'none' | 'space_age_moon' | 'galaxy_hyperspace';

export interface MapTerritoryWorldLike {
  territory_id: string;
  region_id: string;
  world_id?: string;
  globe_id?: string;
}

/**
 * Per-world economic identity modifiers (galaxy maps). All optional + additive,
 * so worlds without them behave exactly as before. Income `*_bonus` values are
 * PER OWNED TERRITORY on the world and accumulate fractionally before flooring,
 * so they scale with how much of the world you hold and stay bounded by its size.
 * `build_cost_mult` multiplies the cost of buildings placed on that world.
 */
export interface WorldModifiers {
  /** + production per owned territory on this world (fractional, floored per turn). */
  production_bonus?: number;
  /** + tech points per owned territory on this world (fractional, floored per turn). */
  tech_bonus?: number;
  /** + stability recovery per owned territory on this world, per turn. */
  stability_bonus?: number;
  /** Multiplier on building costs for territories on this world (1 = no change, 0.8 = 20% cheaper). */
  build_cost_mult?: number;
}

/**
 * The prize region of a "vault" world: its tiles start neutral with a garrison,
 * and whoever holds every tile of it holds the Vault — tech income each turn
 * and, when `emergency_seal` is set, one Emergency Seal per turn on ANY lane.
 */
export interface WorldVaultRule {
  region_id: string;
  neutral_garrison: number;
  tech_income: number;
  emergency_seal?: boolean;
  /**
   * Extra starting units per tile for the world's home faction on the
   * four-homeworld start — pays for the ring they begin without.
   */
  home_unit_bonus?: number;
}

/**
 * One rule per world (galaxy maps) — a rule changes a decision, where the
 * numeric `WorldModifiers` only change a total. All optional; a world without
 * rules plays exactly as before. Snapshotted into `settings.world_rules` at
 * init, gated by `settings.world_rules_enabled` (default on).
 */
export interface WorldRules {
  /** Extra units the draft may place on one tile per turn, over the stability deploy cap. */
  deploy_cap_bonus?: number;
  /** Multiplier on the per-tick population growth chance for tiles on this world. */
  population_growth_mult?: number;
  /**
   * At round start every OWNED tile here holding FEWER than this many units
   * gains `muster_units` (default 1), never above the threshold — the storms'
   * mirror: a world that refills what it loses.
   */
  muster_threshold?: number;
  /** Units a thin owned tile gains each round under `muster_threshold` (default 1). */
  muster_units?: number;
  /** Muster only every Nth round (default 1: every round). */
  muster_every?: number;
  /** At round start a tile holding MORE than this many units loses `storm_attrition` units. */
  storm_threshold?: number;
  /** Units lost by a tile above `storm_threshold` each round (default 1). */
  storm_attrition?: number;
  /** Extra defender dice on a tile here that has at least one defence building. */
  defense_building_bonus_dice?: number;
  /** The world's prize region and what holding it grants. */
  vault?: WorldVaultRule;
}

/** Opening camera for one world of a galaxy map (see `MapWorldDefinition.globe_view`). */
export interface MapWorldGlobeView {
  center_lat: number;
  center_lng: number;
  altitude?: number;
  lock_rotation?: boolean;
}

/** Per-world rendering + access metadata on galaxy maps (optional on standard maps). */
export interface MapWorldDefinition {
  world_id: string;
  display_name: string;
  /** Economic identity modifiers for owners of this world's territories. */
  modifiers?: WorldModifiers;
  /** The world's rule — what playing there does differently (see `WorldRules`). */
  rules?: WorldRules;
  globe_image_url?: string;
  bump_image_url?: string;
  show_atmosphere?: boolean;
  atmosphere_color?: string;
  atmosphere_altitude?: number;
  background_color?: string;
  /**
   * Where this world's node sits on the galaxy chart, [x, y] in [0, 1] with the
   * origin top-left. Overrides the mean of its territories' `galaxy_position`,
   * so an authored board can lay its worlds out as a readable ring.
   */
  galaxy_position?: [number, number];
  /**
   * The globe camera when this world is focused, in the same shape as the
   * map-level `globe_view`. `lock_rotation` defaults to true there too, so a
   * world that should keep its idle spin sets it to false.
   */
  globe_view?: MapWorldGlobeView;
  /**
   * When true, a player needs hyperspace/orbit access before claiming this world's territories.
   * Movement within the same world does not require orbit tech on galaxy maps.
   */
  requires_orbit_access?: boolean;
  /**
   * When true, all territories on this world begin neutral with a small garrison
   * (legacy Space Age moon behavior). When false / unset on a galaxy era world,
   * territories on this world participate in normal distribution so factions can
   * spawn on their lore home rather than fight over Sol.
   */
  initial_neutral_garrison?: boolean;
}

/**
 * Canonical world id for a territory. Prefer explicit `world_id`; fall back to legacy `globe_id`
 * and moon heuristics used by Space Age maps that omit `world_id`.
 */
export function inferWorldId(t: MapTerritoryWorldLike): string {
  if (t.world_id && t.world_id.length > 0) return t.world_id;
  if (t.globe_id === 'moon') return 'moon';
  if (t.globe_id === 'earth') return 'earth';
  const tid = t.territory_id ?? '';
  if (
    t.region_id === 'lunar_surface' ||
    tid.startsWith('moon_') ||
    tid.includes('lunar')
  ) {
    return 'moon';
  }
  return 'earth';
}
