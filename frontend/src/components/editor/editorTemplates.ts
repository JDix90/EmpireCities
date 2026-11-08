/**
 * Starting points for a new map, built from the Natural Earth country set the
 * editor already draws: every country of a continent as a territory, grouped
 * into regions by UN subregion, with the land borders the outlines share and
 * sea lanes across the straits — then bridged until every island can be
 * reached, and each region given the bonus the rule of thumb suggests.
 *
 * The result is a playable draft in one click; everything in it is an
 * ordinary territory, connection or region the author can then reshape.
 */

import type { EditorConnection, EditorRegion, EditorTerritory } from './editorGlobeData';
import {
  bridgeComponents,
  classifyNeighbor,
  largestExteriorRing,
  regionStats,
  suggestRegionBonus,
  type LngLat,
  type PolyGeom,
} from './editorGeo';
import { mapComponents } from '@borderfall/shared';

export interface CountryInfo {
  code: string;
  name: string;
  continent: string;
  subregion: string;
  areaKm2: number;
  /** Natural Earth's label anchor, or the largest ring's centroid. */
  label: LngLat;
  geometry: PolyGeom;
}

export interface ContinentOption {
  name: string;
  /** Countries at or above the small-country threshold. */
  large: number;
  /** Countries below it: microstates and small islands, hidden by default. */
  small: number;
}

/** Below this a country is a microstate or a small island: Luxembourg, Brunei, most of the Caribbean. */
export const SMALL_COUNTRY_KM2 = 5000;

/** Not places to fight over. */
const SKIPPED_CONTINENTS = new Set(['Seven seas (open ocean)', 'Antarctica']);

export function continentOptions(countries: CountryInfo[]): ContinentOption[] {
  const byName = new Map<string, ContinentOption>();
  for (const c of countries) {
    if (SKIPPED_CONTINENTS.has(c.continent)) continue;
    const option = byName.get(c.continent) ?? { name: c.continent, large: 0, small: 0 };
    if (c.areaKm2 >= SMALL_COUNTRY_KM2) option.large += 1;
    else option.small += 1;
    byName.set(c.continent, option);
  }
  return Array.from(byName.values()).sort((a, b) => b.large - a.large);
}

export function slugId(prefix: string, text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${prefix}_${slug || 'x'}`;
}

export interface TemplateContent {
  territories: EditorTerritory[];
  connections: EditorConnection[];
  regions: EditorRegion[];
}

export interface TemplateOptions {
  includeSmall?: boolean;
  /** Vertices per outline the neighbour test looks at; fewer is faster and coarser. */
  maxVertices?: number;
}

/**
 * One territory per country of the continent. Regions follow the UN
 * subregions; a subregion left with a single member is folded into the region
 * it borders (or the largest), because a bonus region of one never pays.
 */
export function buildContinentTemplate(
  countries: CountryInfo[],
  continent: string,
  options: TemplateOptions = {},
): TemplateContent {
  const includeSmall = options.includeSmall ?? false;
  const members = countries
    .filter((c) => c.continent === continent && (includeSmall || c.areaKm2 >= SMALL_COUNTRY_KM2))
    .sort((a, b) => a.name.localeCompare(b.name));
  return buildTemplateFromCountries(members, options);
}

export function buildTemplateFromCountries(members: CountryInfo[], options: TemplateOptions = {}): TemplateContent {
  const maxVertices = options.maxVertices ?? 300;

  const regionIdOf = (subregion: string) => slugId('region', subregion || 'region');
  const regionsById = new Map<string, EditorRegion>();
  const territories: EditorTerritory[] = members.map((c) => {
    const region_id = regionIdOf(c.subregion);
    if (!regionsById.has(region_id)) {
      regionsById.set(region_id, { region_id, name: c.subregion || 'Region', bonus: 1 });
    }
    return {
      territory_id: slugId('t', c.code),
      name: c.name,
      polygon: largestExteriorRing(c.geometry),
      center_point: c.label,
      region_id,
      iso_codes: [c.code],
    };
  });

  // Borders and straits between every pair that comes close.
  const connections: EditorConnection[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const match = classifyNeighbor(members[i].geometry, members[j].geometry, { maxVertices });
      if (!match) continue;
      connections.push({ from: territories[i].territory_id, to: territories[j].territory_id, type: match.type });
    }
  }

  // Islands reach the mainland by the shortest crossing.
  const geometries = new Map(members.map((c, i) => [territories[i].territory_id, c.geometry] as const));
  const components = mapComponents(territories.map((t) => t.territory_id), connections);
  for (const edge of bridgeComponents(components, geometries, maxVertices)) {
    connections.push({ from: edge.from, to: edge.to, type: 'sea' });
  }

  // Fold single-member regions into a neighbour, then price every region.
  const regions = foldThinRegions(territories, connections, Array.from(regionsById.values()));
  const stats = regionStats(territories, connections);
  for (const region of regions) {
    const s = stats.get(region.region_id);
    region.bonus = Math.max(1, s ? suggestRegionBonus(s.size, s.borders) : 1);
  }

  return { territories, connections, regions };
}

/**
 * Moves the lone member of any single-territory region into the region of a
 * territory it connects to (the largest such, else the largest region
 * overall), and drops regions left empty. Mutates the territories' region_id.
 */
export function foldThinRegions(
  territories: EditorTerritory[],
  connections: EditorConnection[],
  regions: EditorRegion[],
): EditorRegion[] {
  const count = () => {
    const m = new Map<string, number>();
    for (const t of territories) m.set(t.region_id, (m.get(t.region_id) ?? 0) + 1);
    return m;
  };
  let counts = count();
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of territories) {
      if ((counts.get(t.region_id) ?? 0) !== 1) continue;
      const neighbourRegions = connections
        .filter((c) => c.from === t.territory_id || c.to === t.territory_id)
        .map((c) => (c.from === t.territory_id ? c.to : c.from))
        .map((id) => territories.find((x) => x.territory_id === id)?.region_id)
        .filter((r): r is string => !!r && r !== t.region_id);
      const candidates = neighbourRegions.length > 0
        ? neighbourRegions
        : regions.map((r) => r.region_id).filter((r) => r !== t.region_id && (counts.get(r) ?? 0) > 0);
      if (candidates.length === 0) continue;
      const target = candidates.reduce((best, r) => ((counts.get(r) ?? 0) > (counts.get(best) ?? 0) ? r : best));
      t.region_id = target;
      counts = count();
      changed = true;
    }
  }
  return regions.filter((r) => (counts.get(r.region_id) ?? 0) > 0);
}
