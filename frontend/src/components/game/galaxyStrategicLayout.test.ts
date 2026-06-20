import { describe, it, expect } from 'vitest';
import {
  aggregateOrbitLanes,
  buildWorldNodes,
  fitToViewport,
  nodeSizing,
  relaxPlacements,
  type GalaxyConnectionLite,
  type GalaxyTerritoryLite,
} from './galaxyStrategicLayout';

const playerInfo = (pid: string) =>
  ({ p1: { color: '#e24b4a', name: 'You' }, p2: { color: '#4a90e2', name: 'Doukas' } }[pid] ?? null);

function terr(id: string, world: string, pos: [number, number]): GalaxyTerritoryLite {
  return { territory_id: id, region_id: `${world}_r`, world_id: world, galaxy_position: pos };
}

describe('buildWorldNodes', () => {
  const territories: GalaxyTerritoryLite[] = [
    terr('sol_a', 'sol', [0.2, 0.2]),
    terr('sol_b', 'sol', [0.4, 0.6]),
    terr('sol_c', 'sol', [0.3, 0.4]),
    terr('verdan_a', 'verdan', [0.8, 0.2]),
    terr('verdan_b', 'verdan', [0.9, 0.4]),
  ];
  // sol: a,c → p1 ; b → neutral. verdan: a → p1, b → p2.
  const owners: Record<string, string | null> = {
    sol_a: 'p1',
    sol_b: null,
    sol_c: 'p1',
    verdan_a: 'p1',
    verdan_b: 'p2',
  };
  const nodes = buildWorldNodes(territories, {
    ownerOf: (id) => owners[id] ?? null,
    playerInfo,
    displayNameOf: (w) => ({ sol: 'Sol III', verdan: 'Verdan Reach' }[w] ?? w),
  });

  it('produces one node per world, sorted by world_id', () => {
    expect(nodes.map((n) => n.world_id)).toEqual(['sol', 'verdan']);
  });

  it('computes the centroid from authored galaxy_position', () => {
    const sol = nodes.find((n) => n.world_id === 'sol')!;
    expect(sol.cx).toBeCloseTo((0.2 + 0.4 + 0.3) / 3, 6);
    expect(sol.cy).toBeCloseTo((0.2 + 0.6 + 0.4) / 3, 6);
  });

  it('tallies ownership shares and neutral remainder', () => {
    const sol = nodes.find((n) => n.world_id === 'sol')!;
    expect(sol.territory_count).toBe(3);
    expect(sol.ownership).toHaveLength(1);
    expect(sol.ownership[0]).toMatchObject({ player_id: 'p1', count: 2 });
    expect(sol.ownership[0]!.share).toBeCloseTo(2 / 3, 6);
    expect(sol.neutral_share).toBeCloseTo(1 / 3, 6);
  });

  it('orders owner slices descending by count', () => {
    const verdan = nodes.find((n) => n.world_id === 'verdan')!;
    expect(verdan.ownership.map((s) => s.player_id)).toEqual(['p1', 'p2']);
  });

  it('names a leader only when its count exceeds the neutral count', () => {
    // sol: p1=2 > neutral=1 → leader p1
    expect(nodes.find((n) => n.world_id === 'sol')!.leader_player_id).toBe('p1');
    // a mostly-neutral world has no leader
    const mostlyNeutral = buildWorldNodes(
      [terr('x_a', 'x', [0.1, 0.1]), terr('x_b', 'x', [0.1, 0.2]), terr('x_c', 'x', [0.1, 0.3])],
      {
        ownerOf: (id) => (id === 'x_a' ? 'p1' : null),
        playerInfo,
        displayNameOf: (w) => w,
      },
    );
    expect(mostlyNeutral[0]!.leader_player_id).toBeNull();
  });

  it('exposes a deterministic drill-in representative (first sorted territory id)', () => {
    const sol = nodes.find((n) => n.world_id === 'sol')!;
    expect(sol.territory_ids[0]).toBe('sol_a');
  });

  it('falls back to a stable ring position when a world has no galaxy_position', () => {
    const no = buildWorldNodes(
      [{ territory_id: 't1', region_id: 'r', world_id: 'lonely' }],
      { ownerOf: () => null, playerInfo, displayNameOf: (w) => w },
    );
    expect(no[0]!.cx).toBeGreaterThanOrEqual(0);
    expect(no[0]!.cx).toBeLessThanOrEqual(1);
    expect(no[0]!.cy).toBeGreaterThanOrEqual(0);
    expect(no[0]!.cy).toBeLessThanOrEqual(1);
  });
});

describe('fitToViewport', () => {
  it('maps the centroid bounding box into the padded viewport', () => {
    const out = fitToViewport(
      [
        { world_id: 'a', cx: 0.1, cy: 0.2 },
        { world_id: 'b', cx: 0.5, cy: 0.6 },
      ],
      400,
      300,
      50,
    );
    const a = out.find((p) => p.world_id === 'a')!;
    const b = out.find((p) => p.world_id === 'b')!;
    expect(a.px).toBeCloseTo(50, 6); // min x → left pad
    expect(b.px).toBeCloseTo(350, 6); // max x → right pad (400-50)
    expect(a.py).toBeCloseTo(50, 6);
    expect(b.py).toBeCloseTo(250, 6);
  });

  it('centers a single world', () => {
    expect(fitToViewport([{ world_id: 'solo', cx: 0.9, cy: 0.1 }], 200, 100, 20)).toEqual([
      { world_id: 'solo', px: 100, py: 50 },
    ]);
  });

  it('centers along a degenerate (zero-span) axis', () => {
    const out = fitToViewport(
      [
        { world_id: 'a', cx: 0.5, cy: 0.2 },
        { world_id: 'b', cx: 0.5, cy: 0.8 },
      ],
      400,
      300,
      50,
    );
    // identical cx → both centered horizontally
    expect(out[0]!.px).toBeCloseTo(200, 6);
    expect(out[1]!.px).toBeCloseTo(200, 6);
  });
});

describe('relaxPlacements', () => {
  it('pushes overlapping worlds at least minDist apart', () => {
    const out = relaxPlacements(
      [
        { world_id: 'a', px: 200, py: 150 },
        { world_id: 'b', px: 205, py: 150 },
      ],
      60,
      400,
      300,
      20,
    );
    const a = out.find((p) => p.world_id === 'a')!;
    const b = out.find((p) => p.world_id === 'b')!;
    expect(Math.hypot(b.px - a.px, b.py - a.py)).toBeGreaterThanOrEqual(59);
  });

  it('separates exactly-coincident worlds deterministically', () => {
    const input = [
      { world_id: 'a', px: 200, py: 150 },
      { world_id: 'b', px: 200, py: 150 },
    ];
    const run1 = relaxPlacements(input, 50, 400, 300, 20);
    const run2 = relaxPlacements(input, 50, 400, 300, 20);
    expect(run1).toEqual(run2);
    expect(Math.hypot(run1[0]!.px - run1[1]!.px, run1[0]!.py - run1[1]!.py)).toBeGreaterThan(40);
  });

  it('leaves well-separated worlds untouched', () => {
    const input = [
      { world_id: 'a', px: 60, py: 60 },
      { world_id: 'b', px: 340, py: 240 },
    ];
    expect(relaxPlacements(input, 60, 400, 300, 20)).toEqual(input);
  });

  it('keeps every world inside the padded viewport', () => {
    const out = relaxPlacements(
      [
        { world_id: 'a', px: 10, py: 10 },
        { world_id: 'b', px: 12, py: 12 },
      ],
      120,
      300,
      300,
      25,
    );
    for (const p of out) {
      expect(p.px).toBeGreaterThanOrEqual(25);
      expect(p.px).toBeLessThanOrEqual(275);
      expect(p.py).toBeGreaterThanOrEqual(25);
      expect(p.py).toBeLessThanOrEqual(275);
    }
  });
});

describe('aggregateOrbitLanes', () => {
  const worldMap: Record<string, string> = {
    sol_a: 'sol',
    sol_b: 'sol',
    verdan_a: 'verdan',
    rust_a: 'rust',
  };
  const worldOf = (id: string) => worldMap[id] ?? null;

  it('groups orbit connections into order-independent world pairs', () => {
    const conns: GalaxyConnectionLite[] = [
      { from: 'sol_a', to: 'verdan_a', type: 'orbit' },
      { from: 'verdan_a', to: 'sol_b', type: 'orbit' }, // same pair, reversed + different territory
      { from: 'sol_a', to: 'sol_b', type: 'land' }, // intra-world land — ignored
      { from: 'sol_a', to: 'rust_a', type: 'orbit' },
    ];
    const lanes = aggregateOrbitLanes(conns, worldOf);
    // World-pair keys are lexically sorted (rust < sol), order-independent.
    expect(lanes.map((l) => `${l.a}::${l.b}`)).toEqual(['rust::sol', 'sol::verdan']);
    const solVerdan = lanes.find((l) => l.b === 'verdan')!;
    expect(solVerdan.underlying).toHaveLength(2);
  });

  it('ignores non-orbit and same-world connections', () => {
    const lanes = aggregateOrbitLanes(
      [
        { from: 'sol_a', to: 'sol_b', type: 'orbit' }, // same world
        { from: 'sol_a', to: 'verdan_a', type: 'sea' }, // not orbit
      ],
      worldOf,
    );
    expect(lanes).toHaveLength(0);
  });
});

describe('nodeSizing', () => {
  it('shrinks the donut radius as world count grows', () => {
    const few = nodeSizing(3, 800, 600);
    const many = nodeSizing(16, 800, 600);
    expect(many.donutR).toBeLessThan(few.donutR);
  });

  it('clamps radius and font sizes into legible bounds', () => {
    const huge = nodeSizing(1, 4000, 4000);
    const tiny = nodeSizing(64, 320, 240);
    expect(huge.donutR).toBeLessThanOrEqual(58);
    expect(tiny.donutR).toBeGreaterThanOrEqual(20);
    expect(tiny.fontSize).toBeGreaterThanOrEqual(11);
  });
});
