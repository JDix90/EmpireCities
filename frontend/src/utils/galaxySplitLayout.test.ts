import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { clockwiseFromTopLeft, splitLanes, splitLayout, type SplitGeometry, type SplitWorld } from './galaxySplitLayout';

const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; world_id: string }>;
  connections: Array<{ from: string; to: string; type: string }>;
  worlds: Array<{ world_id: string; galaxy_position: [number, number] }>;
};

/** The shipped worlds where the chart draws them. */
const shipped: SplitWorld[] = galaxy.worlds.map((w) => ({
  world_id: w.world_id,
  cx: w.galaxy_position[0],
  cy: w.galaxy_position[1],
}));

const at = (cx: number, cy: number, world_id: string): SplitWorld => ({ world_id, cx, cy });

describe('splitLayout', () => {
  it("turns the chart's ring into the grid clockwise from the top-left", () => {
    // The chart: Sol at the top, Verdan right, Rust bottom, Nexus Station left.
    const cells = splitLayout(shipped).cells.map((c) => [c.world.world_id, c.row, c.col]);
    expect(cells).toEqual([
      ['sol', 0, 0],
      ['verdan', 0, 1],
      ['rust', 1, 1],
      ['nexus_station', 1, 0],
    ]);
  });

  it('puts the two worlds of every shipped lane side by side, never diagonally', () => {
    const worldOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.world_id]));
    const cellOf = new Map(splitLayout(shipped).cells.map((c) => [c.world.world_id, c]));
    const lanes = galaxy.connections.filter((c) => c.type === 'orbit');
    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      const a = cellOf.get(worldOf.get(lane.from)!)!;
      const b = cellOf.get(worldOf.get(lane.to)!)!;
      expect(Math.abs(a.row - b.row) + Math.abs(a.col - b.col), `${lane.from} → ${lane.to}`).toBe(1);
    }
  });

  it('keeps worlds already on the corners where they are', () => {
    const square = [at(0.9, 0.9, 'se'), at(0.1, 0.1, 'nw'), at(0.1, 0.9, 'sw'), at(0.9, 0.1, 'ne')];
    expect(splitLayout(square).cells.map((c) => [c.world.world_id, c.row, c.col])).toEqual([
      ['nw', 0, 0],
      ['ne', 0, 1],
      ['se', 1, 1],
      ['sw', 1, 0],
    ]);
  });

  it('fits fewer worlds: one pane, a row of two, three of the four cells', () => {
    expect(splitLayout([at(0.5, 0.5, 'sol')])).toEqual({
      rows: 1, cols: 1, cells: [{ world: at(0.5, 0.5, 'sol'), row: 0, col: 0 }],
    });
    const two = splitLayout(shipped.filter((w) => w.world_id === 'sol' || w.world_id === 'verdan'));
    expect([two.rows, two.cols]).toEqual([1, 2]);
    expect(two.cells.map((c) => [c.world.world_id, c.col])).toEqual([['sol', 0], ['verdan', 1]]);
    const three = splitLayout(shipped.filter((w) => w.world_id !== 'nexus_station'));
    expect([three.rows, three.cols]).toEqual([2, 2]);
    expect(three.cells).toHaveLength(3);
    expect(splitLayout([]).cells).toEqual([]);
  });

  it('goes to rows of three past four worlds', () => {
    const six = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return at(0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a), `w${i}`);
    });
    const layout = splitLayout(six);
    expect([layout.rows, layout.cols]).toEqual([2, 3]);
    expect(new Set(layout.cells.map((c) => `${c.row},${c.col}`)).size).toBe(6);
  });
});

describe('clockwiseFromTopLeft', () => {
  it('orders by angle round the centre, ties by world id', () => {
    expect(clockwiseFromTopLeft(shipped).map((w) => w.world_id)).toEqual(['sol', 'verdan', 'rust', 'nexus_station']);
    // Every world on one spot: no angle to go by, so the ids decide.
    const piled = [at(0.5, 0.5, 'b'), at(0.5, 0.5, 'a'), at(0.5, 0.5, 'c')];
    expect(clockwiseFromTopLeft(piled).map((w) => w.world_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('splitLanes', () => {
  const worldOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.world_id]));
  const cells = splitLayout(shipped).cells;
  const g: SplitGeometry = { paneWidth: 400, paneHeight: 300, gap: 6, header: 30, inset: 1 };
  /** Every pane reports each of its systems at (10, 20) on its canvas. */
  const everywhere = Object.fromEntries(shipped.map((w) => [
    w.world_id,
    new Map(galaxy.territories.filter((t) => t.world_id === w.world_id).map((t) => [t.territory_id, { x: 10, y: 20 }])),
  ]));
  const lanes = galaxy.connections.filter((c) => c.type === 'orbit');

  it("runs every lane from its gateway in one pane to its gateway in the next", () => {
    const drawn = splitLanes(galaxy.connections, (id) => worldOf.get(id), cells, everywhere, g);
    expect(drawn).toHaveLength(lanes.length);
    // A pane's canvas starts at its cell, below its header, inside the map's border.
    const corner = (row: number, col: number) => [col * (400 + 6) + 1 + 10, row * (300 + 30 + 6) + 30 + 1 + 20];
    const cellOf = new Map(cells.map((c) => [c.world.world_id, c]));
    for (const lane of drawn) {
      const a = cellOf.get(worldOf.get(lane.from)!)!;
      const b = cellOf.get(worldOf.get(lane.to)!)!;
      expect([lane.x1, lane.y1]).toEqual(corner(a.row, a.col));
      expect([lane.x2, lane.y2]).toEqual(corner(b.row, b.col));
    }
  });

  it('draws a lane once whichever way it is listed, and only lanes between worlds', () => {
    const one = lanes[0]!;
    const neighbour = galaxy.territories.find(
      (t) => t.world_id === worldOf.get(one.from) && t.territory_id !== one.from,
    )!.territory_id;
    const listed = [
      one,
      { ...one, from: one.to, to: one.from },
      // An orbit edge inside one world is no lane between panes, nor is a land edge.
      { from: one.from, to: neighbour, type: 'orbit' },
      { from: one.from, to: neighbour, type: 'land' },
    ];
    expect(splitLanes(listed, (id) => worldOf.get(id), cells, everywhere, g).map((l) => l.from)).toEqual([one.from]);
  });

  it("waits for a pane that has not reported where it drew its gateways", () => {
    const withoutVerdan = Object.fromEntries(Object.entries(everywhere).filter(([w]) => w !== 'verdan'));
    const drawn = splitLanes(galaxy.connections, (id) => worldOf.get(id), cells, withoutVerdan, g);
    expect(drawn.length).toBe(lanes.length - 4); // Verdan's two lanes to Sol and two to Rust
    expect(drawn.every((l) => worldOf.get(l.from) !== 'verdan' && worldOf.get(l.to) !== 'verdan')).toBe(true);
  });
});
