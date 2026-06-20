/**
 * Pure layout + ownership math for the Galactic Age strategic overview.
 *
 * The overview collapses every territory into ONE node per world (Sol III,
 * Verdan Reach, …) so the chart reads at a glance no matter how many worlds
 * the galaxy grows to. Nothing here is hardcoded to the initial four worlds:
 *   • node positions come from each world's authored `galaxy_position` centroid,
 *   • the caller scales those to fit any viewport (`fitToViewport`),
 *   • overlaps are relaxed apart (`relaxPlacements`) so clustered authoring still
 *     reads cleanly, and
 *   • node/donut/label sizes shrink with the world count (`nodeSizing`).
 *
 * Kept free of React + rendering so the math is unit-testable.
 */
import { inferWorldId, type MapTerritoryWorldLike } from '@borderfall/shared';

export interface GalaxyTerritoryLite extends MapTerritoryWorldLike {
  name?: string;
  galaxy_position?: [number, number];
}

export interface GalaxyConnectionLite {
  from: string;
  to: string;
  type: 'land' | 'sea' | 'orbit';
}

export interface OwnershipSlice {
  player_id: string;
  color: string;
  name: string;
  count: number;
  /** Fraction of the world's territories this player holds (0..1). */
  share: number;
}

export interface WorldNode {
  world_id: string;
  display_name: string;
  /** Normalized centroid in [0,1]^2 (origin top-left), from authored galaxy_position. */
  cx: number;
  cy: number;
  /** Sorted territory ids; index 0 is the drill-in representative. */
  territory_ids: string[];
  territory_count: number;
  /** Owner slices, descending by count then player_id. Excludes neutral. */
  ownership: OwnershipSlice[];
  /** Fraction of the world that is unowned (0..1). */
  neutral_share: number;
  /** Player holding the most territories (and more than are neutral), else null. */
  leader_player_id: string | null;
}

export interface WorldLane {
  /** world ids, sorted so (a,b) is order-independent. */
  a: string;
  b: string;
  /** Underlying territory orbit-connections this world-pair aggregates. */
  underlying: Array<{ from: string; to: string }>;
}

export interface BuildWorldNodesOptions {
  ownerOf: (territoryId: string) => string | null;
  playerInfo: (playerId: string) => { color: string; name: string } | null;
  displayNameOf: (worldId: string) => string;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic ring placement for a world with no authored galaxy_position. */
function fallbackCentroid(worldId: string): { cx: number; cy: number } {
  let h = 2166136261;
  for (let i = 0; i < worldId.length; i++) h = Math.imul(h ^ worldId.charCodeAt(i), 16777619);
  const angle = ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
  return { cx: 0.5 + 0.32 * Math.cos(angle), cy: 0.5 + 0.32 * Math.sin(angle) };
}

/** Collapse territories into one node per world, with per-player ownership shares. */
export function buildWorldNodes(
  territories: GalaxyTerritoryLite[],
  opts: BuildWorldNodesOptions,
): WorldNode[] {
  const groups = new Map<string, GalaxyTerritoryLite[]>();
  for (const t of territories) {
    const wid = inferWorldId(t);
    const list = groups.get(wid) ?? [];
    list.push(t);
    groups.set(wid, list);
  }

  const nodes: WorldNode[] = [];
  for (const [worldId, members] of groups) {
    // Centroid from authored galaxy_position (mean of members that carry one).
    let sx = 0;
    let sy = 0;
    let posCount = 0;
    for (const m of members) {
      if (m.galaxy_position && m.galaxy_position.length >= 2) {
        sx += m.galaxy_position[0]!;
        sy += m.galaxy_position[1]!;
        posCount += 1;
      }
    }
    const centroid = posCount > 0 ? { cx: sx / posCount, cy: sy / posCount } : fallbackCentroid(worldId);

    // Ownership tally.
    const tally = new Map<string, number>();
    let neutral = 0;
    for (const m of members) {
      const owner = opts.ownerOf(m.territory_id);
      if (!owner) {
        neutral += 1;
        continue;
      }
      tally.set(owner, (tally.get(owner) ?? 0) + 1);
    }
    const total = members.length || 1;
    const ownership: OwnershipSlice[] = [];
    for (const [pid, count] of tally) {
      const info = opts.playerInfo(pid);
      ownership.push({
        player_id: pid,
        color: info?.color ?? '#888888',
        name: info?.name ?? 'Unknown',
        count,
        share: count / total,
      });
    }
    ownership.sort((a, b) => b.count - a.count || (a.player_id < b.player_id ? -1 : 1));

    const topOwner = ownership[0] ?? null;
    const leader_player_id = topOwner && topOwner.count > neutral ? topOwner.player_id : null;

    nodes.push({
      world_id: worldId,
      display_name: opts.displayNameOf(worldId),
      cx: centroid.cx,
      cy: centroid.cy,
      territory_ids: members.map((m) => m.territory_id).sort(),
      territory_count: members.length,
      ownership,
      neutral_share: neutral / total,
      leader_player_id,
    });
  }

  // Stable order by world_id so render + tests are deterministic.
  nodes.sort((a, b) => (a.world_id < b.world_id ? -1 : a.world_id > b.world_id ? 1 : 0));
  return nodes;
}

export interface NodeSizing {
  /** Outer radius of the ownership donut. */
  donutR: number;
  /** Radius of the solid planet body inside the donut. */
  bodyR: number;
  donutWidth: number;
  fontSize: number;
  subFontSize: number;
}

/** Node + type sizes that shrink as the world count grows, clamped for legibility. */
export function nodeSizing(count: number, width: number, height: number): NodeSizing {
  const minDim = Math.max(1, Math.min(width, height));
  const n = Math.max(1, count);
  const donutR = clamp(minDim / (2.6 * Math.sqrt(n)), 20, 58);
  return {
    donutR,
    bodyR: donutR * 0.6,
    donutWidth: Math.max(5, donutR * 0.2),
    fontSize: clamp(donutR * 0.42, 11, 16),
    subFontSize: clamp(donutR * 0.34, 10, 13),
  };
}

export interface Placement {
  world_id: string;
  px: number;
  py: number;
}

/** Linear scale of normalized centroids into the padded viewport. */
export function fitToViewport(
  nodes: Array<Pick<WorldNode, 'world_id' | 'cx' | 'cy'>>,
  width: number,
  height: number,
  pad: number,
): Placement[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{ world_id: nodes[0]!.world_id, px: width / 2, py: height / 2 }];
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.cx);
    maxX = Math.max(maxX, n.cx);
    minY = Math.min(minY, n.cy);
    maxY = Math.max(maxY, n.cy);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const innerW = Math.max(1, width - 2 * pad);
  const innerH = Math.max(1, height - 2 * pad);
  return nodes.map((n) => {
    const fx = spanX > 1e-6 ? (n.cx - minX) / spanX : 0.5;
    const fy = spanY > 1e-6 ? (n.cy - minY) / spanY : 0.5;
    return { world_id: n.world_id, px: pad + fx * innerW, py: pad + fy * innerH };
  });
}

/**
 * Push placements apart until no two centers are closer than `minDist`, clamped
 * into the padded viewport. Deterministic (no RNG): coincident points are nudged
 * by a stable index-derived angle. Best-effort — if the viewport can't fit every
 * node at `minDist`, it converges to the least-overlapping arrangement it can.
 */
export function relaxPlacements(
  placements: Placement[],
  minDist: number,
  width: number,
  height: number,
  pad: number,
  iterations = 80,
): Placement[] {
  const pts = placements.map((p) => ({ ...p }));
  const loX = pad;
  const hiX = Math.max(pad, width - pad);
  const loY = pad;
  const hiY = Math.max(pad, height - pad);
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        let dx = b.px - a.px;
        let dy = b.py - a.py;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        if (dist < 1e-6) {
          const ang = i * 1.7 + j;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          dist = 1;
        }
        const push = (minDist - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.px -= ux * push;
        a.py -= uy * push;
        b.px += ux * push;
        b.py += uy * push;
        moved = true;
      }
    }
    for (const p of pts) {
      p.px = clamp(p.px, loX, hiX);
      p.py = clamp(p.py, loY, hiY);
    }
    if (!moved) break;
  }
  return pts;
}

/** Aggregate territory-level orbit connections into world-to-world lanes. */
export function aggregateOrbitLanes(
  connections: GalaxyConnectionLite[],
  worldOf: (territoryId: string) => string | null,
): WorldLane[] {
  const map = new Map<string, WorldLane>();
  for (const c of connections) {
    if (c.type !== 'orbit') continue;
    const wa = worldOf(c.from);
    const wb = worldOf(c.to);
    if (!wa || !wb || wa === wb) continue;
    const [a, b] = wa < wb ? [wa, wb] : [wb, wa];
    const key = `${a}::${b}`;
    const lane = map.get(key) ?? { a, b, underlying: [] };
    lane.underlying.push({ from: c.from, to: c.to });
    map.set(key, lane);
  }
  return [...map.values()].sort((x, y) =>
    x.a !== y.a ? (x.a < y.a ? -1 : 1) : x.b < y.b ? -1 : x.b > y.b ? 1 : 0,
  );
}
