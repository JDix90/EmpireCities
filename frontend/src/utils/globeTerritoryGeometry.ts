/**
 * Builds the same GeoJSON geometry per territory as GlobeMap (countries/states/Risorgimento/ACW/canvas).
 * Used by GlobeMap rendering and by scripts that derive land adjacency from globe borders.
 *
 * IMPORTANT: Canvas `polygon` coords are in map pixel space (0…canvas_w, 0…canvas_h) relative to
 * `projection_bounds` when the map was authored — NOT full-world equirectangular. If `geo_polygon`
 * is missing, we must use `projection_bounds` for the canvas→WGS84 fallback. The old
 * world-spanning fallback placed regional maps at wrong longitudes and caused chaotic overlaps on the globe.
 */

import rewind from '@turf/rewind';
import { polygon as turfPolygon } from '@turf/helpers';
import {
  TERRITORY_GEO_CONFIG,
  TERRITORY_ISO_MAP,
  type TerritoryGeoConfig,
} from '../data/territoryGeoMapping';
import { ACW_TERRITORY_STATES } from '../data/acwStateMap';
import { RISORGIMENTO_TERRITORY_PARTS } from '../data/risorgimentoRegionMap';
import { clipToBbox, type ClipBbox } from './geoClip';
import { unionGeoJsonGeometries } from './geoUnion';
import { COMMUNITY_14N_TERRITORY_GEO } from '../data/community14nAdmin1Map';
import { COMMUNITY_STRAIT_HORMUZ_TERRITORY_GEO } from '../data/communityStraitHormuzGeo';

/** Minimal territory shape for geometry building (matches GameMap + GlobeMap props). */
export interface GlobeTerritoryInput {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  geo_config?: TerritoryGeoConfig;
  iso_codes?: string[];
  clip_bbox?: ClipBbox;
  geo_polygon?: [number, number][];
}

export interface ProjectionBounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

export interface PolygonData {
  territory_id: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

type TerritoryRow = GlobeTerritoryInput;

/** Legacy full-world canvas → lon/lat (only valid when the map truly uses world equirectangular layout). */
function canvasToGeoJSONWorld(polygon: number[][], canvasW: number, canvasH: number): [number, number][] {
  return polygon.map(([x, y]) => {
    const lng = (x / canvasW) * 360 - 180;
    const lat = 90 - (y / canvasH) * 180;
    return [lng, lat];
  });
}

/** Inverse of map authoring: canvas pixel → WGS84 using the same `projection_bounds` as the JSON builder. */
function canvasToGeoJSONRegional(
  polygon: number[][],
  canvasW: number,
  canvasH: number,
  b: ProjectionBounds,
): [number, number][] {
  const { minLng, maxLng, minLat, maxLat } = b;
  return polygon.map(([x, y]) => {
    const lng = minLng + (x / canvasW) * (maxLng - minLng);
    const lat = maxLat - (y / canvasH) * (maxLat - minLat);
    return [lng, lat];
  });
}

function getPolygonCoordinates(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][][] {
  if (geom.type === 'Polygon') return [geom.coordinates];
  return geom.coordinates;
}

function centerPlaceholderGeometry(
  centerPoint: [number, number],
  canvasW: number,
  canvasH: number,
  projectionBounds?: ProjectionBounds,
): GeoJSON.Polygon {
  const cx = centerPoint[0];
  const cy = centerPoint[1];
  const b: ProjectionBounds =
    projectionBounds ?? { minLng: -180, maxLng: 180, minLat: -90, maxLat: 90 };
  const c = canvasToGeoJSONRegional([[cx, cy]], canvasW, canvasH, b);
  const cLng = c[0][0];
  const cLat = c[0][1];
  const d = 0.01;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [cLng - d, cLat - d],
        [cLng + d, cLat - d],
        [cLng + d, cLat + d],
        [cLng - d, cLat + d],
        [cLng - d, cLat - d],
      ],
    ],
  };
}

function getCountryClippedToBbox(
  iso2: string,
  bbox: ClipBbox,
  isoToFeatures: Map<string, GeoJSON.Feature[]>,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const feats = isoToFeatures.get(iso2);
  if (!feats?.length) return null;
  const geoms: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];
  for (const f of feats) {
    const g = f.geometry;
    if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      geoms.push(g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
    }
  }
  if (geoms.length === 0) return null;
  const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms);
  return clipToBbox(merged, bbox);
}

function mergeGeometries(geometries: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[]): GeoJSON.MultiPolygon {
  const polygons: GeoJSON.Position[][][] = [];
  for (const geom of geometries) {
    for (const poly of getPolygonCoordinates(geom)) {
      if (poly && poly[0] && poly[0].length >= 4) {
        polygons.push(poly);
      }
    }
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

/** Remove consecutive duplicate vertices (and a closing duplicate) so earcut/triangulation stays stable. */
function sanitizeClosedExteriorRing(ring: GeoJSON.Position[]): GeoJSON.Position[] {
  const eps = 1e-9;
  const deduped: GeoJSON.Position[] = [];
  for (const p of ring) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    const prev = deduped[deduped.length - 1];
    if (
      !prev ||
      Math.abs(Number(prev[0]) - x) > eps ||
      Math.abs(Number(prev[1]) - y) > eps
    ) {
      deduped.push([x, y]);
    }
  }
  if (deduped.length < 3) return ring;
  const f = deduped[0];
  const l = deduped[deduped.length - 1];
  if (
    Math.abs(Number(f[0]) - Number(l[0])) < eps &&
    Math.abs(Number(f[1]) - Number(l[1])) < eps
  ) {
    deduped.pop();
  }
  if (deduped.length < 3) return ring;
  return [...deduped, deduped[0]];
}

/**
 * Normalize API `geo_polygon` / canvas rings into GeoJSON Polygon.
 * Always run @turf/rewind: community map rects are often authored clockwise (SW→SE→NE→NW).
 * Skipping rewind kept “bit-identical” coords but broke RFC 7946 exterior orientation; three-globe’s
 * conic polygon caps then triangulate incorrectly (spiky / exploded caps on the globe).
 */
function ringToPolygonGeometry(ringInput: [number, number][]): GeoJSON.Polygon {
  let ring: [number, number][] = ringInput.map((p) => [Number(p[0]), Number(p[1])]);
  if (ring.length < 3) {
    return { type: 'Polygon', coordinates: [ring] };
  }
  const first0 = ring[0];
  const last0 = ring[ring.length - 1];
  if (first0[0] === last0[0] && first0[1] === last0[1]) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) {
    return { type: 'Polygon', coordinates: [ringInput] };
  }

  const closed: [number, number][] = [...ring, ring[0]];
  try {
    const feat = turfPolygon([closed]);
    const rewound = rewind(feat) as GeoJSON.Feature<GeoJSON.Polygon>;
    if (rewound.geometry?.type === 'Polygon') {
      const coords = rewound.geometry.coordinates.map((r, i) =>
        i === 0 ? sanitizeClosedExteriorRing(r) : r,
      );
      return { type: 'Polygon', coordinates: coords };
    }
  } catch {
    /* fall through */
  }
  return { type: 'Polygon', coordinates: [sanitizeClosedExteriorRing(closed)] };
}

export interface GlobeGeometryInputs {
  countriesGeo: GeoJSON.FeatureCollection | null;
  statesGeo: GeoJSON.FeatureCollection | null;
  risorgimentoGeo: GeoJSON.FeatureCollection | null;
  /** ne_50m admin-1 — Canadian provinces for community_14_nations */
  admin50Geo?: GeoJSON.FeatureCollection | null;
  /** ne_10m admin-1 subset — Gulf states for community_strait_hormuz */
  straitHormuzGeo?: GeoJSON.FeatureCollection | null;
}

export interface GlobeMapDataForGeometry {
  map_id?: string;
  canvas_width?: number;
  canvas_height?: number;
  /** When set, canvas `polygon` coords map through these bounds (same as JSON `projection_bounds`). */
  projection_bounds?: ProjectionBounds;
  territories: GlobeTerritoryInput[];
}

/**
 * Build globe geometry for every territory — mirrors GlobeMap `polygonsData` logic.
 */
export function buildTerritoryGlobeGeometries(
  mapData: GlobeMapDataForGeometry,
  {
    countriesGeo,
    statesGeo,
    risorgimentoGeo,
    admin50Geo = null,
    straitHormuzGeo = null,
  }: GlobeGeometryInputs,
): PolygonData[] {
  const canvasW = mapData.canvas_width ?? 1200;
  const canvasH = mapData.canvas_height ?? 700;
  const regionalBounds = mapData.projection_bounds;

  const isoToFeatures = new Map<string, GeoJSON.Feature[]>();
  if (countriesGeo?.features) {
    for (const f of countriesGeo.features) {
      const props = f.properties ?? {};
      const iso = props['ISO_A2'] ?? props['iso_a2'];
      const isoEH = props['ISO_A2_EH'] ?? props['iso_a2_eh'];
      const code =
        iso && iso !== '-99' ? iso : isoEH && isoEH !== '-99' ? isoEH : null;
      if (code && typeof code === 'string') {
        const list = isoToFeatures.get(code) ?? [];
        list.push(f);
        isoToFeatures.set(code, list);
      }
    }
  }

  const postalToGeom = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>();
  if (statesGeo?.features) {
    for (const f of statesGeo.features) {
      const props = f.properties ?? {};
      if (props['adm0_a3'] !== 'USA') continue;
      const postal = props['postal'];
      if (typeof postal !== 'string' || postal === 'AK' || postal === 'HI') continue;
      const g = f.geometry;
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
        postalToGeom.set(postal, g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      }
    }
  }

  const iso3166ToGeom = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>();
  if (risorgimentoGeo?.features) {
    for (const f of risorgimentoGeo.features) {
      const props = f.properties ?? {};
      const code = props['iso_3166_2'];
      if (typeof code !== 'string') continue;
      const g = f.geometry;
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
        iso3166ToGeom.set(code, g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      }
    }
  }

  const usIso3166ToGeom = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>();
  if (statesGeo?.features) {
    for (const f of statesGeo.features) {
      const code = f.properties?.iso_3166_2;
      if (typeof code !== 'string' || !code.startsWith('US-')) continue;
      const g = f.geometry;
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
        usIso3166ToGeom.set(code, g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      }
    }
  }

  const admin50Iso3166ToGeom = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>();
  if (admin50Geo?.features) {
    for (const f of admin50Geo.features) {
      const code = f.properties?.iso_3166_2;
      if (typeof code !== 'string') continue;
      const g = f.geometry;
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
        admin50Iso3166ToGeom.set(code, g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      }
    }
  }

  const straitHormuzIso3166ToGeom = new Map<string, GeoJSON.Polygon | GeoJSON.MultiPolygon>();
  if (straitHormuzGeo?.features) {
    for (const f of straitHormuzGeo.features) {
      const code = f.properties?.iso_3166_2;
      if (typeof code !== 'string') continue;
      const g = f.geometry;
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
        straitHormuzIso3166ToGeom.set(code, g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      }
    }
  }

  return mapData.territories.map((raw) => {
    const territory = raw as TerritoryRow;

    /** Strait of Hormuz: Natural Earth ne_10m admin-1 (bundled) + clip to grid cells — real coastlines on globe. */
    const shDef = COMMUNITY_STRAIT_HORMUZ_TERRITORY_GEO[territory.territory_id];
    if (
      mapData.map_id === 'community_strait_hormuz' &&
      shDef &&
      straitHormuzIso3166ToGeom.size > 0 &&
      countriesGeo &&
      isoToFeatures.size > 0
    ) {
      const geoms: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];
      for (const code of shDef.admin1) {
        const g = straitHormuzIso3166ToGeom.get(code);
        if (!g) continue;
        const clipped = clipToBbox(g, shDef.clip_bbox);
        if (clipped) geoms.push(clipped);
      }
      if (shDef.fill_country_iso) {
        const fill = getCountryClippedToBbox(shDef.fill_country_iso, shDef.clip_bbox, isoToFeatures);
        if (fill) geoms.push(fill);
      }
      if (geoms.length > 0) {
        try {
          const merged =
            geoms.length === 1 ? geoms[0] : unionGeoJsonGeometries(geoms);
          if (merged) {
            return {
              territory_id: territory.territory_id,
              name: territory.name,
              geometry: merged,
            };
          }
        } catch {
          /* fall through */
        }
      }
    }

    /** Community "14 Nations": Natural Earth admin-1 union + clip (same idea as Risorgimento / era maps). */
    const c14 = COMMUNITY_14N_TERRITORY_GEO[territory.territory_id];
    if (
      mapData.map_id === 'community_14_nations' &&
      c14 &&
      countriesGeo &&
      statesGeo &&
      isoToFeatures.size > 0
    ) {
      const geoms: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];
      for (const code of c14.admin1) {
        const g = usIso3166ToGeom.get(code) ?? admin50Iso3166ToGeom.get(code);
        if (g) geoms.push(g);
      }
      if (c14.fill_country_iso === 'MX') {
        const mx = getCountryClippedToBbox('MX', c14.clip_bbox, isoToFeatures);
        if (mx) geoms.push(mx);
      }
      if (geoms.length > 0) {
        const merged =
          geoms.length === 1 ? geoms[0] : unionGeoJsonGeometries(geoms);
        if (merged) {
          const clipped = clipToBbox(merged, c14.clip_bbox);
          const finalGeom = clipped ?? merged;
          return {
            territory_id: territory.territory_id,
            name: territory.name,
            geometry: finalGeom,
          };
        }
      }
    }

    // Explicit map-authored rings (editor drawings). Skipped when Natural Earth paths above win (14 Nations, Hormuz).
    if (territory.geo_polygon && territory.geo_polygon.length >= 3) {
      const ring: [number, number][] = [...territory.geo_polygon];
      if (
        ring[0][0] !== ring[ring.length - 1][0] ||
        ring[0][1] !== ring[ring.length - 1][1]
      ) {
        ring.push([...ring[0]]);
      }
      return {
        territory_id: territory.territory_id,
        name: territory.name,
        geometry: ringToPolygonGeometry(ring),
      };
    }

    const risParts = RISORGIMENTO_TERRITORY_PARTS[territory.territory_id];
    if (risParts) {
      if (risorgimentoGeo === null) {
        return {
          territory_id: territory.territory_id,
          name: territory.name,
          geometry: centerPlaceholderGeometry(territory.center_point, canvasW, canvasH, regionalBounds),
        };
      }
      if (iso3166ToGeom.size > 0) {
        const geoms: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];
        for (const code of risParts) {
          const g = iso3166ToGeom.get(code);
          if (g) geoms.push(g);
        }
        if (geoms.length === risParts.length) {
          try {
            const merged = unionGeoJsonGeometries(geoms);
            if (merged) {
              return {
                territory_id: territory.territory_id,
                name: territory.name,
                geometry: merged,
              };
            }
          } catch {
            /* fall through */
          }
        }
      }
    }

    const acwStates = ACW_TERRITORY_STATES[territory.territory_id];
    if (acwStates) {
      if (statesGeo === null) {
        return {
          territory_id: territory.territory_id,
          name: territory.name,
          geometry: centerPlaceholderGeometry(territory.center_point, canvasW, canvasH, regionalBounds),
        };
      }

      if (postalToGeom.size > 0) {
        const geoms: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];
        for (const code of acwStates) {
          const g = postalToGeom.get(code);
          if (g) geoms.push(g);
        }
        if (geoms.length === acwStates.length) {
          try {
            const merged = unionGeoJsonGeometries(geoms);
            if (merged) {
              return {
                territory_id: territory.territory_id,
                name: territory.name,
                geometry: merged,
              };
            }
          } catch {
            /* fall through */
          }
        }
      }
    }

    const geoConfig =
      territory.geo_config ?? TERRITORY_GEO_CONFIG[territory.territory_id];
    const isoCodes = territory.iso_codes ?? TERRITORY_ISO_MAP[territory.territory_id];
    const useGeo = (geoConfig && geoConfig.length > 0) || (isoCodes && isoCodes.length > 0);
    const hasData = useGeo && countriesGeo && isoToFeatures.size > 0;

    if (hasData) {
      let geometries: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];

      if (geoConfig && geoConfig.length > 0) {
        for (const item of geoConfig) {
          const features = isoToFeatures.get(item.iso) ?? [];
          for (const f of features) {
            const geom = f.geometry;
            if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
            const g = geom as GeoJSON.Polygon | GeoJSON.MultiPolygon;
            if (item.clip_bbox) {
              const clipped = clipToBbox(g, item.clip_bbox);
              if (clipped) geometries.push(clipped);
            } else {
              geometries.push(g);
            }
          }
        }
      } else if (isoCodes && isoCodes.length > 0) {
        for (const code of isoCodes) {
          const features = isoToFeatures.get(code) ?? [];
          for (const f of features) {
            const geom = f.geometry;
            if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
              geometries.push(geom as GeoJSON.Polygon | GeoJSON.MultiPolygon);
            }
          }
        }
        if (geometries.length > 0 && territory.clip_bbox) {
          const merged = mergeGeometries(geometries);
          const clipped = clipToBbox(merged, territory.clip_bbox);
          geometries = clipped ? [clipped] : [];
        }
      }

      if (geometries.length > 0) {
        const merged =
          geometries.length === 1 && geometries[0].type === 'Polygon'
            ? geometries[0]
            : mergeGeometries(geometries);
        return {
          territory_id: territory.territory_id,
          name: territory.name,
          geometry: merged,
        };
      }

      return {
        territory_id: territory.territory_id,
        name: territory.name,
        geometry: centerPlaceholderGeometry(territory.center_point, canvasW, canvasH, regionalBounds),
      };
    }

    const coords = regionalBounds
      ? canvasToGeoJSONRegional(territory.polygon, canvasW, canvasH, regionalBounds)
      : canvasToGeoJSONWorld(territory.polygon, canvasW, canvasH);
    if (
      coords.length > 1 &&
      (coords[0][0] !== coords[coords.length - 1][0] ||
        coords[0][1] !== coords[coords.length - 1][1])
    ) {
      coords.push([...coords[0]]);
    }
    return {
      territory_id: territory.territory_id,
      name: territory.name,
      geometry: ringToPolygonGeometry(coords as [number, number][]),
    };
  });
}
