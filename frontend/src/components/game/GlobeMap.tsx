/**
 * Eras of Empire — Interactive 3D Globe Map
 * Renders territories on a spin-able 3D globe using react-globe.gl.
 * Supports animated event overlays: reinforcements, combat, and fortification.
 */

import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { FastForward } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { type TerritoryGeoConfig, type ClipBbox } from '../../data/territoryGeoMapping';
import {
  buildTerritoryGlobeGeometries,
  type PolygonData,
} from '../../utils/globeTerritoryGeometry';
import { deriveRegionalGlobeView, type GlobeViewConfig } from '../../utils/regionalGlobe';

// ── Constants ──────────────────────────────────────────────────────────────────

const COUNTRIES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson';

/** US states/provinces (admin-1) — used for ACW territory outlines along real state borders */
const STATES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_1_states_provinces.geojson';

/** Admin-1 for Canada (and other non-US) — community_14_nations merges with US states */
const ADMIN50_STATES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson';

/** Pre-extracted NE 10m Italy + San Marino + Vatican provinces (built from Natural Earth) */
const RISORGIMENTO_GEOJSON_URL = '/geo/risorgimento_admin1.json';

/** ne_10m admin-1 subset — IR/AE/OM/QA/BH provinces for community_strait_hormuz globe coastlines */
const STRAIT_HORMUZ_GEOJSON_URL = '/geo/strait_hormuz_admin1.json';

/** Nearly opaque fills so adjacent territories do not read as “bleeding” through each other. */
const PLAYER_COLORS: Record<string, string> = {
  '#e74c3c': 'rgba(231, 76, 60, 0.96)',
  '#3498db': 'rgba(52, 152, 219, 0.96)',
  '#2ecc71': 'rgba(46, 204, 113, 0.96)',
  '#f39c12': 'rgba(243, 156, 18, 0.96)',
  '#9b59b6': 'rgba(155, 89, 182, 0.96)',
  '#1abc9c': 'rgba(26, 188, 156, 0.96)',
  '#e67e22': 'rgba(230, 126, 34, 0.96)',
  '#ecf0f1': 'rgba(236, 240, 241, 0.96)',
};

/** Fully opaque caps for regional / locked-camera maps: semi-transparent meshes z-fight at shared borders and blend unpredictably (RGB “shard” noise). */
const PLAYER_COLORS_SOLID: Record<string, string> = {
  '#e74c3c': 'rgb(231, 76, 60)',
  '#3498db': 'rgb(52, 152, 219)',
  '#2ecc71': 'rgb(46, 204, 113)',
  '#f39c12': 'rgb(243, 156, 18)',
  '#9b59b6': 'rgb(155, 89, 182)',
  '#1abc9c': 'rgb(26, 188, 156)',
  '#e67e22': 'rgb(230, 126, 34)',
  '#ecf0f1': 'rgb(236, 240, 241)',
};

/** Tiny altitude spread so coplanar caps do not z-fight at shared borders (react-globe extrusion). */
function polygonAltitudeHash(territoryId: string): number {
  let h = 2166136261;
  for (let i = 0; i < territoryId.length; i++) {
    h = Math.imul(h ^ territoryId.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 4096) / 4096;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GlobeEvent {
  id: string;
  type: 'reinforce' | 'combat' | 'fortify';
  territoryId: string;
  fromTerritoryId?: string;
  units?: number;
  totalAfter?: number;
  attackerLosses?: number;
  defenderLosses?: number;
  captured?: boolean;
  playerColor?: string;
  attackerColor?: string;
  defenderColor?: string;
}

interface MapTerritory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
  iso_codes?: string[];
  clip_bbox?: ClipBbox;
  geo_config?: TerritoryGeoConfig;
  geo_polygon?: [number, number][];
}

interface GameMapData {
  map_id?: string;
  canvas_width?: number;
  canvas_height?: number;
  /** Matches `projection_bounds` in map JSON — used for canvas→globe when geo_polygon missing */
  projection_bounds?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  /** Optional globe camera: used for regional / single-theater maps */
  globe_view?: GlobeViewConfig;
  territories: MapTerritory[];
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' }>;
}

interface GlobeMapProps {
  mapData: GameMapData;
  onTerritoryClick: (territoryId: string) => void;
  width?: number;
  height?: number;
  events?: GlobeEvent[];
  onEventDone?: (eventId: string) => void;
  /** Lighter motion (mobile / accessibility): no idle globe spin resume after animations */
  reducedEffects?: boolean;
  /** If set, draw a pulsing gold ring on this territory (tutorial highlighting). */
  highlightTerritoryId?: string;
}

interface HtmlDatum {
  id: string;
  lat: number;
  lng: number;
  alt: number;
  html: string;
}

interface ArcDatum {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
  stroke: number;
  dashLen: number;
  dashGap: number;
  animateTime: number;
  altitude: number | null;
}

interface RingDatum {
  id: string;
  lat: number;
  lng: number;
  maxRadius: number;
  speed: number;
  repeatPeriod: number;
  colorFn: (t: number) => string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(46, 125, 158, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function computeCentroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { lat: number; lng: number } {
  let sumLng = 0, sumLat = 0, count = 0;
  const allPolys = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.coordinates;
  for (const poly of allPolys) {
    for (const ring of poly) {
      for (const coord of ring) {
        sumLng += coord[0];
        sumLat += coord[1];
        count++;
      }
    }
  }
  return count > 0 ? { lat: sumLat / count, lng: sumLng / count } : { lat: 0, lng: 0 };
}

function cameraViewForTwo(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): { lat: number; lng: number; altitude: number } {
  const midLat = (a.lat + b.lat) / 2;
  let midLng: number;
  const dLng = Math.abs(a.lng - b.lng);
  if (dLng > 180) {
    midLng = ((a.lng + b.lng) / 2 + 180) % 360 - 180;
  } else {
    midLng = (a.lng + b.lng) / 2;
  }
  const angDist = Math.sqrt(
    Math.pow(a.lat - b.lat, 2) + Math.pow(dLng > 180 ? 360 - dLng : dLng, 2)
  );
  const altitude = Math.max(1.5, Math.min(3.0, 1.2 + angDist / 40));
  return { lat: midLat, lng: midLng, altitude };
}

let eventIdCounter = 0;
function uid(prefix: string): string {
  return `${prefix}-${++eventIdCounter}-${Date.now()}`;
}

// ── Animation Keyframes (injected as <style>) ─────────────────────────────────

const ANIMATION_STYLES = `
@keyframes globeFloatUp {
  0%   { transform: translateY(0) scale(0.3); opacity: 0; }
  15%  { transform: translateY(-6px) scale(1.15); opacity: 1; }
  60%  { transform: translateY(-22px) scale(1); opacity: 0.95; }
  100% { transform: translateY(-38px) scale(0.9); opacity: 0; }
}
@keyframes globePulseIn {
  0%   { transform: scale(0.4); opacity: 0; }
  25%  { transform: scale(1.08); opacity: 1; }
  65%  { transform: scale(1); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0; }
}
@keyframes globeExplosionPulse {
  0%   { transform: scale(0.3); opacity: 1; filter: brightness(2); }
  40%  { transform: scale(1.6); opacity: 0.7; filter: brightness(1.4); }
  100% { transform: scale(2.2); opacity: 0; filter: brightness(1); }
}
@keyframes globeFadeInUp {
  0%   { transform: translateY(8px); opacity: 0; }
  20%  { transform: translateY(0); opacity: 1; }
  75%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes globeArrowPulse {
  0%   { transform: translateY(4px) scale(0.8); opacity: 0; }
  20%  { transform: translateY(0) scale(1.05); opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes globeCaptured {
  0%   { transform: scale(0.5); opacity: 0; text-shadow: 0 0 0 transparent; }
  30%  { transform: scale(1.2); opacity: 1; text-shadow: 0 0 20px rgba(74,222,128,0.8); }
  60%  { transform: scale(1); opacity: 1; text-shadow: 0 0 12px rgba(74,222,128,0.5); }
  100% { transform: scale(0.95); opacity: 0; text-shadow: 0 0 0 transparent; }
}
`;

// ── Component ──────────────────────────────────────────────────────────────────

export default function GlobeMap({
  mapData,
  onTerritoryClick,
  width = 900,
  height = 600,
  events = [],
  onEventDone,
  reducedEffects = false,
  highlightTerritoryId,
}: GlobeMapProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { gameState } = useGameStore();
  const { selectedTerritory, attackSource } = useUiStore();
  const [countriesGeo, setCountriesGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const [statesGeo, setStatesGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  /** Italy province polygons for era_risorgimento */
  const [risorgimentoGeo, setRisorgimentoGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  /** ne_50m admin-1 — Canadian provinces for community_14_nations */
  const [admin50Geo, setAdmin50Geo] = useState<GeoJSON.FeatureCollection | null>(null);
  /** Gulf admin-1 — community_strait_hormuz */
  const [straitHormuzGeo, setStraitHormuzGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  /** Bumps when react-globe.gl calls onGlobeReady so we can apply camera after the ref exists */
  const [globeReadyTick, setGlobeReadyTick] = useState(0);

  // Animation layer state
  const [overlays, setOverlays] = useState<HtmlDatum[]>([]);
  const [arcs, setArcs] = useState<ArcDatum[]>([]);
  const [rings, setRings] = useState<RingDatum[]>([]);

  // Event queue refs
  const eventQueueRef = useRef<GlobeEvent[]>([]);
  const seenEventIdsRef = useRef(new Set<string>());
  const isAnimatingRef = useRef(false);
  const currentEventIdRef = useRef<string | null>(null);
  const autoRotateTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const cleanupTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** Drives visibility of the "Skip animations" control (refs → React state). */
  const [animationUi, setAnimationUi] = useState({ playing: false, backlog: 0 });
  const flushAnimationUi = useCallback(() => {
    setAnimationUi({
      playing: isAnimatingRef.current,
      backlog: eventQueueRef.current.length,
    });
  }, []);

  useEffect(() => {
    fetch(COUNTRIES_GEOJSON_URL)
      .then((r) => r.json())
      .then(setCountriesGeo)
      .catch((err) => console.warn('Failed to load countries GeoJSON:', err));
  }, []);

  useEffect(() => {
    fetch(STATES_GEOJSON_URL)
      .then((r) => r.json())
      .then(setStatesGeo)
      .catch((err) => {
        console.warn('Failed to load US states GeoJSON:', err);
        setStatesGeo({ type: 'FeatureCollection', features: [] });
      });
  }, []);

  const needsRisorgimentoGeo =
    mapData.map_id === 'era_risorgimento' ||
    mapData.territories.some((t) => t.territory_id.startsWith('ris_'));

  useEffect(() => {
    if (!needsRisorgimentoGeo) {
      setRisorgimentoGeo(null);
      return;
    }
    fetch(RISORGIMENTO_GEOJSON_URL)
      .then((r) => r.json())
      .then(setRisorgimentoGeo)
      .catch((err) => {
        console.warn('Failed to load Risorgimento GeoJSON:', err);
        setRisorgimentoGeo({ type: 'FeatureCollection', features: [] });
      });
  }, [needsRisorgimentoGeo]);

  const needsAdmin50Geo =
    mapData.map_id === 'community_14_nations' ||
    mapData.territories.some((t) => t.territory_id.startsWith('na_'));

  useEffect(() => {
    if (!needsAdmin50Geo) {
      setAdmin50Geo(null);
      return;
    }
    fetch(ADMIN50_STATES_GEOJSON_URL)
      .then((r) => r.json())
      .then(setAdmin50Geo)
      .catch((err) => {
        console.warn('Failed to load ne_50m admin-1 GeoJSON:', err);
        setAdmin50Geo({ type: 'FeatureCollection', features: [] });
      });
  }, [needsAdmin50Geo]);

  const needsStraitHormuzGeo =
    mapData.map_id === 'community_strait_hormuz' ||
    mapData.territories.some((t) => t.territory_id.startsWith('hz_'));

  useEffect(() => {
    if (!needsStraitHormuzGeo) {
      setStraitHormuzGeo(null);
      return;
    }
    fetch(STRAIT_HORMUZ_GEOJSON_URL)
      .then((r) => r.json())
      .then(setStraitHormuzGeo)
      .catch((err) => {
        console.warn('Failed to load Strait of Hormuz admin-1 GeoJSON:', err);
        setStraitHormuzGeo({ type: 'FeatureCollection', features: [] });
      });
  }, [needsStraitHormuzGeo]);

  // ── Polygon data (territories) ─────────────────────────────────────────

  const polygonsData = useMemo(
    (): PolygonData[] =>
      buildTerritoryGlobeGeometries(mapData, {
        countriesGeo,
        statesGeo,
        risorgimentoGeo,
        admin50Geo,
        straitHormuzGeo,
      }),
    [mapData, countriesGeo, statesGeo, risorgimentoGeo, admin50Geo, straitHormuzGeo],
  );

  // ── Territory center lookup ────────────────────────────────────────────

  const territoryCenters = useMemo(() => {
    const centers = new Map<string, { lat: number; lng: number }>();
    for (const p of polygonsData) {
      centers.set(p.territory_id, computeCentroid(p.geometry));
    }
    return centers;
  }, [polygonsData]);

  const territoryCentersRef = useRef(territoryCenters);
  territoryCentersRef.current = territoryCenters;

  const regionalGlobe = useMemo(
    () => deriveRegionalGlobeView(mapData.globe_view, territoryCenters),
    [mapData.globe_view, territoryCenters],
  );
  /**
   * Regional / authored-bounds maps: every extruded polygon uses cap + side materials.
   * Semi-transparent sides (default in three-globe) overlap thousands of faces from neighbors
   * and sort unpredictably — same RGB “shard” noise as transparent caps. Opaque cap + side fixes it.
   */
  const useSolidPlayerCaps =
    regionalGlobe.lockRotation === true || mapData.projection_bounds != null;
  const regionalGlobeRef = useRef(regionalGlobe);
  regionalGlobeRef.current = regionalGlobe;

  // ── Animation helpers ──────────────────────────────────────────────────

  const addOverlay = useCallback((item: HtmlDatum) => {
    setOverlays(prev => [...prev, item]);
  }, []);

  const removeOverlay = useCallback((id: string) => {
    setOverlays(prev => prev.filter(o => o.id !== id));
  }, []);

  const addArc = useCallback((item: ArcDatum) => {
    setArcs(prev => [...prev, item]);
  }, []);

  const removeArc = useCallback((id: string) => {
    setArcs(prev => prev.filter(a => a.id !== id));
  }, []);

  const addRings = useCallback((item: RingDatum) => {
    setRings(prev => [...prev, item]);
  }, []);

  const removeRings = useCallback((id: string) => {
    setRings(prev => prev.filter(r => r.id !== id));
  }, []);

  const scheduleTimer = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    cleanupTimersRef.current.push(t);
    return t;
  }, []);

  const panCamera = useCallback((lat: number, lng: number, altitude: number, ms = 800) => {
    globeRef.current?.pointOfView({ lat, lng, altitude }, ms);
  }, []);

  const pauseAutoRotate = useCallback(() => {
    clearTimeout(autoRotateTimerRef.current);
    const ctrl = globeRef.current?.controls?.();
    if (ctrl) ctrl.autoRotate = false;
  }, []);

  const scheduleAutoRotateResume = useCallback(() => {
    if (reducedEffects || regionalGlobeRef.current.lockRotation) return;
    clearTimeout(autoRotateTimerRef.current);
    autoRotateTimerRef.current = setTimeout(() => {
      const ctrl = globeRef.current?.controls?.();
      if (ctrl && !regionalGlobeRef.current.lockRotation) {
        ctrl.autoRotate = true;
        ctrl.autoRotateSpeed = 0.4;
      }
    }, 2500);
  }, [reducedEffects]);

  // Regional maps: fixed camera, no idle spin; world maps: rotate when not in combat anim
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const ctrl = globe.controls?.();
    if (!ctrl) return;

    const lock = regionalGlobe.lockRotation || reducedEffects;
    ctrl.autoRotate = !lock;
    ctrl.autoRotateSpeed = lock ? 0 : 0.4;

    globe.pointOfView(
      {
        lat: regionalGlobe.centerLat,
        lng: regionalGlobe.centerLng,
        altitude: regionalGlobe.altitude,
      },
      0,
    );
  }, [regionalGlobe, reducedEffects, globeReadyTick]);

  /**
   * three-conic-polygon-geometry uses this as max segment length (degrees) before interpolating ring
   * vertices, and skips interior grid points only when min(lng span, lat span) < this value.
   * At the default 5°, large authored quads (14 Nations) get planar Delaunay + sphere lift → shard noise.
   * Natural Earth regional maps need ~5° for smooth coastlines. Maps with `projection_bounds` use WGS84
   * quads only → use 360° so we effectively keep the authored ring and earcut (no interior grid).
   */
  const polygonCapCurvatureResolution = useMemo(
    () => (mapData.projection_bounds != null ? 360 : 5),
    [mapData.projection_bounds],
  );

  /** Keep WebGL backing store in sync when the game resizes the map pane (devtools, sidebar, etc.). */
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || width <= 0 || height <= 0) return;
    globe.renderer().setSize(width, height);
  }, [width, height, globeReadyTick]);

  const getPolygonAltitude = useCallback(
    (polygon: object) => {
      const id = (polygon as PolygonData).territory_id;
      const authoredRegional = mapData.projection_bounds != null;
      const tutorialIsland = mapData.map_id === 'tutorial';
      const base = authoredRegional
        ? tutorialIsland
          ? 0.014
          : 0.0075
        : regionalGlobe.lockRotation
          ? 0.0045
          : 0.008;
      const jitter =
        regionalGlobe.lockRotation || authoredRegional ? polygonAltitudeHash(id) * 0.0015 : 0;
      return base + jitter;
    },
    [regionalGlobe.lockRotation, mapData.map_id, mapData.projection_bounds],
  );

  // ── Animation sequences ────────────────────────────────────────────────

  const playNextRef = useRef<() => void>(() => {});

  const animateReinforce = useCallback((event: GlobeEvent) => {
    const center = territoryCentersRef.current.get(event.territoryId);
    if (!center) { playNextRef.current(); return; }

    pauseAutoRotate();
    if (!regionalGlobeRef.current.lockRotation) {
      panCamera(center.lat, center.lng, 1.5);
    }

    const color = event.playerColor ?? '#4ade80';
    const plusId = uid('reinforce-plus');
    const totalId = uid('reinforce-total');

    // Phase 1: "+N" floating up
    scheduleTimer(() => {
      addOverlay({
        id: plusId,
        lat: center.lat,
        lng: center.lng,
        alt: 0.04,
        html: `<div style="
          font-family: 'Courier New', monospace;
          font-weight: 900; font-size: 24px;
          color: ${color}; white-space: nowrap; text-align: center;
          text-shadow: 0 0 14px ${color}, 0 2px 6px rgba(0,0,0,0.7);
          animation: globeFloatUp 1.4s ease-out forwards;
          pointer-events: none;
        ">+${event.units ?? 1}</div>`,
      });
    }, 800);

    // Phase 2: "Total: X"
    scheduleTimer(() => {
      removeOverlay(plusId);
      addOverlay({
        id: totalId,
        lat: center.lat,
        lng: center.lng,
        alt: 0.04,
        html: `<div style="
          font-family: 'Courier New', monospace;
          font-weight: 700; font-size: 15px;
          color: #fff; white-space: nowrap; text-align: center;
          background: rgba(0,0,0,0.78); padding: 3px 12px;
          border-radius: 6px; border: 1px solid ${color}55;
          animation: globePulseIn 1.1s ease-out forwards;
          pointer-events: none;
        ">Total: ${event.totalAfter ?? '?'}</div>`,
      });
    }, 2000);

    // Cleanup
    scheduleTimer(() => {
      removeOverlay(totalId);
      playNextRef.current();
    }, 3200);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay]);

  const animateCombat = useCallback((event: GlobeEvent) => {
    const targetCenter = territoryCentersRef.current.get(event.territoryId);
    const sourceCenter = event.fromTerritoryId
      ? territoryCentersRef.current.get(event.fromTerritoryId)
      : null;
    if (!targetCenter) { playNextRef.current(); return; }

    pauseAutoRotate();

    // World maps: frame the action. Regional (locked) maps: keep the user’s camera.
    if (!regionalGlobeRef.current.lockRotation) {
      if (sourceCenter) {
        const view = cameraViewForTwo(sourceCenter, targetCenter);
        panCamera(view.lat, view.lng, view.altitude);
      } else {
        panCamera(targetCenter.lat, targetCenter.lng, 1.8);
      }
    }

    const atkColor = event.attackerColor ?? '#ef4444';
    const defColor = event.defenderColor ?? '#3b82f6';
    const arcId = uid('combat-arc');
    const ringId = uid('combat-ring');
    const explosionId = uid('combat-explosion');
    const atkLossId = uid('combat-atk-loss');
    const defLossId = uid('combat-def-loss');
    const capturedId = uid('combat-captured');

    // Phase 1: Attack arc
    if (sourceCenter) {
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: sourceCenter.lat,
          startLng: sourceCenter.lng,
          endLat: targetCenter.lat,
          endLng: targetCenter.lng,
          color: [atkColor, '#ff6b35'],
          stroke: 2.5,
          dashLen: 0.4,
          dashGap: 0.15,
          animateTime: 500,
          altitude: null,
        });
      }, 600);
    }

    // Phase 2: Explosion rings at target
    scheduleTimer(() => {
      addRings({
        id: ringId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        maxRadius: 4,
        speed: 4,
        repeatPeriod: 350,
        colorFn: (t: number) => `rgba(255, 120, 50, ${Math.pow(1 - t, 1.5)})`,
      });
    }, 900);

    // Phase 3: Explosion emoji
    scheduleTimer(() => {
      addOverlay({
        id: explosionId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        alt: 0.06,
        html: `<div style="
          font-size: 36px; text-align: center;
          text-shadow: 0 0 24px rgba(255,150,50,0.9), 0 0 48px rgba(255,100,0,0.5);
          animation: globeExplosionPulse 0.9s ease-out forwards;
          pointer-events: none;
        ">💥</div>`,
      });
    }, 1100);

    // Phase 4: Loss labels
    scheduleTimer(() => {
      removeOverlay(explosionId);
      removeRings(ringId);

      if (sourceCenter && (event.attackerLosses ?? 0) > 0) {
        addOverlay({
          id: atkLossId,
          lat: sourceCenter.lat,
          lng: sourceCenter.lng,
          alt: 0.04,
          html: `<div style="
            font-family: 'Courier New', monospace;
            font-weight: 900; font-size: 20px;
            color: #f87171; white-space: nowrap; text-align: center;
            text-shadow: 0 0 10px rgba(248,113,113,0.7), 0 2px 4px rgba(0,0,0,0.6);
            animation: globeFadeInUp 1.4s ease-out forwards;
            pointer-events: none;
          ">-${event.attackerLosses} ⚔️</div>`,
        });
      }

      const defLoss = event.defenderLosses ?? 0;
      if (defLoss > 0) {
        addOverlay({
          id: defLossId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.04,
          html: `<div style="
            font-family: 'Courier New', monospace;
            font-weight: 900; font-size: 20px;
            color: #f87171; white-space: nowrap; text-align: center;
            text-shadow: 0 0 10px rgba(248,113,113,0.7), 0 2px 4px rgba(0,0,0,0.6);
            animation: globeFadeInUp 1.4s ease-out forwards;
            pointer-events: none;
          ">-${defLoss} 🛡️</div>`,
        });
      }
    }, 1800);

    // Phase 5: Captured banner (if applicable)
    if (event.captured) {
      scheduleTimer(() => {
        addOverlay({
          id: capturedId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.07,
          html: `<div style="
            font-family: 'Courier New', monospace;
            font-weight: 900; font-size: 16px;
            color: #4ade80; white-space: nowrap; text-align: center;
            text-shadow: 0 0 16px rgba(74,222,128,0.8);
            animation: globeCaptured 1.6s ease-out forwards;
            pointer-events: none;
          ">⚑ CAPTURED!</div>`,
        });
      }, 2200);
    }

    // Cleanup
    const totalDuration = event.captured ? 3800 : 3300;
    scheduleTimer(() => {
      removeArc(arcId);
      removeRings(ringId);
      removeOverlay(explosionId);
      removeOverlay(atkLossId);
      removeOverlay(defLossId);
      removeOverlay(capturedId);
      playNextRef.current();
    }, totalDuration);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay, addArc, removeArc, addRings, removeRings]);

  const animateFortify = useCallback((event: GlobeEvent) => {
    const destCenter = territoryCentersRef.current.get(event.territoryId);
    const srcCenter = event.fromTerritoryId
      ? territoryCentersRef.current.get(event.fromTerritoryId)
      : null;
    if (!destCenter) { playNextRef.current(); return; }

    pauseAutoRotate();

    if (!regionalGlobeRef.current.lockRotation) {
      if (srcCenter) {
        const view = cameraViewForTwo(srcCenter, destCenter);
        panCamera(view.lat, view.lng, view.altitude);
      } else {
        panCamera(destCenter.lat, destCenter.lng, 1.5);
      }
    }

    const color = event.playerColor ?? '#38bdf8';
    const arcId = uid('fortify-arc');
    const srcLabelId = uid('fortify-src');
    const dstLabelId = uid('fortify-dst');

    // Phase 1: Movement arc
    if (srcCenter) {
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: srcCenter.lat,
          startLng: srcCenter.lng,
          endLat: destCenter.lat,
          endLng: destCenter.lng,
          color: ['#38bdf8', '#06b6d4'],
          stroke: 2,
          dashLen: 0.3,
          dashGap: 0.2,
          animateTime: 800,
          altitude: null,
        });
      }, 600);
    }

    // Phase 2: Unit count overlays
    scheduleTimer(() => {
      if (srcCenter) {
        addOverlay({
          id: srcLabelId,
          lat: srcCenter.lat,
          lng: srcCenter.lng,
          alt: 0.04,
          html: `<div style="
            font-family: 'Courier New', monospace;
            font-weight: 900; font-size: 20px;
            color: #fbbf24; white-space: nowrap; text-align: center;
            text-shadow: 0 0 10px rgba(251,191,36,0.6), 0 2px 4px rgba(0,0,0,0.6);
            animation: globeArrowPulse 1.4s ease-out forwards;
            pointer-events: none;
          ">-${event.units ?? 0} →</div>`,
        });
      }
      addOverlay({
        id: dstLabelId,
        lat: destCenter.lat,
        lng: destCenter.lng,
        alt: 0.04,
        html: `<div style="
          font-family: 'Courier New', monospace;
          font-weight: 900; font-size: 20px;
          color: ${color}; white-space: nowrap; text-align: center;
          text-shadow: 0 0 10px ${color}99, 0 2px 4px rgba(0,0,0,0.6);
          animation: globeArrowPulse 1.4s ease-out forwards;
          pointer-events: none;
        ">+${event.units ?? 0}</div>`,
      });
    }, 800);

    // Cleanup
    scheduleTimer(() => {
      removeArc(arcId);
      removeOverlay(srcLabelId);
      removeOverlay(dstLabelId);
      playNextRef.current();
    }, 2600);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay, addArc, removeArc]);

  // ── Event queue engine ─────────────────────────────────────────────────

  playNextRef.current = () => {
    const next = eventQueueRef.current.shift();
    if (!next) {
      isAnimatingRef.current = false;
      currentEventIdRef.current = null;
      scheduleAutoRotateResume();
      flushAnimationUi();
      return;
    }
    isAnimatingRef.current = true;
    currentEventIdRef.current = next.id;
    flushAnimationUi();

    switch (next.type) {
      case 'reinforce': animateReinforce(next); break;
      case 'combat': animateCombat(next); break;
      case 'fortify': animateFortify(next); break;
      default: playNextRef.current(); break;
    }
  };

  const skipRemainingAnimations = useCallback(() => {
    for (const t of cleanupTimersRef.current) clearTimeout(t);
    cleanupTimersRef.current = [];
    setOverlays([]);
    setArcs([]);
    setRings([]);

    const ids: string[] = [];
    if (currentEventIdRef.current) ids.push(currentEventIdRef.current);
    for (const ev of eventQueueRef.current) ids.push(ev.id);
    eventQueueRef.current = [];
    currentEventIdRef.current = null;
    isAnimatingRef.current = false;

    for (const id of ids) onEventDone?.(id);
    scheduleAutoRotateResume();
    flushAnimationUi();
  }, [onEventDone, scheduleAutoRotateResume, flushAnimationUi]);

  const showSkipAnimations =
    animationUi.playing && animationUi.backlog > 0;

  useEffect(() => {
    let hasNew = false;
    for (const ev of events) {
      if (!seenEventIdsRef.current.has(ev.id)) {
        seenEventIdsRef.current.add(ev.id);
        eventQueueRef.current.push(ev);
        onEventDone?.(ev.id);
        hasNew = true;
      }
    }
    // Prevent unbounded growth of seen IDs in long sessions
    if (seenEventIdsRef.current.size > 500) {
      const entries = [...seenEventIdsRef.current];
      seenEventIdsRef.current = new Set(entries.slice(-200));
    }
    flushAnimationUi();
    if (hasNew && !isAnimatingRef.current) {
      playNextRef.current();
    }
  }, [events, onEventDone, flushAnimationUi]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const t of cleanupTimersRef.current) clearTimeout(t);
      clearTimeout(autoRotateTimerRef.current);
    };
  }, []);

  // ── Adjacency arcs (show attackable / fortifiable connections) ──────────

  const territoryCentroids = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    for (const poly of polygonsData) {
      if (!map.has(poly.territory_id)) {
        const c = computeCentroid(poly.geometry);
        map.set(poly.territory_id, c);
      }
    }
    return map;
  }, [polygonsData]);

  const buildingHtmlOverlays = useMemo((): HtmlDatum[] => {
    if (!gameState) return [];
    const out: HtmlDatum[] = [];
    for (const [tid, tState] of Object.entries(gameState.territories)) {
      const buildings: string[] = (tState as { buildings?: string[] }).buildings ?? [];
      if (buildings.length === 0) continue;
      const c = territoryCentroids.get(tid);
      if (!c) continue;
      const icons = buildings
        .map((b: string) => {
          if (b.includes('port') || b.includes('naval')) return '⚓';
          if (b.includes('fort') || b.includes('wall') || b.includes('defense') || b.includes('castle')) return '🛡';
          if (b.includes('lab') || b.includes('acad') || b.includes('univ') || b.includes('research')) return '🔬';
          if (b.includes('farm') || b.includes('mine') || b.includes('market') || b.includes('production') || b.includes('plantation')) return '⚙';
          return '🏛';
        })
        .join('');
      out.push({
        id: `building-globe-${tid}`,
        lat: c.lat,
        lng: c.lng,
        alt: 0.055,
        html: `<div style="font-size:10px;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,0.9);pointer-events:none;" title="${buildings.join(', ')}">${icons}</div>`,
      });
    }
    return out;
  }, [gameState, territoryCentroids]);

  const capitalHtmlOverlays = useMemo((): HtmlDatum[] => {
    if (!gameState) return [];
    const out: HtmlDatum[] = [];
    for (const pl of gameState.players) {
      if (!pl.capital_territory_id) continue;
      const c = territoryCentroids.get(pl.capital_territory_id);
      if (!c) continue;
      out.push({
        id: `capital-globe-${pl.player_id}`,
        lat: c.lat,
        lng: c.lng,
        alt: 0.045,
        html: `<div style="
          width:12px;height:12px;
          transform:rotate(45deg);
          border:2px solid #ffd700;
          background:${pl.color};
          box-shadow:0 0 6px rgba(0,0,0,0.85);
          pointer-events:none;
        " title="Capital"></div>`,
      });
    }
    return out;
  }, [gameState, territoryCentroids]);

  const combinedHtmlOverlays = useMemo(
    () => [...capitalHtmlOverlays, ...buildingHtmlOverlays, ...overlays],
    [capitalHtmlOverlays, buildingHtmlOverlays, overlays],
  );

  const adjacencyArcs = useMemo(() => {
    if (!gameState) return [];
    const phase = gameState.phase;
    const source = attackSource ?? selectedTerritory;
    if (!source) return [];

    const sourceOwner = gameState.territories[source]?.owner_id;
    const myId = gameState.players.find(p =>
      p.player_id === sourceOwner
    )?.player_id;
    if (!myId) return [];

    const sourceCenter = territoryCentroids.get(source);
    if (!sourceCenter) return [];

    const result: ArcDatum[] = [];
    for (const conn of mapData.connections) {
      const neighborId = conn.from === source ? conn.to : conn.to === source ? conn.from : null;
      if (!neighborId) continue;

      const neighborOwner = gameState.territories[neighborId]?.owner_id;
      const neighborCenter = territoryCentroids.get(neighborId);
      if (!neighborCenter) continue;

      if (phase === 'attack') {
        if (neighborOwner === myId || !neighborOwner) continue;
        const isSea = conn.type === 'sea';
        result.push({
          id: `adj-${source}-${neighborId}`,
          startLat: sourceCenter.lat,
          startLng: sourceCenter.lng,
          endLat: neighborCenter.lat,
          endLng: neighborCenter.lng,
          color: isSea ? ['rgba(250, 204, 21, 0.6)', 'rgba(250, 204, 21, 0.15)'] : ['rgba(248, 113, 113, 0.6)', 'rgba(248, 113, 113, 0.15)'],
          stroke: isSea ? 1.2 : 1.5,
          dashLen: isSea ? 4 : 8,
          dashGap: isSea ? 4 : 3,
          animateTime: 2000,
          altitude: isSea ? 0.15 : 0.05,
        });
      } else if (phase === 'fortify') {
        if (neighborOwner !== myId) continue;
        result.push({
          id: `adj-${source}-${neighborId}`,
          startLat: sourceCenter.lat,
          startLng: sourceCenter.lng,
          endLat: neighborCenter.lat,
          endLng: neighborCenter.lng,
          color: ['rgba(74, 222, 128, 0.5)', 'rgba(74, 222, 128, 0.1)'],
          stroke: 1.0,
          dashLen: 6,
          dashGap: 4,
          animateTime: 3000,
          altitude: 0.04,
        });
      }
    }
    return result;
  }, [gameState, attackSource, selectedTerritory, mapData.connections, territoryCentroids]);

  // ── Permanent sea lane arcs ────────────────────────────────────────────
  // Sea-route territories (region_id === 'sea_routes') are rendered as tiny
  // polygon markers on the ocean.  These arcs draw the actual trade-route
  // spokes from each marker hub to every land territory it connects.

  const seaRouteTerritoryIds = useMemo(
    () => new Set(mapData.territories.filter((t) => t.region_id === 'sea_routes').map((t) => t.territory_id)),
    [mapData.territories],
  );

  const seaLaneArcs = useMemo((): ArcDatum[] => {
    if (seaRouteTerritoryIds.size === 0) return [];
    const result: ArcDatum[] = [];

    for (const seaId of seaRouteTerritoryIds) {
      const seaCenter = territoryCentroids.get(seaId);
      if (!seaCenter) continue;

      // Color by current owner, else default ocean teal
      let c0 = 'rgba(46, 125, 158, 0.55)';
      let c1 = 'rgba(46, 125, 158, 0.18)';
      if (gameState) {
        const ownerId = gameState.territories[seaId]?.owner_id;
        const owner = ownerId ? gameState.players.find((p) => p.player_id === ownerId) : null;
        if (owner?.color) {
          c0 = hexToRgba(owner.color, 0.55);
          c1 = hexToRgba(owner.color, 0.18);
        }
      }

      for (const conn of mapData.connections) {
        const neighborId = conn.from === seaId ? conn.to : conn.to === seaId ? conn.from : null;
        if (!neighborId) continue;
        if (seaRouteTerritoryIds.has(neighborId)) continue; // skip sea-to-sea
        const neighborCenter = territoryCentroids.get(neighborId);
        if (!neighborCenter) continue;

        result.push({
          id: `sealane-${seaId}-${neighborId}`,
          startLat: seaCenter.lat,
          startLng: seaCenter.lng,
          endLat: neighborCenter.lat,
          endLng: neighborCenter.lng,
          color: [c0, c1],
          stroke: 1.0,
          dashLen: 0.35,
          dashGap: 0.25,
          animateTime: 6000,
          altitude: 0.1,
        });
      }
    }
    return result;
  }, [seaRouteTerritoryIds, territoryCentroids, mapData.connections, gameState]);

  const combinedArcs = useMemo(
    () => [...seaLaneArcs, ...arcs, ...adjacencyArcs],
    [seaLaneArcs, arcs, adjacencyArcs],
  );

  // ── Polygon accessors ──────────────────────────────────────────────────

  const getPolygonColor = useCallback((polygon: object) => {
    const p = polygon as PolygonData;
    const empty = useSolidPlayerCaps ? 'rgb(45, 52, 72)' : 'rgba(45, 52, 72, 0.92)';
    if (!gameState) return empty;
    const tState = gameState.territories[p.territory_id];
    if (!tState?.owner_id) return empty;
    const player = gameState.players.find((ply) => ply.player_id === tState.owner_id);
    if (!player) return empty;
    const table = useSolidPlayerCaps ? PLAYER_COLORS_SOLID : PLAYER_COLORS;
    const raw = (player.color || '').trim();
    const lookupKey = raw.startsWith('#') ? raw.toLowerCase() : raw;
    return table[lookupKey] ?? (useSolidPlayerCaps ? 'rgb(136, 136, 136)' : 'rgba(136, 136, 136, 0.92)');
  }, [gameState, useSolidPlayerCaps]);

  const adjacencyTargets = useMemo(() => {
    const set = new Set<string>();
    for (const arc of adjacencyArcs) {
      const parts = arc.id.split('-');
      set.add(parts[parts.length - 1]);
    }
    return set;
  }, [adjacencyArcs]);

  const getPolygonStroke = useCallback((polygon: object) => {
    const p = polygon as PolygonData;
    if (p.territory_id === selectedTerritory || p.territory_id === attackSource) {
      return '#ffd700';
    }
    if (adjacencyTargets.has(p.territory_id)) {
      return gameState?.phase === 'attack' ? '#f87171' : '#4ade80';
    }
    /** World: dark rim vs ocean. Regional solid-fill: light opaque outline so borders read clearly on player colors. */
    return useSolidPlayerCaps ? 'rgb(228, 234, 245)' : 'rgba(12, 18, 32, 0.92)';
  }, [selectedTerritory, attackSource, adjacencyTargets, gameState?.phase, useSolidPlayerCaps]);

  const getPolygonSideColor = useCallback(() => {
    return useSolidPlayerCaps ? 'rgb(14, 18, 30)' : 'rgba(6, 10, 18, 0.45)';
  }, [useSolidPlayerCaps]);

  // ── Globe layer accessors (stable) ─────────────────────────────────────

  const htmlElAccessors = useMemo(() => ({
    lat: (d: object) => (d as HtmlDatum).lat,
    lng: (d: object) => (d as HtmlDatum).lng,
    alt: (d: object) => (d as HtmlDatum).alt,
    element: (d: object) => {
      const datum = d as HtmlDatum;
      const el = document.createElement('div');
      el.innerHTML = datum.html;
      el.style.pointerEvents = 'none';
      return el;
    },
  }), []);

  const arcAccessors = useMemo(() => ({
    startLat: (d: object) => (d as ArcDatum).startLat,
    startLng: (d: object) => (d as ArcDatum).startLng,
    endLat: (d: object) => (d as ArcDatum).endLat,
    endLng: (d: object) => (d as ArcDatum).endLng,
    color: (d: object) => (d as ArcDatum).color,
    stroke: (d: object) => (d as ArcDatum).stroke,
    dashLen: (d: object) => (d as ArcDatum).dashLen,
    dashGap: (d: object) => (d as ArcDatum).dashGap,
    animateTime: (d: object) => (d as ArcDatum).animateTime,
    altitude: (d: object) => (d as ArcDatum).altitude,
  }), []);

  // ── Tutorial highlight ring ──────────────────────────────────────────────
  const tutorialRing = useMemo((): RingDatum | null => {
    if (!highlightTerritoryId) return null;
    const center = territoryCenters.get(highlightTerritoryId);
    if (!center) return null;
    return {
      id: `tutorial-highlight-${highlightTerritoryId}`,
      lat: center.lat,
      lng: center.lng,
      maxRadius: 1.2,
      speed: 1.5,
      repeatPeriod: 800,
      colorFn: (t: number) => `rgba(255, 215, 0, ${Math.max(0, 1 - t)})`,
    };
  }, [highlightTerritoryId, territoryCenters]);

  const combinedRings = useMemo(
    () => (tutorialRing ? [...rings, tutorialRing] : rings),
    [rings, tutorialRing],
  );

  const ringAccessors = useMemo(() => ({
    lat: (d: object) => (d as RingDatum).lat,
    lng: (d: object) => (d as RingDatum).lng,
    maxRadius: (d: object) => (d as RingDatum).maxRadius,
    speed: (d: object) => (d as RingDatum).speed,
    repeatPeriod: (d: object) => (d as RingDatum).repeatPeriod,
    color: (d: object) => (d as RingDatum).colorFn,
  }), []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="w-full h-full rounded-lg overflow-hidden bg-cc-dark relative">
      <style dangerouslySetInnerHTML={{ __html: ANIMATION_STYLES }} />
      {showSkipAnimations && (
        <button
          type="button"
          onClick={skipRemainingAnimations}
          title="Skip queued globe animations (current one ends immediately)"
          className="absolute top-4 right-4 z-30 pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg
            bg-[rgba(18,22,35,0.92)] border border-cc-gold/45 text-cc-gold text-sm font-medium shadow-lg
            hover:bg-cc-gold/10 hover:border-cc-gold/70 transition-colors backdrop-blur-sm"
        >
          <FastForward className="w-4 h-4 shrink-0" aria-hidden />
          <span>Skip animations</span>
          <span className="text-xs tabular-nums opacity-85">({animationUi.backlog} queued)</span>
        </button>
      )}
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

        /* Territories */
        polygonsData={polygonsData}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={getPolygonColor}
        polygonSideColor={getPolygonSideColor}
        polygonStrokeColor={getPolygonStroke}
        polygonAltitude={getPolygonAltitude}
        polygonCapCurvatureResolution={polygonCapCurvatureResolution}
        polygonsTransitionDuration={0}
        polygonLabel={(p) =>
          mapData.map_id === 'tutorial' ? '' : (p as PolygonData).name
        }
        onPolygonClick={(polygon) => polygon && onTerritoryClick((polygon as PolygonData).territory_id)}

        /* HTML overlays (floating text) */
        htmlElementsData={combinedHtmlOverlays}
        htmlLat={htmlElAccessors.lat}
        htmlLng={htmlElAccessors.lng}
        htmlAltitude={htmlElAccessors.alt}
        htmlElement={htmlElAccessors.element}
        htmlTransitionDuration={0}

        /* Arcs (event animations + adjacency indicators) */
        arcsData={combinedArcs}
        arcStartLat={arcAccessors.startLat}
        arcStartLng={arcAccessors.startLng}
        arcEndLat={arcAccessors.endLat}
        arcEndLng={arcAccessors.endLng}
        arcColor={arcAccessors.color}
        arcStroke={arcAccessors.stroke}
        arcDashLength={arcAccessors.dashLen}
        arcDashGap={arcAccessors.dashGap}
        arcDashAnimateTime={arcAccessors.animateTime}
        arcAltitude={arcAccessors.altitude}

        /* Rings (explosion effects + tutorial highlight) */
        ringsData={combinedRings}
        ringLat={ringAccessors.lat}
        ringLng={ringAccessors.lng}
        ringColor={ringAccessors.color}
        ringMaxRadius={ringAccessors.maxRadius}
        ringPropagationSpeed={ringAccessors.speed}
        ringRepeatPeriod={ringAccessors.repeatPeriod}

        onGlobeReady={() => {
          setGlobeReadyTick((t) => t + 1);
        }}
      />
    </div>
  );
}
