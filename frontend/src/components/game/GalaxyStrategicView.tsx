/**
 * Galactic Age — 3D galaxy strategic view.
 *
 * Renders the multi-world chart as a deep-space sphere with system nodes,
 * hyperspace lanes, and per-world clusters. Lanes locked behind the active
 * player's orbit-access state render dim red so players see, at a glance,
 * which routes are gated. Click a node to drill into its world.
 *
 * Uses `react-globe.gl` (same dependency as `GlobeMap`) for parity with
 * the rest of the game's 3D layer. Disc-normalized `galaxy_position`
 * coordinates project onto a front-facing hemisphere so all systems are
 * visible at once with normal globe rotation.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { inferWorldId } from '@borderfall/shared';
import { REGION_CSS_COLORS } from '../../constants/regionColors';
import type { GameState } from '../../store/gameStore';

export interface GalaxyMapDatum {
  map_id?: string;
  map_kind?: 'standard' | 'galaxy';
  territories: Array<{
    territory_id: string;
    name: string;
    region_id: string;
    world_id?: string;
    globe_id?: string;
    galaxy_position?: [number, number];
  }>;
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit' }>;
  regions?: Array<{ region_id: string; name: string; bonus: number }>;
  worlds?: Array<{
    world_id: string;
    display_name: string;
  }>;
}

const STAR_BACKDROP_URL =
  'https://cdn.jsdelivr.net/npm/three-globe@2.45.1/example/img/night-sky.png';

/** Lat/lng range on the globe that the disc-norm coords project onto. */
const PROJECTION_LAT_HALF_RANGE = 55;
const PROJECTION_LNG_HALF_RANGE = 70;

function regionColor(regionIndex: Map<string, number>, regionId: string): string {
  const idx = regionIndex.get(regionId) ?? 0;
  return REGION_CSS_COLORS[idx % REGION_CSS_COLORS.length]!;
}

function fallbackGalaxyXY(
  territoryId: string,
  regionId: string,
  regionIndex: Map<string, number>,
): [number, number] {
  let h = 0;
  for (let i = 0; i < territoryId.length; i++) {
    h = (h * 31 + territoryId.charCodeAt(i)) >>> 0;
  }
  const ring = regionIndex.get(regionId) ?? 0;
  const maxRing = Math.max(1, regionIndex.size - 1);
  const angle = (h % 360) * (Math.PI / 180);
  const rNorm = 0.12 + (ring / maxRing) * 0.38;
  return [0.5 + rNorm * Math.cos(angle), 0.5 + rNorm * Math.sin(angle)];
}

/**
 * Project disc-norm `galaxy_position` (∈ [0,1]^2, origin top-left) onto
 * spherical lat/lng centered on the camera. The constant ranges keep the
 * full chart inside the visible front-face of the globe at standard altitude.
 */
function discToLatLng(gx: number, gy: number): { lat: number; lng: number } {
  const lng = (gx - 0.5) * 2 * PROJECTION_LNG_HALF_RANGE;
  const lat = -(gy - 0.5) * 2 * PROJECTION_LAT_HALF_RANGE;
  return { lat, lng };
}

export interface GalaxyStrategicViewProps {
  mapData: GalaxyMapDatum;
  gameState: GameState | null;
  selectedTerritoryId: string | null;
  onTerritoryClick: (territoryId: string) => void;
  /** Second click in a double-click opens drilled globe view for that territory’s world */
  onTerritoryDoubleClick?: (territoryId: string) => void;
  width: number;
  height: number;
  /**
   * When false, orbit-typed lanes render dim/red to communicate that the
   * active player has not satisfied the orbit-access gate. Backend remains
   * authoritative for the actual claim/attack rejection.
   */
  orbitAccessAllowed?: boolean;
  /** Pulse the world node when a map action occurs on that world. */
  pulseWorldId?: string | null;
  pulseKey?: number;
  pulseLabel?: string | null;
}

interface PointDatum {
  territory_id: string;
  name: string;
  region_id: string;
  world_id: string;
  lat: number;
  lng: number;
  color: string;
  size: number;
  altitude: number;
}

interface ArcDatum {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string | string[];
  altitude: number;
  stroke: number;
  isOrbit: boolean;
}

interface LabelDatum {
  lat: number;
  lng: number;
  text: string;
  color: string;
  size: number;
}

export default function GalaxyStrategicView({
  mapData,
  gameState,
  selectedTerritoryId,
  onTerritoryClick,
  onTerritoryDoubleClick,
  width,
  height,
  orbitAccessAllowed = true,
  pulseWorldId = null,
  pulseKey = 0,
  pulseLabel = null,
}: GalaxyStrategicViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [pulsePhase, setPulsePhase] = useState(0);

  const regions = mapData.regions ?? [];

  const regionIndex = useMemo(() => {
    const m = new Map<string, number>();
    regions.forEach((r, i) => m.set(r.region_id, i));
    return m;
  }, [regions]);

  const ownerColor = useCallback(
    (territoryId: string): string | null => {
      const owner = gameState?.territories[territoryId]?.owner_id ?? null;
      if (!owner) return null;
      const p = gameState?.players.find((pl) => pl.player_id === owner);
      return p?.color ?? '#888888';
    },
    [gameState],
  );

  const layout = useMemo(() => {
    type Row = {
      territory_id: string;
      name: string;
      region_id: string;
      world_id: string;
      gx: number;
      gy: number;
    };
    const rows: Row[] = mapData.territories.map((t) => {
      const wid = inferWorldId(t);
      const pos =
        t.galaxy_position && t.galaxy_position.length >= 2
          ? ([t.galaxy_position[0], t.galaxy_position[1]] as [number, number])
          : fallbackGalaxyXY(t.territory_id, t.region_id, regionIndex);
      return {
        territory_id: t.territory_id,
        name: t.name,
        region_id: t.region_id,
        world_id: wid,
        gx: pos[0],
        gy: pos[1],
      };
    });

    // Authored galaxy_position clusters ~6 territories per world in a tight
    // disc patch; projected onto the chart globe they overlap and read as one
    // “owned sphere”. Fan each world’s members on a small ring around their
    // centroid so every territory stays a distinct target in overview.
    const byWorld = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byWorld.get(r.world_id) ?? [];
      list.push(r);
      byWorld.set(r.world_id, list);
    }
    const worldRingBias = (worldId: string): number => {
      let h = 2166136261;
      for (let i = 0; i < worldId.length; i++) {
        h = Math.imul(h ^ worldId.charCodeAt(i), 16777619);
      }
      return ((h >>> 0) % 6283) / 1000;
    };

    return rows.map((r) => {
      const group = byWorld.get(r.world_id);
      let gx = r.gx;
      let gy = r.gy;
      if (group && group.length > 1) {
        let sx = 0;
        let sy = 0;
        for (const g of group) {
          sx += g.gx;
          sy += g.gy;
        }
        const cx = sx / group.length;
        const cy = sy / group.length;
        const idx = group.findIndex((x) => x.territory_id === r.territory_id);
        const n = group.length;
        const angle = (idx / n) * Math.PI * 2 + worldRingBias(r.world_id);
        const ringR = 0.024;
        const tgx = cx + ringR * Math.cos(angle);
        const tgy = cy + ringR * Math.sin(angle);
        gx = r.gx * 0.35 + tgx * 0.65;
        gy = r.gy * 0.35 + tgy * 0.65;
      }
      const { lat, lng } = discToLatLng(gx, gy);
      return {
        territory_id: r.territory_id,
        name: r.name,
        region_id: r.region_id,
        world_id: r.world_id,
        lat,
        lng,
      };
    });
  }, [mapData.territories, regionIndex]);

  const layoutById = useMemo(() => {
    const m = new Map<string, (typeof layout)[number]>();
    for (const p of layout) m.set(p.territory_id, p);
    return m;
  }, [layout]);

  const points = useMemo<PointDatum[]>(() => {
    return layout.map((p) => {
      const oc = ownerColor(p.territory_id);
      const base = regionColor(regionIndex, p.region_id);
      const isSelected = selectedTerritoryId === p.territory_id;
      const isPulsing = pulseWorldId && p.world_id === pulseWorldId && pulsePhase > 0;
      const pulseBoost = isPulsing ? 0.4 + 0.6 * Math.abs(Math.sin(pulsePhase * 0.25)) : 0;
      const baseSize = isSelected ? 0.55 : 0.4;
      return {
        territory_id: p.territory_id,
        name: p.name,
        region_id: p.region_id,
        world_id: p.world_id,
        lat: p.lat,
        lng: p.lng,
        color: oc ?? base,
        size: baseSize * (1 + pulseBoost * 0.85),
        altitude: isSelected ? 0.06 : 0.04 + pulseBoost * 0.03,
      };
    });
  }, [layout, ownerColor, regionIndex, selectedTerritoryId, pulseWorldId, pulsePhase]);

  const arcs = useMemo<ArcDatum[]>(() => {
    const out: ArcDatum[] = [];
    for (const c of mapData.connections) {
      const a = layoutById.get(c.from);
      const b = layoutById.get(c.to);
      if (!a || !b) continue;
      const isOrbit = c.type === 'orbit';
      const orbitColor = orbitAccessAllowed
        ? ['rgba(120, 200, 255, 0.85)', 'rgba(180, 220, 255, 0.95)']
        : ['rgba(255, 110, 110, 0.55)', 'rgba(255, 150, 150, 0.65)'];
      const landColor = 'rgba(255, 255, 255, 0.32)';
      out.push({
        startLat: a.lat,
        startLng: a.lng,
        endLat: b.lat,
        endLng: b.lng,
        color: isOrbit ? orbitColor : landColor,
        altitude: isOrbit ? 0.18 : 0.04,
        stroke: isOrbit ? 0.55 : 0.35,
        isOrbit,
      });
    }
    return out;
  }, [mapData.connections, layoutById, orbitAccessAllowed]);

  const worldLabels = useMemo<LabelDatum[]>(() => {
    if (!mapData.worlds || mapData.worlds.length === 0) return [];
    // Anchor each world's label at the centroid of its territories so labels
    // float above the cluster instead of sharing a single coordinate.
    const byWorld = new Map<string, { latSum: number; lngSum: number; count: number; display: string }>();
    for (const w of mapData.worlds) {
      byWorld.set(w.world_id, { latSum: 0, lngSum: 0, count: 0, display: w.display_name });
    }
    for (const p of layout) {
      const entry = byWorld.get(p.world_id);
      if (!entry) continue;
      entry.latSum += p.lat;
      entry.lngSum += p.lng;
      entry.count += 1;
    }
    const labels: LabelDatum[] = [];
    for (const [, entry] of byWorld) {
      if (entry.count === 0) continue;
      labels.push({
        lat: entry.latSum / entry.count + 6,
        lng: entry.lngSum / entry.count,
        text: entry.display,
        color: 'rgba(220, 230, 250, 0.92)',
        size: 1.4,
      });
    }
    return labels;
  }, [mapData.worlds, layout]);

  // Initial framing: lock to chart centroid (0,0) at a wider altitude than
  // the per-world globe so the whole disc fits in view.
  useEffect(() => {
    if (!ready || !globeRef.current) return;
    globeRef.current.pointOfView({ lat: 0, lng: 0, altitude: 2.4 }, 600);
    const ctrl = globeRef.current.controls();
    if (ctrl) {
      ctrl.autoRotate = false;
      ctrl.enableZoom = true;
    }
  }, [ready]);

  useEffect(() => {
    if (!pulseWorldId || !pulseKey) {
      setPulsePhase(0);
      return;
    }
    let frame = 0;
    const iv = window.setInterval(() => {
      frame += 1;
      setPulsePhase(frame);
      if (frame > 42) window.clearInterval(iv);
    }, 48);
    return () => window.clearInterval(iv);
  }, [pulseWorldId, pulseKey]);

  const handlePointClick = useCallback(
    (pt: object, ev: MouseEvent) => {
      const p = pt as PointDatum;
      if (!p?.territory_id) return;
      if (ev.detail >= 2 && onTerritoryDoubleClick) {
        onTerritoryDoubleClick(p.territory_id);
        return;
      }
      if (ev.detail === 1) onTerritoryClick(p.territory_id);
    },
    [onTerritoryClick, onTerritoryDoubleClick],
  );

  return (
    <div
      className="relative"
      style={{ width, height, background: 'rgb(5, 7, 16)' }}
    >
      {pulseLabel && pulsePhase > 0 && (
        <div
          className="absolute top-4 left-1/2 z-20 -translate-x-1/2 pointer-events-none px-3 py-1.5 rounded-lg border border-bf-gold/30 bg-black/55 text-bf-gold text-xs font-medium"
          role="status"
        >
          {pulseLabel}
        </div>
      )}
      <Globe
        ref={globeRef}
        width={width}
        height={height}
        animateIn={false}
        backgroundColor="rgb(5, 7, 16)"
        globeImageUrl={STAR_BACKDROP_URL}
        showAtmosphere={true}
        atmosphereColor="rgba(120, 140, 220, 0.5)"
        atmosphereAltitude={0.18}
        pointsData={points}
        pointLat={(d: object) => (d as PointDatum).lat}
        pointLng={(d: object) => (d as PointDatum).lng}
        pointColor={(d: object) => (d as PointDatum).color}
        pointAltitude={(d: object) => (d as PointDatum).altitude}
        pointRadius={(d: object) => (d as PointDatum).size}
        pointResolution={6}
        onPointClick={handlePointClick}
        arcsData={arcs}
        arcStartLat={(d: object) => (d as ArcDatum).startLat}
        arcStartLng={(d: object) => (d as ArcDatum).startLng}
        arcEndLat={(d: object) => (d as ArcDatum).endLat}
        arcEndLng={(d: object) => (d as ArcDatum).endLng}
        arcColor={(d: object) => (d as ArcDatum).color}
        arcAltitude={(d: object) => (d as ArcDatum).altitude}
        arcStroke={(d: object) => (d as ArcDatum).stroke}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={(d: object) => ((d as ArcDatum).isOrbit ? 4000 : 0)}
        labelsData={worldLabels}
        labelLat={(d: object) => (d as LabelDatum).lat}
        labelLng={(d: object) => (d as LabelDatum).lng}
        labelText={(d: object) => (d as LabelDatum).text}
        labelColor={(d: object) => (d as LabelDatum).color}
        labelSize={(d: object) => (d as LabelDatum).size}
        labelDotRadius={0}
        labelAltitude={0.07}
        onGlobeReady={() => setReady(true)}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 px-2 py-1 rounded bg-black/55 border border-bf-border/70 text-bf-muted text-[11px]">
        Galaxy chart · drag to rotate · scroll to zoom · click to select · double-click to open globe · world tabs also drill in
        {!orbitAccessAllowed && (
          <span className="ml-2 text-amber-300">· red lanes locked (need Hyperspace Chart)</span>
        )}
      </div>
    </div>
  );
}
