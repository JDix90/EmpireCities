/**
 * ChronoConquest — Interactive 3D Globe Map
 * Renders territories on a spin-able 3D globe using react-globe.gl.
 * Supports animated event overlays: reinforcements, combat, and fortification.
 */

import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { FastForward } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import {
  TERRITORY_ISO_MAP,
  TERRITORY_GEO_CONFIG,
  type TerritoryGeoConfig,
  type ClipBbox,
} from '../../data/territoryGeoMapping';
import { clipToBbox } from '../../utils/geoClip';

// ── Constants ──────────────────────────────────────────────────────────────────

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
  events?: GlobeEvent[];
  onEventDone?: (eventId: string) => void;
}

interface PolygonData {
  territory_id: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
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
      if (poly && poly[0] && poly[0].length >= 4) {
        polygons.push(poly);
      }
    }
  }
  return { type: 'MultiPolygon', coordinates: polygons };
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
}: GlobeMapProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { gameState, selectedTerritory, attackSource } = useGameStore();
  const [countriesGeo, setCountriesGeo] = useState<GeoJSON.FeatureCollection | null>(null);

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

  const canvasW = mapData.canvas_width ?? 1200;
  const canvasH = mapData.canvas_height ?? 700;

  useEffect(() => {
    fetch(COUNTRIES_GEOJSON_URL)
      .then((r) => r.json())
      .then(setCountriesGeo)
      .catch((err) => console.warn('Failed to load countries GeoJSON:', err));
  }, []);

  // ── Polygon data (territories) ─────────────────────────────────────────

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
    clearTimeout(autoRotateTimerRef.current);
    autoRotateTimerRef.current = setTimeout(() => {
      const ctrl = globeRef.current?.controls?.();
      if (ctrl) {
        ctrl.autoRotate = true;
        ctrl.autoRotateSpeed = 0.4;
      }
    }, 2500);
  }, []);

  // ── Animation sequences ────────────────────────────────────────────────

  const playNextRef = useRef<() => void>(() => {});

  const animateReinforce = useCallback((event: GlobeEvent) => {
    const center = territoryCentersRef.current.get(event.territoryId);
    if (!center) { playNextRef.current(); return; }

    pauseAutoRotate();
    panCamera(center.lat, center.lng, 1.5);

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

    // Camera: if we have both territories, show midpoint; otherwise focus target
    if (sourceCenter) {
      const view = cameraViewForTwo(sourceCenter, targetCenter);
      panCamera(view.lat, view.lng, view.altitude);
    } else {
      panCamera(targetCenter.lat, targetCenter.lng, 1.8);
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

    if (srcCenter) {
      const view = cameraViewForTwo(srcCenter, destCenter);
      panCamera(view.lat, view.lng, view.altitude);
    } else {
      panCamera(destCenter.lat, destCenter.lng, 1.5);
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

  const combinedArcs = useMemo(() => [...arcs, ...adjacencyArcs], [arcs, adjacencyArcs]);

  // ── Polygon accessors ──────────────────────────────────────────────────

  const getPolygonColor = useCallback((polygon: object) => {
    const p = polygon as PolygonData;
    if (!gameState) return 'rgba(45, 52, 72, 0.72)';
    const tState = gameState.territories[p.territory_id];
    if (!tState?.owner_id) return 'rgba(45, 52, 72, 0.72)';
    const player = gameState.players.find((ply) => ply.player_id === tState.owner_id);
    if (!player) return 'rgba(45, 52, 72, 0.72)';
    return PLAYER_COLORS[player.color] ?? 'rgba(136, 136, 136, 0.82)';
  }, [gameState]);

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
    return '#ffffff';
  }, [selectedTerritory, attackSource, adjacencyTargets, gameState?.phase]);

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
        polygonSideColor={() => 'rgba(0, 0, 0, 0.2)'}
        polygonStrokeColor={getPolygonStroke}
        polygonAltitude={0.008}
        polygonLabel={(p) => (p as PolygonData).name}
        onPolygonClick={(polygon) => polygon && onTerritoryClick((polygon as PolygonData).territory_id)}

        /* HTML overlays (floating text) */
        htmlElementsData={overlays}
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

        /* Rings (explosion effects) */
        ringsData={rings}
        ringLat={ringAccessors.lat}
        ringLng={ringAccessors.lng}
        ringColor={ringAccessors.color}
        ringMaxRadius={ringAccessors.maxRadius}
        ringPropagationSpeed={ringAccessors.speed}
        ringRepeatPeriod={ringAccessors.repeatPeriod}

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
