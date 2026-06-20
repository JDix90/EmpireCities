/**
 * Galactic Age — galaxy strategic overview.
 *
 * Collapses the whole galaxy into ONE node per world (Sol III, Verdan Reach,
 * Rust Belt, Nexus Station, …). Each world is a planet ringed by an ownership
 * donut whose colored arcs are each player's share of that world, wired together
 * by hyperspace lanes. This replaces the old per-territory node cloud, which got
 * crowded and unreadable; act on individual systems by drilling into a world.
 *
 * Rendered as flat SVG (no WebGL) so it stays legible and cheap regardless of
 * how many worlds the galaxy grows to — positions come from each world's
 * authored `galaxy_position` centroid, scaled + de-clumped to fit the viewport,
 * with node/label sizes that shrink as worlds multiply. The math lives in
 * `galaxyStrategicLayout.ts` (unit-tested); this file is the rendering shell.
 *
 * Interaction: single-click a world for its ownership breakdown; double-click
 * (or "Enter world") drills into that world's globe. Orbit lanes show open
 * (blue) / locked (red, needs Hyperspace Chart) / sealed (orange); click a lane
 * you border to seal it when the contestable-lanes mechanic is on.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { inferWorldId } from '@borderfall/shared';
import { getGalaxyWorldLore } from '../../constants/galaxyLore';
import type { GameState } from '../../store/gameStore';
import {
  aggregateOrbitLanes,
  buildWorldNodes,
  clamp,
  fitToViewport,
  nodeSizing,
  relaxPlacements,
  type Placement,
  type WorldNode,
} from './galaxyStrategicLayout';

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

export interface GalaxyStrategicViewProps {
  mapData: GalaxyMapDatum;
  gameState: GameState | null;
  selectedTerritoryId: string | null;
  onTerritoryClick: (territoryId: string) => void;
  /** Drill into the world's globe view (double-click a world, or "Enter world"). */
  onTerritoryDoubleClick?: (territoryId: string) => void;
  width: number;
  height: number;
  /**
   * When false, orbit lanes render dim red to communicate that the active player
   * has not satisfied the orbit-access gate. Backend stays authoritative for the
   * actual claim/attack rejection.
   */
  orbitAccessAllowed?: boolean;
  /** Galaxy contestable lanes: ids of currently-sealed orbit lanes (from gameState.lane_blockades). */
  sealedLaneIds?: Set<string>;
  /** Whether the lane-seal mechanic is on (enables click-to-seal). */
  lanesContestableEnabled?: boolean;
  /** True when the active player owns the given territory (used to allow sealing a lane you border). */
  ownsTerritory?: (territoryId: string) => boolean;
  /** Seal the orbit lane between two territories (the active player must hold an endpoint). */
  onSealLane?: (fromId: string, toId: string) => void;
  /** Pulse the world node when a map action occurs on that world. */
  pulseWorldId?: string | null;
  pulseKey?: number;
  pulseLabel?: string | null;
}

/** Canonical, order-independent lane id — must match the backend `orbitLaneId`. */
function laneKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/** Deterministic, muted planet-body color per world (scales to any world id). */
function worldBodyColor(worldId: string): string {
  let h = 2166136261;
  for (let i = 0; i < worldId.length; i++) h = Math.imul(h ^ worldId.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 34%, 28%)`;
}

/** Tiny deterministic PRNG so the starfield is stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLD = '#e6b34d';
const NEUTRAL_COLOR = 'rgba(150, 160, 180, 0.5)';

interface DonutSegment {
  color: string;
  len: number;
  offset: number;
}

/** Build cumulative donut arc segments (owners first, then a neutral remainder). */
function donutSegments(node: WorldNode, circumference: number): DonutSegment[] {
  const segs: DonutSegment[] = [];
  let acc = 0;
  for (const slice of node.ownership) {
    const len = slice.share * circumference;
    segs.push({ color: slice.color, len, offset: -acc });
    acc += len;
  }
  if (node.neutral_share > 0.0001) {
    const len = node.neutral_share * circumference;
    segs.push({ color: NEUTRAL_COLOR, len, offset: -acc });
  }
  return segs;
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
  sealedLaneIds,
  lanesContestableEnabled = false,
  ownsTerritory,
  onSealLane,
  pulseWorldId = null,
  pulseKey = 0,
  pulseLabel = null,
}: GalaxyStrategicViewProps) {
  const [pulsePhase, setPulsePhase] = useState(0);
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);

  const worldOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mapData.territories) m.set(t.territory_id, inferWorldId(t));
    return (tid: string): string | null => m.get(tid) ?? null;
  }, [mapData.territories]);

  const ownerOf = useCallback(
    (tid: string): string | null => gameState?.territories[tid]?.owner_id ?? null,
    [gameState],
  );
  const playerInfo = useCallback(
    (pid: string) => {
      const p = gameState?.players.find((pl) => pl.player_id === pid);
      return p ? { color: p.color, name: p.username } : null;
    },
    [gameState],
  );
  const displayNameOf = useCallback(
    (wid: string): string => {
      const w = mapData.worlds?.find((x) => x.world_id === wid);
      if (w?.display_name) return w.display_name;
      return getGalaxyWorldLore(wid)?.display_name ?? wid;
    },
    [mapData.worlds],
  );

  const nodes = useMemo(
    () => buildWorldNodes(mapData.territories, { ownerOf, playerInfo, displayNameOf }),
    [mapData.territories, ownerOf, playerInfo, displayNameOf],
  );

  const sizing = useMemo(() => nodeSizing(nodes.length, width, height), [nodes.length, width, height]);
  const pad = useMemo(
    () => sizing.donutR * 1.4 + sizing.fontSize * 2.4 + 12,
    [sizing.donutR, sizing.fontSize],
  );

  const placeById = useMemo(() => {
    const raw = fitToViewport(nodes, width, height, pad);
    const relaxed = relaxPlacements(raw, sizing.donutR * 2.3 + 10, width, height, pad, 90);
    const m = new Map<string, Placement>();
    for (const p of relaxed) m.set(p.world_id, p);
    return m;
  }, [nodes, width, height, pad, sizing.donutR]);

  const worldLanes = useMemo(
    () => aggregateOrbitLanes(mapData.connections, worldOf),
    [mapData.connections, worldOf],
  );

  const laneRender = useMemo(() => {
    const trim = sizing.donutR + sizing.donutWidth / 2 + 3;
    return worldLanes.flatMap((lane) => {
      const pa = placeById.get(lane.a);
      const pb = placeById.get(lane.b);
      if (!pa || !pb) return [];
      const dx = pb.px - pa.px;
      const dy = pb.py - pa.py;
      const len = Math.hypot(dx, dy) || 1;
      if (len <= 2 * trim + 6) return []; // worlds too close — skip the stub
      const ux = dx / len;
      const uy = dy / len;
      const sealed = lane.underlying.some((u) => sealedLaneIds?.has(laneKey(u.from, u.to)));
      const sealable = lane.underlying.find(
        (u) =>
          !!ownsTerritory &&
          (ownsTerritory(u.from) || ownsTerritory(u.to)) &&
          !sealedLaneIds?.has(laneKey(u.from, u.to)),
      );
      return [
        {
          key: `${lane.a}::${lane.b}`,
          x1: pa.px + ux * trim,
          y1: pa.py + uy * trim,
          x2: pb.px - ux * trim,
          y2: pb.py - uy * trim,
          sealed,
          sealable: sealable ?? null,
        },
      ];
    });
  }, [worldLanes, placeById, sizing.donutR, sizing.donutWidth, sealedLaneIds, ownsTerritory]);

  // The viewer is the owner of any territory `ownsTerritory` reports as theirs.
  const viewerPlayerId = useMemo(() => {
    if (!ownsTerritory) return null;
    for (const t of mapData.territories) {
      if (ownsTerritory(t.territory_id)) return ownerOf(t.territory_id);
    }
    return null;
  }, [ownsTerritory, mapData.territories, ownerOf]);

  const legendPlayers = useMemo(() => {
    const present = new Set<string>();
    for (const n of nodes) for (const s of n.ownership) present.add(s.player_id);
    return (gameState?.players ?? [])
      .filter((p) => present.has(p.player_id))
      .map((p) => ({ player_id: p.player_id, color: p.color, name: p.username }));
  }, [nodes, gameState]);

  // Ring highlight follows local selection OR an externally-selected territory's world.
  const highlightWorldId = useMemo(() => {
    if (selectedWorldId) return selectedWorldId;
    if (selectedTerritoryId) return worldOf(selectedTerritoryId);
    return null;
  }, [selectedWorldId, selectedTerritoryId, worldOf]);

  // The detail card is driven by LOCAL selection only, so its ✕ always closes it
  // even while an external selectedTerritoryId keeps a world ring-highlighted.
  const selectedNode = useMemo(
    () => nodes.find((n) => n.world_id === selectedWorldId) ?? null,
    [nodes, selectedWorldId],
  );

  const stars = useMemo(() => {
    const rng = mulberry32(0x9e3779b9);
    const count = clamp(Math.round((width * height) / 11000), 28, 120);
    return Array.from({ length: count }, () => ({
      x: rng() * width,
      y: rng() * height,
      r: 0.4 + rng() * 1.1,
      o: 0.2 + rng() * 0.5,
    }));
  }, [width, height]);

  // Pulse animation driver (event-driven; mirrors the prior globe behavior).
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

  const enterWorld = useCallback(
    (node: WorldNode) => {
      const rep = node.territory_ids[0];
      if (rep && onTerritoryDoubleClick) onTerritoryDoubleClick(rep);
    },
    [onTerritoryDoubleClick],
  );

  const handleNodeClick = useCallback(
    (node: WorldNode) => (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.detail >= 2) {
        enterWorld(node);
        return;
      }
      setSelectedWorldId(node.world_id);
      const rep = node.territory_ids[0];
      if (rep) onTerritoryClick(rep);
    },
    [enterWorld, onTerritoryClick],
  );

  const circumference = 2 * Math.PI * sizing.donutR;
  const pulseActive = pulsePhase > 0;
  const pulseT = pulsePhase % 14;

  return (
    <div
      className="relative"
      style={{ width, height, background: 'rgb(5, 7, 16)', overflow: 'hidden' }}
    >
      <style>{`
        @keyframes bf-lane-flow { to { stroke-dashoffset: -22; } }
        .bf-lane-flow { animation: bf-lane-flow 3s linear infinite; }
        .bf-world-node { cursor: pointer; }
        .bf-world-node circle.bf-body { transition: filter 120ms ease; }
        .bf-world-node:hover circle.bf-body { filter: brightness(1.25); }
        @media (prefers-reduced-motion: reduce) { .bf-lane-flow { animation: none; } }
      `}</style>

      {pulseLabel && pulseActive && (
        <div
          className="absolute top-4 left-1/2 z-20 -translate-x-1/2 pointer-events-none px-3 py-1.5 rounded-lg border border-bf-gold/30 bg-black/55 text-bf-gold text-xs font-medium"
          role="status"
        >
          {pulseLabel}
        </div>
      )}

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Galaxy strategic overview: worlds with per-player ownership"
        onClick={() => setSelectedWorldId(null)}
      >
        <title>Galaxy strategic overview</title>
        {/* Starfield */}
        {stars.map((s, i) => (
          <circle key={`star-${i}`} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={s.o} />
        ))}

        {/* Hyperspace lanes (drawn under the worlds) */}
        {laneRender.map((l) => {
          const stroke = l.sealed
            ? 'rgba(255, 120, 60, 0.95)'
            : orbitAccessAllowed
              ? 'rgba(120, 200, 255, 0.7)'
              : 'rgba(255, 110, 110, 0.5)';
          const canSeal = lanesContestableEnabled && !l.sealed && !!l.sealable && !!onSealLane;
          return (
            <g key={`lane-${l.key}`}>
              {/* wide invisible hit target for easier sealing */}
              <line
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: canSeal ? 'pointer' : 'default' }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canSeal && l.sealable && onSealLane) onSealLane(l.sealable.from, l.sealable.to);
                }}
              />
              <line
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke={stroke}
                strokeWidth={l.sealed ? 2.6 : 1.7}
                strokeLinecap="round"
                strokeDasharray={l.sealed ? '4 4' : orbitAccessAllowed ? '7 6' : '3 6'}
                className={!l.sealed && orbitAccessAllowed ? 'bf-lane-flow' : undefined}
                pointerEvents="none"
              />
            </g>
          );
        })}

        {/* World nodes */}
        {nodes.map((node) => {
          const p = placeById.get(node.world_id);
          if (!p) return null;
          const isSelected = highlightWorldId === node.world_id;
          const viewerLeads = !!viewerPlayerId && node.leader_player_id === viewerPlayerId;
          const isPulsing = pulseActive && pulseWorldId === node.world_id;
          const segs = donutSegments(node, circumference);
          const allNeutral = node.ownership.length === 0;
          return (
            <g
              key={`world-${node.world_id}`}
              className="bf-world-node"
              onClick={handleNodeClick(node)}
            >
              <title>
                {node.display_name} — {node.territory_count} systems
                {viewerLeads ? ' · you lead' : ''}
              </title>

              {/* Pulse ring (map action on this world) */}
              {isPulsing && (
                <circle
                  cx={p.px}
                  cy={p.py}
                  r={sizing.donutR + 6 + pulseT * 2.4}
                  fill="none"
                  stroke={GOLD}
                  strokeWidth={2}
                  opacity={Math.max(0, 0.55 - pulseT * 0.04)}
                />
              )}

              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={p.px}
                  cy={p.py}
                  r={sizing.donutR + sizing.donutWidth / 2 + 4}
                  fill="none"
                  stroke={GOLD}
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  opacity={0.95}
                />
              )}

              {/* Planet body (+ subtle lit highlight) */}
              <circle
                className="bf-body"
                cx={p.px}
                cy={p.py}
                r={sizing.bodyR}
                fill={worldBodyColor(node.world_id)}
                stroke={viewerLeads ? GOLD : 'rgba(255,255,255,0.12)'}
                strokeWidth={viewerLeads ? 1.5 : 1}
              />
              <circle
                cx={p.px - sizing.bodyR * 0.3}
                cy={p.py - sizing.bodyR * 0.3}
                r={sizing.bodyR * 0.55}
                fill="#ffffff"
                opacity={0.07}
                pointerEvents="none"
              />

              {/* Ownership donut */}
              {allNeutral ? (
                <circle
                  cx={p.px}
                  cy={p.py}
                  r={sizing.donutR}
                  fill="none"
                  stroke={NEUTRAL_COLOR}
                  strokeWidth={sizing.donutWidth}
                  pointerEvents="none"
                />
              ) : (
                segs.map((seg, si) => (
                  <circle
                    key={`seg-${node.world_id}-${si}`}
                    cx={p.px}
                    cy={p.py}
                    r={sizing.donutR}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={sizing.donutWidth}
                    strokeDasharray={`${seg.len} ${circumference - seg.len}`}
                    strokeDashoffset={seg.offset}
                    transform={`rotate(-90 ${p.px} ${p.py})`}
                    pointerEvents="none"
                  />
                ))
              )}

              {/* Labels */}
              <text
                x={p.px}
                y={p.py + sizing.donutR + sizing.fontSize + 6}
                textAnchor="middle"
                fontSize={sizing.fontSize}
                fontWeight={500}
                fill={viewerLeads ? GOLD : '#e3ebfa'}
                pointerEvents="none"
              >
                {node.display_name}
              </text>
              <text
                x={p.px}
                y={p.py + sizing.donutR + sizing.fontSize + sizing.subFontSize + 8}
                textAnchor="middle"
                fontSize={sizing.subFontSize}
                fill="#8fa1bd"
                pointerEvents="none"
              >
                {node.territory_count} systems
              </text>
            </g>
          );
        })}
      </svg>

      {/* Player legend */}
      {legendPlayers.length > 0 && (
        <div className="pointer-events-none absolute top-3 left-3 max-w-[45%] px-2.5 py-2 rounded-lg bg-black/45 border border-bf-border/60">
          <div className="text-[10px] uppercase tracking-wide text-bf-muted mb-1">Control</div>
          <div className="flex flex-col gap-1">
            {legendPlayers.map((pl) => (
              <div key={pl.player_id} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: pl.color }}
                />
                <span className="text-[11px] text-bf-text truncate">
                  {pl.player_id === viewerPlayerId ? 'You' : pl.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected world detail card */}
      {selectedNode && (
        <div className="absolute top-3 right-3 z-10 w-56 max-w-[60%] px-3 py-2.5 rounded-lg bg-black/70 border border-bf-border shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display text-bf-gold text-sm leading-tight">
                {selectedNode.display_name}
              </div>
              <div className="text-[11px] text-bf-muted">{selectedNode.territory_count} systems</div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedWorldId(null)}
              className="text-bf-muted hover:text-bf-text text-xs leading-none px-1"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {selectedNode.ownership.map((s) => (
              <div key={s.player_id} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: s.color }}
                />
                <span className="text-bf-text truncate flex-1">
                  {s.player_id === viewerPlayerId ? 'You' : s.name}
                </span>
                <span className="text-bf-muted tabular-nums">
                  {s.count} · {Math.round(s.share * 100)}%
                </span>
              </div>
            ))}
            {selectedNode.neutral_share > 0.0001 && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: NEUTRAL_COLOR }}
                />
                <span className="text-bf-muted truncate flex-1">Neutral</span>
                <span className="text-bf-muted tabular-nums">
                  {Math.round(selectedNode.neutral_share * 100)}%
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => enterWorld(selectedNode)}
            className="mt-2.5 w-full min-h-[34px] rounded border border-bf-gold/50 text-bf-gold text-xs hover:bg-bf-gold/10"
          >
            Enter world →
          </button>
        </div>
      )}

      {/* Footer hint */}
      <div className="pointer-events-none absolute bottom-3 left-3 px-2 py-1 rounded bg-black/55 border border-bf-border/70 text-bf-muted text-[11px]">
        Galaxy overview · click a world for details · double-click to enter · world tabs also drill in
        {!orbitAccessAllowed && (
          <span className="ml-2 text-amber-300">· red lanes locked (need Hyperspace Chart)</span>
        )}
        {lanesContestableEnabled && (
          <span className="ml-2 text-orange-300">· click a lane you border to seal it (orange = sealed)</span>
        )}
      </div>
    </div>
  );
}
