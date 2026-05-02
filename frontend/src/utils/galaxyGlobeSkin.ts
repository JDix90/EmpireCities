import { inferWorldId } from '@erasofempire/shared';

export interface GalaxyWorldSkinRow {
  world_id: string;
  display_name?: string;
  globe_image_url?: string;
  bump_image_url?: string;
  show_atmosphere?: boolean;
  atmosphere_color?: string;
  atmosphere_altitude?: number;
  background_color?: string;
}

export interface GalaxyTerritorySkinRow {
  territory_id: string;
  /** Required for `inferWorldId` parity with `MapTerritory`. */
  region_id: string;
  world_id?: string;
  globe_id?: string;
  globe_image_url?: string;
  bump_image_url?: string;
}

export interface ResolvedGalaxyGlobeSkin {
  globeImageUrl: string | undefined;
  bumpImageUrl: string | undefined;
  showAtmosphere: boolean;
  atmosphereColor: string;
  atmosphereAltitude: number;
  backgroundColor: string | undefined;
}

/**
 * Galaxy drill-down: each territory may override diffuse + bump; atmosphere
 * and void background stay on the parent world unless extended later.
 */
export function resolveGalaxyDrillDownGlobeSkin(input: {
  worlds: GalaxyWorldSkinRow[] | undefined;
  territories: GalaxyTerritorySkinRow[] | undefined;
  focusedWorldId: string;
  selectedTerritoryId: string | null | undefined;
}): ResolvedGalaxyGlobeSkin {
  const world = input.worlds?.find((w) => w.world_id === input.focusedWorldId);
  const base: ResolvedGalaxyGlobeSkin = {
    globeImageUrl: world?.globe_image_url,
    bumpImageUrl: world?.bump_image_url,
    showAtmosphere: world?.show_atmosphere ?? true,
    atmosphereColor: world?.atmosphere_color ?? 'lightskyblue',
    atmosphereAltitude: world?.atmosphere_altitude ?? 0.15,
    backgroundColor: world?.background_color,
  };

  const tid = input.selectedTerritoryId;
  if (!tid || !input.territories) return base;

  const terr = input.territories.find((t) => t.territory_id === tid);
  if (!terr?.globe_image_url) return base;
  if (inferWorldId(terr) !== input.focusedWorldId) return base;

  return {
    globeImageUrl: terr.globe_image_url,
    bumpImageUrl: terr.bump_image_url !== undefined ? terr.bump_image_url : base.bumpImageUrl,
    showAtmosphere: base.showAtmosphere,
    atmosphereColor: base.atmosphereColor,
    atmosphereAltitude: base.atmosphereAltitude,
    backgroundColor: base.backgroundColor,
  };
}
