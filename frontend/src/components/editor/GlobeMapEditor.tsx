/**
 * GlobeMapEditor — Interactive 3D globe for the map editor.
 * Supports free-draw polygon placement and country-pick from Natural Earth data.
 * Uses the same react-globe.gl stack as the in-game GlobeMap.
 */

import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';

const COUNTRIES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson';

const REGION_COLORS = [
  'rgba(201, 168, 76, 0.6)',
  'rgba(231, 76, 60, 0.6)',
  'rgba(52, 152, 219, 0.6)',
  'rgba(46, 204, 113, 0.6)',
  'rgba(155, 89, 182, 0.6)',
  'rgba(26, 188, 156, 0.6)',
  'rgba(230, 126, 34, 0.6)',
  'rgba(233, 30, 99, 0.6)',
  'rgba(0, 188, 212, 0.6)',
  'rgba(139, 195, 74, 0.6)',
];

export interface EditorTerritory {
  territory_id: string;
  name: string;
  polygon: [number, number][];
  center_point: [number, number];
  region_id: string;
  iso_codes?: string[];
  geo_polygon?: [number, number][];
}

export interface EditorConnection {
  from: string;
  to: string;
  type: 'land' | 'sea';
}

export interface EditorRegion {
  region_id: string;
  name: string;
  bonus: number;
}

export type EditorTool = 'select' | 'draw' | 'country_pick' | 'connect' | 'delete';

interface PolygonDatum {
  id: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  kind: 'territory' | 'country';
  regionIndex: number;
  isoCode?: string;
  isSelected: boolean;
}

interface PointDatum {
  lat: number;
  lng: number;
  idx: number;
}

interface ArcDatum {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  kind: 'connection' | 'drawing';
  connectionType?: 'land' | 'sea';
}

interface GlobeMapEditorProps {
  territories: EditorTerritory[];
  connections: EditorConnection[];
  regions: EditorRegion[];
  selectedTerritoryId: string | null;
  connectSource: string | null;
  activeTool: EditorTool;
  drawingPoints: [number, number][];
  width: number;
  height: number;
  onTerritoryClick: (id: string) => void;
  onGlobeClickCoords: (lng: number, lat: number) => void;
  onCountryPick: (isoCode: string, name: string, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) => void;
}

function getPolygonCoordinates(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.Position[][][] {
  if (geom.type === 'Polygon') return [geom.coordinates];
  return geom.coordinates;
}

function mergeGeometries(
  geometries: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[]
): GeoJSON.MultiPolygon {
  const polygons: GeoJSON.Position[][][] = [];
  for (const geom of geometries) {
    for (const poly of getPolygonCoordinates(geom)) {
      if (poly?.[0]?.length >= 4) polygons.push(poly);
    }
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

export default function GlobeMapEditor({
  territories,
  connections,
  regions,
  selectedTerritoryId,
  connectSource,
  activeTool,
  drawingPoints,
  width,
  height,
  onTerritoryClick,
  onGlobeClickCoords,
  onCountryPick,
}: GlobeMapEditorProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [countriesGeo, setCountriesGeo] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch(COUNTRIES_GEOJSON_URL)
      .then((r) => r.json())
      .then(setCountriesGeo)
      .catch((err) => console.warn('Failed to load countries GeoJSON:', err));
  }, []);

  // Disable orbit controls during draw mode to prevent rotation on click
  useEffect(() => {
    const ctrl = globeRef.current?.controls?.();
    if (!ctrl) return;
    if (activeTool === 'draw') {
      ctrl.enabled = false;
      ctrl.autoRotate = false;
    } else {
      ctrl.enabled = true;
    }
  }, [activeTool]);

  // ISO → features index
  const isoToFeatures = useMemo(() => {
    const map = new Map<string, GeoJSON.Feature[]>();
    if (!countriesGeo?.features) return map;
    for (const f of countriesGeo.features) {
      const props = f.properties ?? {};
      const iso = props['ISO_A2'] ?? props['iso_a2'];
      const isoEH = props['ISO_A2_EH'] ?? props['iso_a2_eh'];
      const code = (iso && iso !== '-99') ? iso : (isoEH && isoEH !== '-99') ? isoEH : null;
      if (code && typeof code === 'string') {
        const list = map.get(code) ?? [];
        list.push(f);
        map.set(code, list);
      }
    }
    return map;
  }, [countriesGeo]);

  // ISO codes already claimed by editor territories
  const usedIsoCodes = useMemo(() => {
    const set = new Set<string>();
    for (const t of territories) {
      if (t.iso_codes) t.iso_codes.forEach((c) => set.add(c));
    }
    return set;
  }, [territories]);

  // Build polygonsData: editor territories + (in country_pick mode) unclaimed country outlines
  const polygonsData = useMemo((): PolygonDatum[] => {
    const result: PolygonDatum[] = [];

    // Editor territories
    for (const t of territories) {
      const regionIdx = regions.findIndex((r) => r.region_id === t.region_id);
      let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;

      if (t.iso_codes && t.iso_codes.length > 0 && isoToFeatures.size > 0) {
        const geometries: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[] = [];
        for (const code of t.iso_codes) {
          const features = isoToFeatures.get(code) ?? [];
          for (const f of features) {
            const g = f.geometry;
            if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
              geometries.push(g as GeoJSON.Polygon | GeoJSON.MultiPolygon);
            }
          }
        }
        if (geometries.length > 0) {
          geometry = geometries.length === 1 && geometries[0].type === 'Polygon'
            ? geometries[0]
            : mergeGeometries(geometries);
        }
      }

      if (!geometry && t.geo_polygon && t.geo_polygon.length >= 3) {
        const ring: [number, number][] = [...t.geo_polygon];
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push([...ring[0]]);
        }
        geometry = { type: 'Polygon', coordinates: [ring] };
      }

      if (!geometry) continue;

      result.push({
        id: t.territory_id,
        name: t.name,
        geometry,
        kind: 'territory',
        regionIndex: regionIdx >= 0 ? regionIdx : 0,
        isSelected: t.territory_id === selectedTerritoryId || t.territory_id === connectSource,
      });
    }

    // Country outlines for picker mode
    if (activeTool === 'country_pick' && countriesGeo?.features) {
      for (const f of countriesGeo.features) {
        const props = f.properties ?? {};
        const iso = props['ISO_A2'] ?? props['iso_a2'];
        const isoEH = props['ISO_A2_EH'] ?? props['iso_a2_eh'];
        const code = (iso && iso !== '-99') ? iso : (isoEH && isoEH !== '-99') ? isoEH : null;
        if (!code || typeof code !== 'string') continue;
        if (usedIsoCodes.has(code)) continue;

        const g = f.geometry;
        if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;

        const name = props['NAME'] ?? props['name'] ?? code;
        result.push({
          id: `country_${code}`,
          name,
          geometry: g as GeoJSON.Polygon | GeoJSON.MultiPolygon,
          kind: 'country',
          regionIndex: -1,
          isoCode: code,
          isSelected: false,
        });
      }
    }

    return result;
  }, [territories, regions, selectedTerritoryId, connectSource, activeTool, countriesGeo, isoToFeatures, usedIsoCodes]);

  // Drawing preview: vertex points
  const pointsData = useMemo((): PointDatum[] => {
    if (activeTool !== 'draw' || drawingPoints.length === 0) return [];
    return drawingPoints.map(([lng, lat], idx) => ({ lat, lng, idx }));
  }, [activeTool, drawingPoints]);

  // Arcs: connections + drawing edges
  const arcsData = useMemo((): ArcDatum[] => {
    const arcs: ArcDatum[] = [];

    // Territory connections
    for (const conn of connections) {
      const fromT = territories.find((t) => t.territory_id === conn.from);
      const toT = territories.find((t) => t.territory_id === conn.to);
      if (!fromT || !toT) continue;
      arcs.push({
        startLat: fromT.center_point[1],
        startLng: fromT.center_point[0],
        endLat: toT.center_point[1],
        endLng: toT.center_point[0],
        kind: 'connection',
        connectionType: conn.type,
      });
    }

    // Drawing preview edges
    if (activeTool === 'draw' && drawingPoints.length >= 2) {
      for (let i = 0; i < drawingPoints.length - 1; i++) {
        arcs.push({
          startLng: drawingPoints[i][0],
          startLat: drawingPoints[i][1],
          endLng: drawingPoints[i + 1][0],
          endLat: drawingPoints[i + 1][1],
          kind: 'drawing',
        });
      }
    }

    return arcs;
  }, [connections, territories, activeTool, drawingPoints]);

  const getPolygonColor = useMemo(() => (polygon: object) => {
    const p = polygon as PolygonDatum;
    if (p.kind === 'country') return 'rgba(100, 120, 150, 0.15)';
    return REGION_COLORS[p.regionIndex % REGION_COLORS.length];
  }, [polygonsData]);

  const getPolygonStroke = useMemo(() => (polygon: object) => {
    const p = polygon as PolygonDatum;
    if (p.kind === 'country') return 'rgba(150, 170, 200, 0.4)';
    if (p.isSelected) return '#ffd700';
    return '#ffffff';
  }, [polygonsData]);

  const getPolygonAltitude = useMemo(() => (polygon: object) => {
    const p = polygon as PolygonDatum;
    return p.kind === 'country' ? 0.002 : 0.008;
  }, [polygonsData]);

  // Use refs for props so the handlers passed to react-globe.gl never go stale
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const onTerritoryClickRef = useRef(onTerritoryClick);
  onTerritoryClickRef.current = onTerritoryClick;
  const onGlobeClickCoordsRef = useRef(onGlobeClickCoords);
  onGlobeClickCoordsRef.current = onGlobeClickCoords;
  const onCountryPickRef = useRef(onCountryPick);
  onCountryPickRef.current = onCountryPick;

  const handlePolygonClick = useCallback((polygon: object, _event: MouseEvent, coords: { lat: number; lng: number }) => {
    const p = polygon as PolygonDatum;
    const tool = activeToolRef.current;

    if (tool === 'draw') {
      onGlobeClickCoordsRef.current(coords.lng, coords.lat);
      return;
    }

    if (p.kind === 'country' && tool === 'country_pick') {
      if (p.isoCode) {
        onCountryPickRef.current(p.isoCode, p.name, p.geometry);
      }
      return;
    }

    if (p.kind === 'territory') {
      onTerritoryClickRef.current(p.id);
    }
  }, []);

  const handleGlobeClick = useCallback((coords: { lat: number; lng: number }) => {
    if (activeToolRef.current === 'draw') {
      onGlobeClickCoordsRef.current(coords.lng, coords.lat);
    }
  }, []);

  const getArcColor = useCallback((arc: object) => {
    const a = arc as ArcDatum;
    if (a.kind === 'drawing') return '#c9a84c';
    return a.connectionType === 'sea' ? '#2e7d9e' : 'rgba(255, 255, 255, 0.5)';
  }, []);

  const getArcDash = useCallback((arc: object) => {
    const a = arc as ArcDatum;
    if (a.kind === 'drawing') return 0.5;
    return a.connectionType === 'sea' ? 0.4 : 0;
  }, []);

  return (
    <div className="w-full h-full overflow-hidden bg-cc-dark">
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
        polygonsTransitionDuration={0}
        polygonCapColor={getPolygonColor}
        polygonSideColor={() => 'rgba(0, 0, 0, 0.15)'}
        polygonStrokeColor={getPolygonStroke}
        polygonAltitude={getPolygonAltitude}
        polygonLabel={(p) => (p as PolygonDatum).name}
        onPolygonClick={handlePolygonClick}

        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => '#ffd700'}
        pointRadius={0.4}
        pointAltitude={0.01}

        arcsData={arcsData}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={getArcColor}
        arcAltitudeAutoScale={0.3}
        arcStroke={0.5}
        arcDashLength={getArcDash}
        arcDashGap={(arc) => {
          const a = arc as ArcDatum;
          return a.kind === 'drawing' || a.connectionType === 'sea' ? 0.3 : 0;
        }}

        onGlobeClick={handleGlobeClick}
        onGlobeReady={() => {
          const ctrl = globeRef.current?.controls?.();
          if (ctrl) {
            ctrl.autoRotate = false;
          }
        }}
      />
    </div>
  );
}
