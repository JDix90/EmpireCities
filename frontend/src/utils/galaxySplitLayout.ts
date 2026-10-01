/**
 * Galactic Age Split view (components/game/GalaxySplitView.tsx): which world
 * sits in which cell of the grid, and where the lanes between them run.
 *
 * The galaxy chart rings the worlds by their authored `galaxy_position` (on the
 * shipped map Sol at the top, Verdan right, Rust bottom, Nexus Station left),
 * and its lanes only join neighbours on that ring. The grid keeps the ring,
 * turned an eighth: worlds go clockwise from the top-left cell round a 2×2
 * grid (top-left, top-right, bottom-right, bottom-left), so two worlds a lane
 * joins always sit side by side, never diagonally.
 */

import { orbitLaneId } from './galaxyLanes';

/** A world as the chart places it: its centroid, normalized with the origin top-left. */
export interface SplitWorld {
  world_id: string;
  cx: number;
  cy: number;
}

export interface SplitCell<W extends SplitWorld> {
  world: W;
  row: number;
  col: number;
}

export interface SplitLayout<W extends SplitWorld> {
  rows: number;
  cols: number;
  cells: Array<SplitCell<W>>;
}

/** A 2×2 grid's cells, clockwise from its top-left, as [row, col]. */
const RING_CELLS: ReadonlyArray<readonly [number, number]> = [[0, 0], [0, 1], [1, 1], [1, 0]];

/** Past the ring's four cells, worlds fill rows this wide. */
const WIDE_COLS = 3;

/**
 * The worlds in clockwise order round their common centre, starting from the
 * top-left. Screen y grows downwards, so a larger angle is further clockwise.
 */
export function clockwiseFromTopLeft<W extends SplitWorld>(worlds: readonly W[]): W[] {
  const mx = worlds.reduce((s, w) => s + w.cx, 0) / (worlds.length || 1);
  const my = worlds.reduce((s, w) => s + w.cy, 0) / (worlds.length || 1);
  const key = (w: W) => {
    const deg = (Math.atan2(w.cy - my, w.cx - mx) * 180) / Math.PI;
    // Measured from the top-left (-135°), so that direction comes first.
    return (deg + 135 + 360) % 360;
  };
  return [...worlds].sort((a, b) => key(a) - key(b) || (a.world_id < b.world_id ? -1 : 1));
}

/** Where each world sits: one pane, a row of two, the ring of up to four, or rows of three beyond. */
export function splitLayout<W extends SplitWorld>(worlds: readonly W[]): SplitLayout<W> {
  const ordered = clockwiseFromTopLeft(worlds);
  if (ordered.length <= 2) {
    return { rows: 1, cols: Math.max(1, ordered.length), cells: ordered.map((world, i) => ({ world, row: 0, col: i })) };
  }
  if (ordered.length <= RING_CELLS.length) {
    return {
      rows: 2,
      cols: 2,
      cells: ordered.map((world, i) => ({ world, row: RING_CELLS[i]![0], col: RING_CELLS[i]![1] })),
    };
  }
  return {
    rows: Math.ceil(ordered.length / WIDE_COLS),
    cols: WIDE_COLS,
    cells: ordered.map((world, i) => ({ world, row: Math.floor(i / WIDE_COLS), col: i % WIDE_COLS })),
  };
}

/** One lane across the grid: its two gateways, and where each is drawn. */
export interface SplitLane {
  /** orbitLaneId: the lane's id, either way round. */
  key: string;
  from: string;
  to: string;
  /** Engine-added lanes say what added them ('jump_gate', 'lane_surge', 'galaxy_mode'). */
  source?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The grid's measures, as GalaxySplitView lays it out. */
export interface SplitGeometry {
  paneWidth: number;
  paneHeight: number;
  gap: number;
  /** Each pane's header, above its map. */
  header: number;
  /** The map's own border: its canvas pixels start this far inside the map box. */
  inset: number;
}

/**
 * Every lane between two worlds that both have a pane, from gateway to
 * gateway, in the grid's pixels: a pane's origin plus where its map drew the
 * gateway (`centers`, per world). A lane whose gateway a pane has not reported
 * yet is left out until it has.
 */
export function splitLanes(
  connections: ReadonlyArray<{ from: string; to: string; type: string; source?: string }>,
  worldOf: (territoryId: string) => string | undefined,
  cells: ReadonlyArray<SplitCell<SplitWorld>>,
  centers: Readonly<Record<string, ReadonlyMap<string, { x: number; y: number }>>>,
  g: SplitGeometry,
): SplitLane[] {
  const origin = new Map(cells.map((c) => [
    c.world.world_id,
    { x: c.col * (g.paneWidth + g.gap) + g.inset, y: c.row * (g.paneHeight + g.header + g.gap) + g.header + g.inset },
  ]));
  const seen = new Set<string>();
  const out: SplitLane[] = [];
  for (const c of connections) {
    if (c.type !== 'orbit') continue;
    const wa = worldOf(c.from);
    const wb = worldOf(c.to);
    if (!wa || !wb || wa === wb) continue;
    const oa = origin.get(wa);
    const ob = origin.get(wb);
    const pa = centers[wa]?.get(c.from);
    const pb = centers[wb]?.get(c.to);
    if (!oa || !ob || !pa || !pb) continue;
    const key = orbitLaneId(c.from, c.to);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, from: c.from, to: c.to, source: c.source, x1: oa.x + pa.x, y1: oa.y + pa.y, x2: ob.x + pb.x, y2: ob.y + pb.y });
  }
  return out;
}
