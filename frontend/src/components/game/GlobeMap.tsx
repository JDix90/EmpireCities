/**
 * ChronoConquest — Interactive 3D Globe Map
 * Renders territories on a spin-able 3D globe using react-globe.gl.
 * Uses real GeoJSON boundaries (Natural Earth) with optional bbox clipping for split regions.
 */

import React, { useRef, useMemo, useState, useEffect } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { useGameStore } from '../../store/gameStore';
import {
  TERRITORY_ISO_MAP,
  TERRITORY_GEO_CONFIG,
  type TerritoryGeoConfig,
  type ClipBbox,
} from '../../data/territoryGeoMapping';
import { clipToBbox } from '../../utils/geoClip';

const COUNTRIES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson';

const PLAYER_COLORS: Record<string, string> = {
  '#e74c3c': 'rgba(231, 76, 60, 0.82)',
  '#3498db': 'rgba(52, 152, 219, 0.82)',
  '#2ecc71': 'rgba(46, 204, 113, 0.82)',
  '#f39c12': 'rgba(243, 156, 18, 0.82)',
  '#9b59b6': 'rgba(155, 89, 182, 0.82)',
  '#1abc9c': 'rgba(26, 188, 156, 0.82)',
  '#e67e22': 'rgba(230, 126, 34, 0.82)',
  '#ecf0f1': 'rgba(236, 240, 241, 0.82)',
};

interface MapTerritory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
  /** ISO codes for geographic boundaries (custom maps). */
  iso_codes?: string[];
  /** Optional bbox to clip merged geometry: [minLng, minLat, maxLng, maxLat] */
  clip_bbox?: ClipBbox;
  /** Full config: per-country iso + optional clip_bbox (overrides iso_codes) */
  geo_config?: TerritoryGeoConfig;
  /** Polygon exterior ring in geographic [lng, lat] coords (globe editor) */
  geo_polygon?: [number, number][];
}

interface GameMapData {
  canvas_width?: number;
  canvas_height?: number;
  territories: MapTerritory[];
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' }>;
}

interface GlobeMapProps {
  mapData: GameMapData;
  onTerritoryClick: (territoryId: string) => void;
  width?: number;
  height?: number;
}

/**
 * Convert canvas coordinates (x, y) to GeoJSON [lng, lat].
 * Maps canvas space (0..canvasW, 0..canvasH) to world (-180..180, 90..-90).
 * Fallback for territories without GeoJSON mapping.
 */
function canvasToGeoJSON(
  polygon: number[][],
  canvasW: number,
  canvasH: number
): [number, number][] {
  return polygon.map(([x, y]) => {
    const lng = (x / canvasW) * 360 - 180;
    const lat = 90 - (y / canvasH) * 180;
    return [lng, lat];
  });
}

/** Extract all polygon coordinate arrays from a geometry. */
function getPolygonCoordinates(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.Position[][][] {
  if (geom.type === 'Polygon') {
    return [geom.coordinates]; // [exterior, hole1?, ...]
  }
  return geom.coordinates; // [[exterior, hole?, ...], ...]
}

/** Merge multiple polygon geometries into one MultiPolygon. */
function mergeGeometries(
  geometries: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[]
): GeoJSON.MultiPolygon {
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

interface PolygonData {
  territory_id: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export default function GlobeMap({ mapData, onTerritoryClick, width = 900, height = 600 }: GlobeMapProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { gameState, selectedTerritory, attackSource } = useGameStore();
  const [countriesGeo, setCountriesGeo] = useState<GeoJSON.FeatureCollection | null>(null);

  const canvasW = mapData.canvas_width ?? 1200;
  const canvasH = mapData.canvas_height ?? 700;

  useEffect(() => {
    fetch(COUNTRIES_GEOJSON_URL)
      .then((r) => r.json())
      .then(setCountriesGeo)
      .catch((err) => console.warn('Failed to load countries GeoJSON:', err));
  }, []);

  const polygonsData = useMemo((): PolygonData[] => {
    const isoToFeatures = new Map<string, GeoJSON.Feature[]>();
    if (countriesGeo?.features) {
      for (const f of countriesGeo.features) {
        const props = f.properties ?? {};
        const iso = props['ISO_A2'] ?? props['iso_a2'];
        const isoEH = props['ISO_A2_EH'] ?? props['iso_a2_eh'];
        const code = (iso && iso !== '-99') ? iso : (isoEH && isoEH !== '-99') ? isoEH : null;
        if (code && typeof code === 'string') {
          const list = isoToFeatures.get(code) ?? [];
          list.push(f);
          isoToFeatures.set(code, list);
        }
      }
    }

    return mapData.territories.map((territory) => {
      const geoConfig =
        territory.geo_config ??
        TERRITORY_GEO_CONFIG[territory.territory_id];
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
          const merged = geometries.length === 1 && geometries[0].type === 'Polygon'
            ? geometries[0]
            : mergeGeometries(geometries);
          return {
            territory_id: territory.territory_id,
            name: territory.name,
            geometry: merged,
          };
        }
      }

      if (territory.geo_polygon && territory.geo_polygon.length >= 3) {
        const ring: [number, number][] = [...territory.geo_polygon];
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push([...ring[0]]);
        }
        return {
          territory_id: territory.territory_id,
          name: territory.name,
          geometry: { type: 'Polygon' as const, coordinates: [ring] },
        };
      }

      const coords = canvasToGeoJSON(territory.polygon, canvasW, canvasH);
      if (coords.length > 1 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
        coords.push([...coords[0]]);
      }
      return {
        territory_id: territory.territory_id,
        name: territory.name,
        geometry: { type: 'Polygon' as const, coordinates: [coords] },
      };
    });
  }, [mapData, countriesGeo, canvasW, canvasH]);

  const getPolygonColor = (polygon: object) => {
    const p = polygon as PolygonData;
    if (!gameState) return 'rgba(45, 52, 72, 0.72)';
    const tState = gameState.territories[p.territory_id];
    if (!tState?.owner_id) return 'rgba(45, 52, 72, 0.72)';
    const player = gameState.players.find((ply) => ply.player_id === tState.owner_id);
    if (!player) return 'rgba(45, 52, 72, 0.72)';
    return PLAYER_COLORS[player.color] ?? 'rgba(136, 136, 136, 0.82)';
  };

  const getPolygonStroke = (polygon: object) => {
    const p = polygon as PolygonData;
    if (p.territory_id === selectedTerritory || p.territory_id === attackSource) {
      return '#ffd700';
    }
    return '#ffffff';
  };

  return (
    <div className="w-full h-full rounded-lg overflow-hidden bg-cc-dark">
      <Globe
        ref={globeRef}
        width={width}
        height={height}
        backgroundColor="rgba(10, 14, 26, 1)"
        globeImageUrl="https://cdn.jsdelivr.net/npm/three-globe@2.45.1/example/img/earth-blue-marble.jpg"
        bumpImageUrl="https://cdn.jsdelivr.net/npm/three-globe@2.45.1/example/img/earth-topology.png"
        showAtmosphere={true}
        atmosphereColor="lightskyblue"
        atmosphereAltitude={0.15}
        polygonsData={polygonsData}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={getPolygonColor}
        polygonSideColor={() => 'rgba(0, 0, 0, 0.2)'}
        polygonStrokeColor={getPolygonStroke}
        polygonAltitude={0.008}
        polygonLabel={(p) => (p as PolygonData).name}
        onPolygonClick={(polygon) => polygon && onTerritoryClick((polygon as PolygonData).territory_id)}
        onGlobeReady={() => {
          const ctrl = globeRef.current?.controls?.();
          if (ctrl) {
            ctrl.autoRotate = true;
            ctrl.autoRotateSpeed = 0.4;
          }
        }}
      />
    </div>
  );
}
