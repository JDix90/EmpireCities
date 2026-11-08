/**
 * GlobeMapEditor — Interactive 3D globe for the map editor.
 * Supports free-draw polygon placement and country-pick from Natural Earth data.
 * Uses the same react-globe.gl stack as the in-game GlobeMap.
 *
 * The polygon data is cached per territory (editorGlobeData.ts) because
 * three-globe keys its scene objects by datum identity: a datum rebuilt on
 * every render re-tessellates its cap, and with ~240 country outlines in the
 * layer that was a full rebuild of the globe per click. Selection, hover,
 * region colour and names are read live by the accessors instead.
 */

import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
// The globe libraries leave unheard frame tickers looping from import; see the module.
import '../../utils/idleFrameTickers';
import { registerPossessionFeatures } from '../../utils/countryHomeland';
import { loadCountriesGeo } from '../../hooks/useTerritoryGeoSources';
import {
  TerritoryPolygonCache,
  buildCountryData,
  featureIsoCode,
  type EditorPolygonDatum as PolygonDatum,
  type EditorTerritory,
  type PolyGeom,
} from './editorGlobeData';

export type { EditorTerritory } from './editorGlobeData';

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

// Country outlines stay on the globe in every tool as faint borders to trace
// and place against; the Pick Country tool brightens them and highlights the
// one under the pointer. A colour change is a material update, not a rebuild.
const COUNTRY_FILL = 'rgba(100, 120, 150, 0.10)';
const COUNTRY_FILL_PICKABLE = 'rgba(100, 120, 150, 0.18)';
const COUNTRY_FILL_HOVER = 'rgba(201, 168, 76, 0.45)';
const COUNTRY_STROKE = 'rgba(150, 170, 200, 0.30)';
const COUNTRY_STROKE_PICKABLE = 'rgba(150, 170, 200, 0.55)';

export interface EditorConnection {
  from: string;
  to: string;
  type: 'land' | 'sea' | 'orbit';
}

export interface EditorRegion {
  region_id: string;
  name: string;
  bonus: number;
}

export type EditorTool = 'select' | 'draw' | 'country_pick' | 'connect' | 'delete';

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
  connectionType?: 'land' | 'sea' | 'orbit';
  from?: string;
  to?: string;
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
  onCountryPick: (isoCode: string, name: string, geometry: PolyGeom) => void;
  /** A click on a connection line, as (from, to) of the stored edge. */
  onConnectionClick?: (from: string, to: string) => void;
}

/** Tooltip content lands in innerHTML; names are user text. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ));
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
  onConnectionClick,
}: GlobeMapEditorProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [countriesGeo, setCountriesGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hoveredCountryId, setHoveredCountryId] = useState<string | null>(null);

  // The same local file and promise cache as the game, not a CDN copy.
  useEffect(() => {
    let cancelled = false;
    void loadCountriesGeo().then((fc) => {
      if (!cancelled) setCountriesGeo(fc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ISO → features index, with the overseas pieces trimmed from their parents
  // registered under their own codes so they are pickable by name.
  const isoToFeatures = useMemo(() => {
    const map = new Map<string, GeoJSON.Feature[]>();
    if (!countriesGeo?.features) return map;
    for (const f of countriesGeo.features) {
      const code = featureIsoCode(f);
      if (!code) continue;
      const list = map.get(code) ?? [];
      list.push(f);
      map.set(code, list);
    }
    registerPossessionFeatures(map);
    return map;
  }, [countriesGeo]);

  // Country outlines: built once per data load, never per edit.
  const countryData = useMemo(() => buildCountryData(isoToFeatures), [isoToFeatures]);

  // Territory polygons: one cached datum per territory, replaced only when
  // its geometry changes. Renames, region moves and selection never touch it.
  const territoryCacheRef = useRef(new TerritoryPolygonCache());
  const territoryData = useMemo(
    () => territoryCacheRef.current.build(territories, isoToFeatures),
    [territories, isoToFeatures],
  );

  // ISO codes already claimed by editor territories: their outline is hidden
  // under the territory that now draws it.
  const usedIsoCodes = useMemo(() => {
    const set = new Set<string>();
    for (const t of territories) {
      if (t.iso_codes) t.iso_codes.forEach((c) => set.add(c));
    }
    return set;
  }, [territories]);

  const polygonsData = useMemo((): PolygonDatum[] => {
    const countries = countryData.filter((c) => !usedIsoCodes.has(c.isoCode ?? ''));
    return [...territoryData, ...countries];
  }, [territoryData, countryData, usedIsoCodes]);

  // Live lookups for the accessors, so the datum objects stay untouched.
  const regionIndexById = useMemo(() => {
    const regionIdx = new Map<string, number>();
    regions.forEach((r, i) => regionIdx.set(r.region_id, i));
    const out = new Map<string, number>();
    for (const t of territories) out.set(t.territory_id, regionIdx.get(t.region_id) ?? 0);
    return out;
  }, [territories, regions]);

  const territoryNameById = useMemo(
    () => new Map(territories.map((t) => [t.territory_id, t.name] as const)),
    [territories],
  );

  const territoryById = useMemo(
    () => new Map(territories.map((t) => [t.territory_id, t] as const)),
    [territories],
  );

  // Drawing preview: vertex points
  const pointsData = useMemo((): PointDatum[] => {
    if (activeTool !== 'draw' || drawingPoints.length === 0) return [];
    return drawingPoints.map(([lng, lat], idx) => ({ lat, lng, idx }));
  }, [activeTool, drawingPoints]);

  // Arcs: connections + drawing edges
  const arcsData = useMemo((): ArcDatum[] => {
    const arcs: ArcDatum[] = [];

    for (const conn of connections) {
      const fromT = territoryById.get(conn.from);
      const toT = territoryById.get(conn.to);
      if (!fromT || !toT) continue;
      arcs.push({
        startLat: fromT.center_point[1],
        startLng: fromT.center_point[0],
        endLat: toT.center_point[1],
        endLng: toT.center_point[0],
        kind: 'connection',
        connectionType: conn.type,
        from: conn.from,
        to: conn.to,
      });
    }

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
  }, [connections, territoryById, activeTool, drawingPoints]);

  const pickMode = activeTool === 'country_pick';

  // Accessor identity changes with the state they read, which is what makes
  // three-globe re-evaluate them; with stable data that is a material update.
  const getPolygonColor = useCallback((polygon: object) => {
    const p = polygon as PolygonDatum;
    if (p.kind === 'country') {
      if (pickMode && p.id === hoveredCountryId) return COUNTRY_FILL_HOVER;
      return pickMode ? COUNTRY_FILL_PICKABLE : COUNTRY_FILL;
    }
    return REGION_COLORS[(regionIndexById.get(p.id) ?? 0) % REGION_COLORS.length];
  }, [pickMode, hoveredCountryId, regionIndexById]);

  const getPolygonStroke = useCallback((polygon: object) => {
    const p = polygon as PolygonDatum;
    if (p.kind === 'country') return pickMode ? COUNTRY_STROKE_PICKABLE : COUNTRY_STROKE;
    if (p.id === selectedTerritoryId || p.id === connectSource) return '#ffd700';
    return '#ffffff';
  }, [pickMode, selectedTerritoryId, connectSource]);

  const getPolygonAltitude = useCallback((polygon: object) => {
    return (polygon as PolygonDatum).kind === 'country' ? 0.002 : 0.008;
  }, []);

  const getPolygonLabel = useCallback((polygon: object) => {
    const p = polygon as PolygonDatum;
    if (p.kind === 'country') return pickMode ? escapeHtml(p.countryName ?? '') : '';
    return escapeHtml(territoryNameById.get(p.id) ?? '');
  }, [pickMode, territoryNameById]);

  // Use refs for props so the handlers passed to react-globe.gl never go stale
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const onTerritoryClickRef = useRef(onTerritoryClick);
  onTerritoryClickRef.current = onTerritoryClick;
  const onGlobeClickCoordsRef = useRef(onGlobeClickCoords);
  onGlobeClickCoordsRef.current = onGlobeClickCoords;
  const onCountryPickRef = useRef(onCountryPick);
  onCountryPickRef.current = onCountryPick;
  const onConnectionClickRef = useRef(onConnectionClick);
  onConnectionClickRef.current = onConnectionClick;

  const handlePolygonClick = useCallback((polygon: object, _event: MouseEvent, coords: { lat: number; lng: number }) => {
    const p = polygon as PolygonDatum;
    const tool = activeToolRef.current;

    if (tool === 'draw') {
      onGlobeClickCoordsRef.current(coords.lng, coords.lat);
      return;
    }

    if (p.kind === 'country') {
      if (tool === 'country_pick' && p.isoCode) {
        onCountryPickRef.current(p.isoCode, p.countryName ?? p.isoCode, p.geometry);
      } else {
        // To every other tool a faint outline is background.
        onGlobeClickCoordsRef.current(coords.lng, coords.lat);
      }
      return;
    }

    onTerritoryClickRef.current(p.id);
  }, []);

  const handlePolygonHover = useCallback((polygon: object | null) => {
    const p = polygon as PolygonDatum | null;
    const next = p && p.kind === 'country' && activeToolRef.current === 'country_pick' ? p.id : null;
    setHoveredCountryId((prev) => (prev === next ? prev : next));
  }, []);

  // Orbit controls stay on in every tool. The render layer already drops the
  // click that ends a drag, so dragging rotates and a still click places.
  const handleGlobeClick = useCallback((coords: { lat: number; lng: number }) => {
    onGlobeClickCoordsRef.current(coords.lng, coords.lat);
  }, []);

  // The pointer cursor says "clickable": territories always, countries only
  // when picking them does something.
  const showPointerCursor = useCallback((objType: string, objData: object) => {
    if (objType !== 'polygon') return true;
    const p = objData as PolygonDatum;
    return p.kind === 'territory' || activeToolRef.current === 'country_pick';
  }, []);

  const handleArcClick = useCallback((arc: object) => {
    const a = arc as ArcDatum;
    if (a.kind === 'connection' && a.from && a.to) onConnectionClickRef.current?.(a.from, a.to);
  }, []);

  const getArcLabel = useCallback((arc: object) => {
    const a = arc as ArcDatum;
    if (a.kind !== 'connection' || !a.from || !a.to) return '';
    const from = escapeHtml(territoryNameById.get(a.from) ?? a.from);
    const to = escapeHtml(territoryNameById.get(a.to) ?? a.to);
    const kind = a.connectionType === 'sea' ? 'sea lane' : 'land border';
    const tool = activeToolRef.current;
    const hint = tool === 'delete'
      ? ' — click to remove'
      : tool === 'connect'
        ? ' — click to switch land/sea'
        : '';
    return `${from} ↔ ${to} · ${kind}${hint}`;
  }, [territoryNameById]);

  const getArcStroke = useCallback((arc: object) => {
    // A little thicker than the drawing preview: these take clicks.
    return (arc as ArcDatum).kind === 'connection' ? 0.7 : 0.5;
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
    <div className="w-full h-full overflow-hidden bg-bf-dark">
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
        showPointerCursor={showPointerCursor}

        polygonsData={polygonsData}
        polygonGeoJsonGeometry="geometry"
        polygonsTransitionDuration={0}
        polygonCapColor={getPolygonColor}
        polygonSideColor={() => 'rgba(0, 0, 0, 0.15)'}
        polygonStrokeColor={getPolygonStroke}
        polygonAltitude={getPolygonAltitude}
        polygonLabel={getPolygonLabel}
        onPolygonClick={handlePolygonClick}
        onPolygonHover={handlePolygonHover}

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
        arcStroke={getArcStroke}
        arcLabel={getArcLabel}
        onArcClick={handleArcClick}
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
