import { useEffect, useState } from 'react';
import type { GlobeGeometryInputs } from '../utils/globeTerritoryGeometry';

/**
 * Loads the Natural Earth / pre-extracted GeoJSON sources that
 * buildTerritoryGlobeGeometries consumes. Mirrors GlobeMap's per-map
 * conditions, with a module-level promise cache so the 2D map and the globe
 * share a single network fetch per source.
 */

const COUNTRIES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson';
const STATES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_1_states_provinces.geojson';
const ADMIN50_STATES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson';
const RISORGIMENTO_GEOJSON_URL = '/geo/risorgimento_admin1.json';
const STRAIT_HORMUZ_GEOJSON_URL = '/geo/strait_hormuz_admin1.json';
const AUSTRALIA_GEOJSON_URL = '/geo/australia_1337_admin1.json';
const BRITAIN_GEOJSON_URL = '/geo/britain_925_admin1.json';
const HORN_AFRICA_GEOJSON_URL = '/geo/horn_africa_admin1.json';
const MEXICO_GEOJSON_URL = '/geo/mexico_admin1.json';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const cache = new Map<string, Promise<GeoJSON.FeatureCollection>>();

function fetchGeo(url: string): Promise<GeoJSON.FeatureCollection> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.json() as Promise<GeoJSON.FeatureCollection>)
      .catch((err) => {
        console.warn('Failed to load GeoJSON source:', url, err);
        cache.delete(url); // allow retry on next mount
        return EMPTY;
      });
    cache.set(url, p);
  }
  return p;
}

export interface GeoSourceMapInfo {
  map_id?: string;
  territories: Array<{ territory_id: string }>;
}

/** Which sources a map needs, mirroring GlobeMap's trigger conditions. */
export function requiredGeoSourceUrls(
  mapData: GeoSourceMapInfo,
): Record<keyof GlobeGeometryInputs, string | null> {
  const hasPrefix = (prefix: string) =>
    mapData.territories.some((t) => t.territory_id.startsWith(prefix));
  return {
    countriesGeo: COUNTRIES_GEOJSON_URL,
    statesGeo: STATES_GEOJSON_URL,
    risorgimentoGeo:
      mapData.map_id === 'era_risorgimento' || hasPrefix('ris_') ? RISORGIMENTO_GEOJSON_URL : null,
    admin50Geo:
      mapData.map_id === 'community_14_nations' || hasPrefix('na_') ? ADMIN50_STATES_GEOJSON_URL : null,
    straitHormuzGeo:
      mapData.map_id === 'community_strait_hormuz' || hasPrefix('hz_') ? STRAIT_HORMUZ_GEOJSON_URL : null,
    australiaGeo: mapData.map_id === 'community_australia_1337' ? AUSTRALIA_GEOJSON_URL : null,
    britainGeo: mapData.map_id === 'community_britain_925' ? BRITAIN_GEOJSON_URL : null,
    hornAfricaGeo: mapData.map_id === 'community_horn_africa' ? HORN_AFRICA_GEOJSON_URL : null,
    mexicoGeo:
      mapData.map_id === 'community_14_nations' || hasPrefix('mx_') ? MEXICO_GEOJSON_URL : null,
  };
}

/**
 * Returns the loaded geometry inputs, or null until every required source for
 * this map has resolved (failures resolve to empty collections, so the hook
 * always settles).
 */
export function useTerritoryGeoSources(
  mapData: GeoSourceMapInfo,
  enabled = true,
): GlobeGeometryInputs | null {
  const [sources, setSources] = useState<GlobeGeometryInputs | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSources(null);
    // Gated: galaxy/canvas-only maps never consume these sources — don't
    // download megabytes of Natural Earth data they provably discard.
    if (!enabled) return;
    const urls = requiredGeoSourceUrls(mapData);
    const keys = Object.keys(urls) as Array<keyof GlobeGeometryInputs>;
    Promise.all(keys.map((k) => (urls[k] ? fetchGeo(urls[k]!) : Promise.resolve(null))))
      .then((results) => {
        if (cancelled) return;
        const out = {} as GlobeGeometryInputs;
        keys.forEach((k, i) => { out[k] = results[i]; });
        setSources(out);
      });
    return () => { cancelled = true; };
    // mapData identity changes when the map changes; territories list is stable per map.
  }, [mapData, enabled]);

  return sources;
}
