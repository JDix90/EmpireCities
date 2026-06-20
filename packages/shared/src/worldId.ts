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

/** Per-world rendering + access metadata on galaxy maps (optional on standard maps). */
export interface MapWorldDefinition {
  world_id: string;
  display_name: string;
  /** Economic identity modifiers for owners of this world's territories. */
  modifiers?: WorldModifiers;
  globe_image_url?: string;
  bump_image_url?: string;
  show_atmosphere?: boolean;
  atmosphere_color?: string;
  atmosphere_altitude?: number;
  background_color?: string;
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
