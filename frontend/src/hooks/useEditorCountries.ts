import { useEffect, useMemo, useState } from 'react';
import { loadCountriesGeo } from './useTerritoryGeoSources';
import { registerPossessionFeatures } from '../utils/countryHomeland';
import {
  buildCountryData,
  featureIsoCode,
  type EditorPolygonDatum,
} from '../components/editor/editorGlobeData';
import { geometryAreaKm2, geometryLabelPoint, type LngLat } from '../components/editor/editorGeo';
import type { CountryInfo } from '../components/editor/editorTemplates';

export interface EditorCountries {
  /** False until the Natural Earth file has loaded (or failed, leaving an empty set). */
  ready: boolean;
  /** ISO code → features, with the overseas pieces trimmed from their parents registered under their own codes. */
  isoToFeatures: Map<string, GeoJSON.Feature[]>;
  /** The outlines the globe draws for the picker, one datum per code. */
  countryData: EditorPolygonDatum[];
  /** Names, continents, areas and label anchors, for search and templates. */
  countries: CountryInfo[];
}

interface Derived {
  isoToFeatures: Map<string, GeoJSON.Feature[]>;
  countryData: EditorPolygonDatum[];
  countries: CountryInfo[];
}

// Derived once per loaded collection: the file is the same for every mount.
const derivedCache = new WeakMap<GeoJSON.FeatureCollection, Derived>();

function derive(fc: GeoJSON.FeatureCollection): Derived {
  const cached = derivedCache.get(fc);
  if (cached) return cached;

  const isoToFeatures = new Map<string, GeoJSON.Feature[]>();
  for (const f of fc.features ?? []) {
    const code = featureIsoCode(f);
    if (!code) continue;
    const list = isoToFeatures.get(code) ?? [];
    list.push(f);
    isoToFeatures.set(code, list);
  }
  registerPossessionFeatures(isoToFeatures);

  const countryData = buildCountryData(isoToFeatures);
  const countries: CountryInfo[] = countryData.map((d) => {
    const props = (isoToFeatures.get(d.isoCode ?? '')?.[0]?.properties ?? {}) as Record<string, unknown>;
    const labelX = props['LABEL_X'];
    const labelY = props['LABEL_Y'];
    const label: LngLat = typeof labelX === 'number' && typeof labelY === 'number'
      ? [labelX, labelY]
      : geometryLabelPoint(d.geometry);
    return {
      code: d.isoCode ?? d.id,
      name: d.countryName ?? d.isoCode ?? d.id,
      continent: typeof props['CONTINENT'] === 'string' ? (props['CONTINENT'] as string) : 'Other',
      subregion: typeof props['SUBREGION'] === 'string' ? (props['SUBREGION'] as string) : 'Other',
      areaKm2: geometryAreaKm2(d.geometry),
      label,
      geometry: d.geometry,
    };
  });
  countries.sort((a, b) => a.name.localeCompare(b.name));

  const result = { isoToFeatures, countryData, countries };
  derivedCache.set(fc, result);
  return result;
}

const EMPTY: Derived = { isoToFeatures: new Map(), countryData: [], countries: [] };

/** The Natural Earth country set, from the same local file and promise cache as the game. */
export function useEditorCountries(): EditorCountries {
  const [collection, setCollection] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCountriesGeo().then((fc) => {
      if (!cancelled) setCollection(fc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const derived = useMemo(() => (collection ? derive(collection) : EMPTY), [collection]);
  return { ready: collection !== null, ...derived };
}
