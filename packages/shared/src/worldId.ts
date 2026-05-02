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

/** Per-world rendering + access metadata on galaxy maps (optional on standard maps). */
export interface MapWorldDefinition {
  world_id: string;
  display_name: string;
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
