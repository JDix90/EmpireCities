import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadAdmin1Geo } from './useTerritoryGeoSources';
import { geometryLabelPoint, type LngLat, type PolyGeom } from '../components/editor/editorGeo';

/** One admin-1 unit: a state, province, oblast or region of a country that has them. */
export interface ProvinceInfo {
  /** ISO 3166-2, the code a territory's `admin1` list carries ("US-CA"). */
  code: string;
  name: string;
  /** The parent country's ISO 3166-1 alpha-2 code. */
  countryCode: string;
  /** "State", "Province", "Oblast"… as Natural Earth labels it. */
  kind: string;
  label: LngLat;
  geometry: PolyGeom;
}

export interface EditorProvinces {
  /** False until the file is loaded; `load()` starts it. */
  ready: boolean;
  loading: boolean;
  /** Fetch the provinces file (2 MB) the first time something needs it; resolves with the indexes. */
  load: () => Promise<ProvinceIndexes>;
  /** ISO 3166-2 code → geometry, for rendering `admin1` territories. */
  byCode: Map<string, PolyGeom>;
  /** Country code → its provinces, for splitting a country. */
  byCountry: Map<string, ProvinceInfo[]>;
  /** The countries the file has provinces for, known before loading. */
  countriesWithProvinces: ReadonlySet<string>;
}

/**
 * What the shipped ne_50m admin-1 file covers. Known up front so the editor
 * can offer "Split into provinces" on these countries without downloading
 * the file until the author asks.
 */
export const COUNTRIES_WITH_PROVINCES: ReadonlySet<string> = new Set([
  'RU', 'US', 'IN', 'ID', 'CN', 'BR', 'CA', 'AU', 'ZA',
]);

export interface ProvinceIndexes {
  byCode: Map<string, PolyGeom>;
  byCountry: Map<string, ProvinceInfo[]>;
}

const EMPTY: ProvinceIndexes = { byCode: new Map(), byCountry: new Map() };
const derivedCache = new WeakMap<GeoJSON.FeatureCollection, ProvinceIndexes>();

export function deriveProvinces(fc: GeoJSON.FeatureCollection): ProvinceIndexes {
  const cached = derivedCache.get(fc);
  if (cached) return cached;
  const byCode = new Map<string, PolyGeom>();
  const byCountry = new Map<string, ProvinceInfo[]>();
  for (const f of fc.features ?? []) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const code = props['iso_3166_2'];
    const countryCode = props['iso_a2'];
    const g = f.geometry;
    if (typeof code !== 'string' || typeof countryCode !== 'string') continue;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const geometry = g as PolyGeom;
    byCode.set(code, geometry);
    const lng = props['longitude'];
    const lat = props['latitude'];
    const label: LngLat = typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : geometryLabelPoint(geometry);
    const list = byCountry.get(countryCode) ?? [];
    list.push({
      code,
      name: typeof props['name'] === 'string' ? (props['name'] as string) : code,
      countryCode,
      kind: typeof props['type_en'] === 'string' ? (props['type_en'] as string) : 'Province',
      label,
      geometry,
    });
    byCountry.set(countryCode, list);
  }
  for (const list of byCountry.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const result = { byCode, byCountry };
  derivedCache.set(fc, result);
  return result;
}

/**
 * The Natural Earth admin-1 set, loaded on demand: when the author splits a
 * country, or when a map with `admin1` territories opens.
 */
export function useEditorProvinces(autoLoad = false): EditorProvinces {
  const [collection, setCollection] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<Promise<ProvinceIndexes> | null>(null);

  const load = useCallback((): Promise<ProvinceIndexes> => {
    if (collection) return Promise.resolve(deriveProvinces(collection));
    if (pending.current) return pending.current;
    setLoading(true);
    pending.current = loadAdmin1Geo()
      .then((fc) => {
        setCollection(fc);
        return deriveProvinces(fc);
      })
      .finally(() => {
        setLoading(false);
        pending.current = null;
      });
    return pending.current;
  }, [collection]);

  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);

  const derived = useMemo(() => (collection ? deriveProvinces(collection) : EMPTY), [collection]);
  return {
    ready: collection !== null,
    loading,
    load,
    byCode: derived.byCode,
    byCountry: derived.byCountry,
    countriesWithProvinces: COUNTRIES_WITH_PROVINCES,
  };
}
