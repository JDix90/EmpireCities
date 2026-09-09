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
 * Lanes are the era's board, so every PHYSICAL lane is drawn (two per world
 * pair on the shipped map, fanned apart), coloured by what it is to the viewer
 * under corridors: a corridor (they hold both gateways, their colour), open
 * (they hold one end, blue), closed (neither, dim) or sealed (an Emergency Seal,
 * orange). Each lane's end dots carry the gateway owners' colours and its
 * tooltip names the owners, the seal and its rounds left. The rules come from
 * `utils/galaxyLanes.ts`, the client mirror of the backend.
 *
 * Interaction: single-click a world for its ownership breakdown; double-click
 * (or "Enter world") drills into that world's globe. A Void Custodian clicks a
 * lane touching Nexus Station to seal it for a round.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { inferWorldId } from '@borderfall/shared';
import { getGalaxyWorldLore } from '../../constants/galaxyLore';
import type { GameState } from '../../store/gameStore';
import {
  EMERGENCY_SEAL_WORLD_ID,
  describeLaneDice,
  describeLaneSeal,
  describeLaneState,
  laneAttackDiceCap,
  laneSealFor,
  laneStateFor,
  orbitLaneId,
  type LaneSeal,
  type LaneState,
} from '../../utils/galaxyLanes';
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
   * has not satisfied the orbit-access gate (corridors kill switch off). Backend
   * stays authoritative for the actual claim/attack rejection.
   */
  orbitAccessAllowed?: boolean;
  /**
   * The viewing player. Lane states (corridor / open / closed) are read from
   * their gateways. Falls back to whoever `ownsTerritory` reports as the owner.
   */
  viewerPlayerId?: string | null;
  /** Ids of currently-sealed orbit lanes; used only when `gameState` carries no `lane_blockades`. */
  sealedLaneIds?: Set<string>;
  /** Whether the viewer may fire an Emergency Seal (enables click-to-seal on Nexus lanes). */
  lanesContestableEnabled?: boolean;
  /** The viewer holds the Vault: their seal closes ANY lane, not only Nexus's. */
  sealAnyLane?: boolean;
  /** True when the active player owns the given territory. */
  ownsTerritory?: (territoryId: string) => boolean;
  /** Seal the orbit lane between two territories. */
  onSealLane?: (fromId: string, toId: string) => void;
  /** Pulse the world node when a map action occurs on that world. */
  pulseWorldId?: string | null;
  pulseKey?: number;
  pulseLabel?: string | null;
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

export const LANE_COLORS = {
  open: 'rgba(120, 200, 255, 0.78)',
  closed: 'rgba(150, 160, 180, 0.32)',
  sealed: 'rgba(255, 120, 60, 0.95)',
  gated: 'rgba(255, 110, 110, 0.5)',
} as const;

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

interface LaneRender {
  key: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  state: LaneState;
  seal: LaneSeal | null;
  /** The viewer is blocked by the seal (sealed by someone else). */
  sealedAgainstViewer: boolean;
  fromColor: string;
  toColor: string;
  stroke: string;
  strokeWidth: number;
  dash: string;
  flow: boolean;
  canSeal: boolean;
  tooltip: string;
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
  viewerPlayerId: viewerPlayerIdProp,
  sealedLaneIds,
  lanesContestableEnabled = false,
  sealAnyLane = false,
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

  const territoryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mapData.territories) m.set(t.territory_id, t.name);
    return (tid: string): string => m.get(tid) ?? tid;
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

  // The viewer: the explicit prop, else the owner of any territory
  // `ownsTerritory` reports as theirs.
  const viewerPlayerId = useMemo(() => {
    if (viewerPlayerIdProp) return viewerPlayerIdProp;
    if (!ownsTerritory) return null;
    for (const t of mapData.territories) {
      if (ownsTerritory(t.territory_id)) return ownerOf(t.territory_id);
    }
    return null;
  }, [viewerPlayerIdProp, ownsTerritory, mapData.territories, ownerOf]);

  const viewerColor = useMemo(
    () => (viewerPlayerId ? playerInfo(viewerPlayerId)?.color ?? GOLD : GOLD),
    [viewerPlayerId, playerInfo],
  );

  const viewerLaneDice = useMemo(
    () => (gameState ? laneAttackDiceCap(gameState, viewerPlayerId) : undefined),
    [gameState, viewerPlayerId],
  );

  const sealFor = useCallback(
    (from: string, to: string): LaneSeal | null => {
      if (gameState?.lane_blockades) return laneSealFor(gameState, from, to);
      return sealedLaneIds?.has(orbitLaneId(from, to)) ? { owner_id: '', turns_remaining: 1 } : null;
    },
    [gameState, sealedLaneIds],
  );

  const laneRender = useMemo((): LaneRender[] => {
    const trim = sizing.donutR + sizing.donutWidth / 2 + 3;
    const gap = clamp(sizing.donutR * 0.45, 8, 16);
    const ownerName = (pid: string | null): string =>
      pid ? (pid === viewerPlayerId ? 'you' : playerInfo(pid)?.name ?? pid) : 'neutral';
    const ownerColor = (pid: string | null): string =>
      pid ? playerInfo(pid)?.color ?? NEUTRAL_COLOR : NEUTRAL_COLOR;
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
      // Fan the physical lanes apart along the perpendicular so each reads.
      const nx = -uy;
      const ny = ux;
      const count = lane.underlying.length;
      return lane.underlying.map((u, i) => {
        // Orient every lane from world `a` to world `b` so the end dots line up.
        const [from, to] = worldOf(u.from) === lane.a ? [u.from, u.to] : [u.to, u.from];
        const off = (i - (count - 1) / 2) * gap;
        const state: LaneState = gameState ? laneStateFor(gameState, from, to, viewerPlayerId) : 'closed';
        const seal = sealFor(from, to);
        const sealedAgainstViewer = !!seal && seal.owner_id !== viewerPlayerId;
        const fromOwner = ownerOf(from);
        const toOwner = ownerOf(to);
        const touchesSealWorld = worldOf(from) === EMERGENCY_SEAL_WORLD_ID || worldOf(to) === EMERGENCY_SEAL_WORLD_ID;
        const canSeal = lanesContestableEnabled && !!onSealLane && !seal && (sealAnyLane || touchesSealWorld);

        let stroke: string;
        let strokeWidth: number;
        let dash: string;
        let flow = false;
        if (seal) {
          stroke = LANE_COLORS.sealed;
          strokeWidth = 2.6;
          dash = '4 4';
        } else if (!orbitAccessAllowed) {
          stroke = LANE_COLORS.gated;
          strokeWidth = 1.7;
          dash = '3 6';
        } else if (state === 'corridor') {
          stroke = viewerColor;
          strokeWidth = 2.4;
          dash = '11 4';
          flow = true;
        } else if (state === 'open') {
          stroke = LANE_COLORS.open;
          strokeWidth = 1.8;
          dash = '7 6';
          flow = true;
        } else {
          stroke = LANE_COLORS.closed;
          strokeWidth = 1.2;
          dash = '2 5';
        }

        const lines = [
          `${territoryName(from)} ↔ ${territoryName(to)}`,
          gameState && viewerPlayerId ? describeLaneState(state) : 'Hyperspace lane',
          `${territoryName(from)}: ${ownerName(fromOwner)} · ${territoryName(to)}: ${ownerName(toOwner)}`,
        ];
        const sealLine = describeLaneSeal(seal, (pid) => playerInfo(pid)?.name ?? 'a rival', viewerPlayerId);
        if (sealLine) lines.push(sealLine);
        const dice = describeLaneDice(viewerLaneDice);
        if (dice && state !== 'closed') lines.push(dice);
        if (!orbitAccessAllowed) lines.push('Locked — research Lane Charts to cross');
        if (canSeal) lines.push('Click to fire an Emergency Seal (1 round)');

        return {
          key: orbitLaneId(from, to),
          from,
          to,
          x1: pa.px + ux * trim + nx * off,
          y1: pa.py + uy * trim + ny * off,
          x2: pb.px - ux * trim + nx * off,
          y2: pb.py - uy * trim + ny * off,
          state,
          seal,
          sealedAgainstViewer,
          fromColor: ownerColor(fromOwner),
          toColor: ownerColor(toOwner),
          stroke,
          strokeWidth,
          dash,
          flow,
          canSeal,
          tooltip: lines.join('\n'),
        };
      });
    });
  }, [
    worldLanes, placeById, sizing.donutR, sizing.donutWidth, gameState, viewerPlayerId, viewerColor,
    viewerLaneDice, sealFor, ownerOf, worldOf, playerInfo, territoryName, orbitAccessAllowed,
    lanesContestableEnabled, sealAnyLane, onSealLane,
  ]);

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

  /** Gateways on the selected world: how many, and how many the viewer holds. */
  const selectedGateways = useMemo(() => {
    if (!selectedNode) return null;
    const ids = new Set<string>();
    for (const lane of worldLanes) {
      if (lane.a !== selectedNode.world_id && lane.b !== selectedNode.world_id) continue;
      for (const u of lane.underlying) {
        if (worldOf(u.from) === selectedNode.world_id) ids.add(u.from);
        if (worldOf(u.to) === selectedNode.world_id) ids.add(u.to);
      }
    }
    const mine = viewerPlayerId ? [...ids].filter((id) => ownerOf(id) === viewerPlayerId).length : 0;
    return { total: ids.size, mine };
  }, [selectedNode, worldLanes, worldOf, ownerOf, viewerPlayerId]);

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
  const showLaneLegend = !!gameState && !!viewerPlayerId && orbitAccessAllowed;

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
        .bf-lane:hover .bf-lane-line { filter: brightness(1.35); }
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

        {/* Hyperspace lanes (drawn under the worlds), one per physical lane */}
        {laneRender.map((l) => (
          <g
            key={`lane-${l.key}`}
            className="bf-lane"
            data-lane-id={l.key}
            data-lane-state={l.state}
            data-lane-sealed={l.seal ? 'true' : 'false'}
          >
            <title>{l.tooltip}</title>
            {/* wide invisible hit target for easier sealing */}
            <line
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="transparent"
              strokeWidth={14}
              style={{ cursor: l.canSeal ? 'pointer' : 'default' }}
              onClick={(e) => {
                e.stopPropagation();
                if (l.canSeal && onSealLane) onSealLane(l.from, l.to);
              }}
            />
            <line
              className={`bf-lane-line${l.flow ? ' bf-lane-flow' : ''}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke={l.stroke}
              strokeWidth={l.strokeWidth}
              strokeLinecap="round"
              strokeDasharray={l.dash}
              pointerEvents="none"
            />
            {/* Gateway owner dots at each end */}
            <circle cx={l.x1} cy={l.y1} r={3} fill={l.fromColor} stroke="rgba(0,0,0,0.6)" strokeWidth={0.8} pointerEvents="none" />
            <circle cx={l.x2} cy={l.y2} r={3} fill={l.toColor} stroke="rgba(0,0,0,0.6)" strokeWidth={0.8} pointerEvents="none" />
          </g>
        ))}

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

      {/* Player legend + lane legend */}
      {(legendPlayers.length > 0 || showLaneLegend) && (
        <div className="pointer-events-none absolute top-3 left-3 max-w-[45%] px-2.5 py-2 rounded-lg bg-black/45 border border-bf-border/60">
          {legendPlayers.length > 0 && (
            <>
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
            </>
          )}
          {showLaneLegend && (
            <div className="mt-1.5 pt-1.5 border-t border-bf-border/40" data-testid="lane-legend">
              <div className="text-[10px] uppercase tracking-wide text-bf-muted mb-1">Lanes</div>
              <div className="flex flex-col gap-0.5 text-[10px] text-bf-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2" style={{ borderColor: viewerColor }} />
                  Corridor · both gateways yours
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: LANE_COLORS.open }} />
                  Open · you hold one end
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t border-dotted" style={{ borderColor: 'rgba(150,160,180,0.7)' }} />
                  Closed · take a gateway first
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: LANE_COLORS.sealed }} />
                  Sealed · Emergency Seal, 1 round
                </span>
              </div>
            </div>
          )}
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
          {selectedGateways && selectedGateways.total > 0 && (
            <div className="mt-2 text-[11px] text-bf-muted" data-testid="world-gateways">
              🛰 Gateways: {viewerPlayerId ? `you hold ${selectedGateways.mine} of ${selectedGateways.total}` : selectedGateways.total}
            </div>
          )}
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
          <span className="ml-2 text-amber-300">· red lanes locked (need Lane Charts)</span>
        )}
        {lanesContestableEnabled && (
          <span className="ml-2 text-orange-300">
            {sealAnyLane
              ? '· you hold the Vault: click any lane to seal it for a round'
              : '· click a lane touching Nexus Station to seal it for a round'}
          </span>
        )}
      </div>
    </div>
  );
}
