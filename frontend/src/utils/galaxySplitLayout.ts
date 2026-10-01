/**
 * Galactic Age Split view (components/game/GalaxySplitView.tsx): which world
 * sits in which cell of the grid.
 *
 * The galaxy chart rings the worlds by their authored `galaxy_position` (on the
 * shipped map Sol at the top, Verdan right, Rust bottom, Nexus Station left),
 * and its lanes only join neighbours on that ring. The grid keeps the ring,
 * turned an eighth: worlds go clockwise from the top-left cell round a 2×2
 * grid (top-left, top-right, bottom-right, bottom-left), so two worlds a lane
 * joins always sit side by side, never diagonally.
 */

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
