import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import { beachesOf, buildCoastIndex, isCoastal } from './coast';
import {
  BEACHES_PER_PROVINCE,
  BEACH_SEPARATION_CELLS,
  BUILDING_SPECS,
  BuildingKind,
  COMBAT_SPECS,
  DISEMBARK_TICKS,
  PORT_CONVOY_CAP,
  TRANSIT_BASE_TICKS,
  TRANSIT_MAX_TICKS,
  UnitKind,
  seconds,
  transitTicks,
  type UnitKindValue,
} from './rules';

/**
 * Rule V on two islands and the strait between them.
 *
 * Columns 0-9 are province 1's land and 30-39 are province 2's; everything between is
 * sea. Nothing can walk from one to the other, which is the point — every unit that
 * reaches the far shore in this file got there by lane, so there is no way to pass these
 * tests by accident.
 *
 * Sixty rows rather than forty because the far island has to be able to EXPRESS four
 * beaches fifteen cells apart. At forty it could hold three, and the first draft of the
 * beach test failed against a grid too small to show the thing it was asking about.
 */
const WIDTH = 40;
const HEIGHT = 60;
const HOME_LAST_COL = 9;
const AWAY_FIRST_COL = 30;
/**
 * A third island in the middle of the strait, province 3, with NO lane to it.
 *
 * Here because without it the lane graph is untestable: with only two provinces, both
 * ends of the only lane, "the destination must be lane-connected" and "the destination
 * must not be here" are the same check and a mutation removing the first passes.
 */
const ISLE_FIRST_COL = 18;
const ISLE_LAST_COL = 21;

function twoIslands(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * HEIGHT).fill(sea);
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const province =
        col <= HOME_LAST_COL ? 1 : col >= AWAY_FIRST_COL ? 2 : col >= ISLE_FIRST_COL && col <= ISLE_LAST_COL ? 3 : 0;
      if (province === 0) continue;
      cells[row * WIDTH + col] = packCell({ owner: province, tier: 0, passable: true, biome: Biome.Plains });
    }
  }
  return new TerrainGrid(WIDTH, HEIGHT, cells, {
    provinces: [
      { index: 1, territory_id: 'home', name: 'Home' },
      { index: 2, territory_id: 'away', name: 'Away' },
      { index: 3, territory_id: 'isle', name: 'Isle' },
    ],
    lanes: [{ from: 'home', to: 'away' }],
  });
}

const at = (col: number, row: number) => row * WIDTH + col;

interface Placed {
  owner: number;
  kind: UnitKindValue;
  col: number;
  row: number;
}

/** Both seats settled, each with a seat inland and a finished port on its own coast. */
function strait(units: Placed[], extra: Array<{ owner: number; kind: number; col: number; row: number }> = []) {
  return new Sim({
    seed: 3,
    terrain: twoIslands(),
    scenario: {
      players: [
        { index: 1, food: 5000, timber: 500, silver: 500 },
        { index: 2, food: 5000, timber: 500, silver: 500 },
      ],
      buildings: [
        { owner: 1, kind: BuildingKind.Seat, cell: at(1, 20) },
        { owner: 2, kind: BuildingKind.Seat, cell: at(38, 20) },
        { owner: 1, kind: BuildingKind.Port, cell: at(HOME_LAST_COL, 20) },
        ...extra.map((b) => ({ owner: b.owner, kind: b.kind as 1, cell: at(b.col, b.row) })),
      ],
      units: units.map((u) => ({
        owner: u.owner,
        kind: u.kind,
        x: cellCentre(u.col),
        y: cellCentre(u.row),
        speed: 0,
      })),
    },
  });
}

function portOf(sim: Sim, owner: number) {
  return sim.buildings.all().find((b) => b.kind === BuildingKind.Port && b.owner === owner)!;
}

describe('the coastline, derived', () => {
  const grid = twoIslands();

  it('is land with sea beside it, and nothing else', () => {
    expect(isCoastal(grid, at(HOME_LAST_COL, 20))).toBe(true);
    // One cell inland: land, but no sea orthogonally adjacent.
    expect(isCoastal(grid, at(HOME_LAST_COL - 1, 20))).toBe(false);
    // Open water is not a coast, whatever is next to it.
    expect(isCoastal(grid, at(20, 20))).toBe(false);
  });

  it('does not count a cell that meets the sea only at a corner', () => {
    // A notch: land everywhere except one sea cell, so its diagonal neighbour touches
    // water at a corner and nowhere else. A headland you can see the sea from is not a
    // harbour, and the rectangular two-island grid cannot express the difference — with
    // only straight coastlines, diagonal and orthogonal agree everywhere.
    const W = 5;
    const cells = new Uint16Array(W * 5);
    for (let i = 0; i < cells.length; i++) {
      cells[i] = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
    }
    cells[2 * W + 2] = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
    const notched = new TerrainGrid(W, 5, cells, {
      provinces: [{ index: 1, territory_id: 'notch', name: 'Notch' }],
    });
    // Orthogonally beside the water: a coast.
    expect(isCoastal(notched, 2 * W + 1)).toBe(true);
    expect(isCoastal(notched, 1 * W + 2)).toBe(true);
    // Diagonally beside it and nothing else: not a coast.
    expect(isCoastal(notched, 1 * W + 1)).toBe(false);
    expect(isCoastal(notched, 3 * W + 3)).toBe(false);
  });

  it('collects a province’s coast in ascending cell order', () => {
    const coast = buildCoastIndex(grid);
    const home = coast.byProvince.get(1)!;
    expect(home.length).toBeGreaterThan(0);
    expect([...home].sort((a, b) => a - b)).toEqual(home);
    for (const cell of home) expect(grid.owner(cell)).toBe(1);
  });
});

describe('beaches (rule V)', () => {
  const grid = twoIslands();
  const coast = buildCoastIndex(grid);

  it('offers several, spread far enough apart that one tower cannot cover them', () => {
    const beaches = beachesOf(grid, coast, 2, at(HOME_LAST_COL, 20), BEACHES_PER_PROVINCE, BEACH_SEPARATION_CELLS);
    expect(beaches).toHaveLength(BEACHES_PER_PROVINCE);
    for (let i = 0; i < beaches.length; i++) {
      for (let j = i + 1; j < beaches.length; j++) {
        const dc = Math.abs(grid.colOf(beaches[i]) - grid.colOf(beaches[j]));
        const dr = Math.abs(grid.rowOf(beaches[i]) - grid.rowOf(beaches[j]));
        expect(Math.max(dc, dr)).toBeGreaterThanOrEqual(BEACH_SEPARATION_CELLS);
      }
    }
  });

  it('gives the same answer every time, and in ascending order', () => {
    const a = beachesOf(grid, coast, 2, at(HOME_LAST_COL, 20), 4, BEACH_SEPARATION_CELLS);
    const b = beachesOf(grid, coast, 2, at(HOME_LAST_COL, 20), 4, BEACH_SEPARATION_CELLS);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
  });
});

describe('transit time (rule V)', () => {
  it('has a floor, a slope and a ceiling', () => {
    expect(transitTicks(0)).toBe(TRANSIT_BASE_TICKS);
    expect(transitTicks(10)).toBeGreaterThan(transitTicks(2));
    expect(transitTicks(100_000)).toBe(TRANSIT_MAX_TICKS);
  });

  it('puts the map’s real lanes near the brief’s one-to-two minutes', () => {
    // The measured extremes of the committed asset: Italy to Sicily is 2 cells, Sardinia
    // to Tarraconensis 141. A strait should not cost the same as an open-sea passage.
    expect(transitTicks(2)).toBeLessThanOrEqual(seconds(65));
    expect(transitTicks(60)).toBeLessThanOrEqual(seconds(120));
    expect(transitTicks(141)).toBe(TRANSIT_MAX_TICKS);
  });
});

describe('embarking (rule V)', () => {
  it('carries a unit across a lane it could never walk', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 20 }]);
    const spear = sim.entities.all()[0];
    const port = portOf(sim, 1);
    const beach = sim.beaches(2, port.cell)[0];

    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: beach });
    sim.run(3);
    expect(spear.convoy).toBeGreaterThanOrEqual(0);
    expect(sim.convoys.all()).toHaveLength(1);

    const convoy = sim.convoys.all()[0];
    expect(convoy.overBeach).toBe(true);
    sim.runTo(convoy.arriveTick);
    expect(spear.convoy).toBe(-1);
    expect(sim.terrain!.owner(at(spear.x >> 16, spear.y >> 16))).toBe(2);
  });

  it('refuses a unit that is not standing at the quay', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Spear, col: 2, row: 20 }]);
    const spear = sim.entities.all()[0];
    const port = portOf(sim, 1);
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: sim.beaches(2, port.cell)[0] });
    sim.run(3);
    expect(spear.convoy).toBe(-1);
    expect(sim.convoys.all()).toHaveLength(0);
  });

  it('refuses somebody else’s port', () => {
    const sim = strait([{ owner: 2, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 20 }]);
    const spear = sim.entities.all()[0];
    const port = portOf(sim, 1);
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: sim.beaches(2, port.cell)[0] });
    sim.run(3);
    expect(sim.convoys.all()).toHaveLength(0);
  });

  it('refuses a landing that is neither a beach nor a port of ours', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 20 }]);
    const spear = sim.entities.all()[0];
    const port = portOf(sim, 1);
    // Inland on the far island: real ground, in the right province, not a landing site.
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: at(35, 20) });
    sim.run(3);
    expect(sim.convoys.all()).toHaveLength(0);
  });

  it('refuses a province with no lane to it, however close it is', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 20 }]);
    const spear = sim.entities.all()[0];
    const port = portOf(sim, 1);
    // A real BEACH of the isle, not merely a coastal cell — otherwise the landing-site
    // check refuses this first and the lane check is never reached, which is exactly what
    // the first version of this test did: it passed with the lane rule deleted.
    const target = sim.beaches(3, port.cell)[0];
    expect(target).toBeGreaterThanOrEqual(0);
    expect(isCoastal(sim.terrain!, target)).toBe(true);
    expect(sim.lanesFrom(1)).not.toContain(3);
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: target });
    sim.run(3);
    expect(sim.convoys.all()).toHaveLength(0);
    expect(spear.convoy).toBe(-1);
  });

  it('groups everyone who boards on the same tick into one convoy, up to the cap', () => {
    const squad: Placed[] = Array.from({ length: PORT_CONVOY_CAP + 2 }, (_, i) => ({
      owner: 1,
      kind: UnitKind.Spear,
      col: HOME_LAST_COL,
      row: 15 + i,
    }));
    const sim = strait(squad);
    const port = portOf(sim, 1);
    const beach = sim.beaches(2, port.cell)[0];
    // All at the quay: the port sits at row 20 and a unit may board from one cell away,
    // so only the three around it can actually reach — board those, then the rest.
    for (const unit of sim.entities.all()) {
      unit.x = cellCentre(HOME_LAST_COL);
      unit.y = cellCentre(20);
      sim.issue({ type: 'embark', unit: unit.id, port: port.id, cell: beach });
    }
    sim.run(3);
    expect(sim.convoys.all()).toHaveLength(1);
    // The cap is the port's, and the two over it stay ashore.
    expect(sim.convoys.all()[0].units).toHaveLength(PORT_CONVOY_CAP);
    expect(sim.entities.all().filter((u) => u.convoy === -1)).toHaveLength(2);
  });
});

describe('a convoy at sea (rule V)', () => {
  /** A spear of seat 1 aboard, and an archer of seat 2 standing where it embarked. */
  function crossing() {
    const sim = strait([
      { owner: 1, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 20 },
      { owner: 2, kind: UnitKind.Archer, col: HOME_LAST_COL - 1, row: 20 },
    ]);
    const [spear] = sim.entities.all();
    const port = portOf(sim, 1);
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: sim.beaches(2, port.cell)[0] });
    sim.run(3);
    return { sim, spear, archer: sim.entities.all()[1] };
  }

  it('cannot be attacked — the fight is always on the shore', () => {
    const { sim, spear } = crossing();
    expect(spear.convoy).toBeGreaterThanOrEqual(0);
    const full = spear.hp;
    // The archer is one cell from where the spear "is", and shoots four. Without rule V
    // it would empty its quiver into a boat.
    sim.run(seconds(20));
    expect(spear.hp).toBe(full);
  });

  it('does not fight back either', () => {
    const { sim, archer } = crossing();
    const full = archer.hp;
    sim.run(seconds(20));
    // Exactly two points, and they are rule VII's: this archer is standing in somebody
    // else's province, so it bleeds one every ten seconds. Nothing reaches it from the
    // sea. Stated as an exact figure rather than "unharmed" because it is NOT unharmed,
    // and a test that claimed otherwise would be asserting the wrong rule.
    expect(full - archer.hp).toBe(2);
  });

  it('does not bleed, however long the crossing', () => {
    const { sim, spear } = crossing();
    const full = spear.hp;
    const convoy = sim.convoys.all()[0];
    sim.runTo(convoy.arriveTick - 1);
    expect(spear.hp).toBe(full);
  });
});

describe('coming ashore (rule V)', () => {
  it('spends twenty seconds at half armour over a beach', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 20 }]);
    const spear = sim.entities.all()[0];
    const port = portOf(sim, 1);
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: sim.beaches(2, port.cell)[0] });
    sim.run(3);
    const convoy = sim.convoys.all()[0];
    sim.runTo(convoy.arriveTick);
    expect(spear.disembarkTimer).toBe(DISEMBARK_TICKS);

    sim.run(DISEMBARK_TICKS);
    expect(spear.disembarkTimer).toBe(0);
  });

  it('walks off dry when the far port is ours', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 20 }], [
      { owner: 1, kind: BuildingKind.Port, col: AWAY_FIRST_COL, row: 20 },
    ]);
    const spear = sim.entities.all()[0];
    const port = portOf(sim, 1);
    const far = sim.buildings.all().find((b) => b.kind === BuildingKind.Port && b.cell === at(AWAY_FIRST_COL, 20))!;
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: far.cell });
    sim.run(3);
    const convoy = sim.convoys.all()[0];
    expect(convoy.overBeach).toBe(false);
    sim.runTo(convoy.arriveTick);
    // "Own the far port and units walk off" — no landing penalty at all.
    expect(spear.disembarkTimer).toBe(0);
  });

  it('takes double damage while it is still coming ashore', () => {
    // A ram coming ashore and a spear waiting for it, chosen deliberately: the triangle
    // and the landing penalty MULTIPLY, and the first draft of this test landed a spear
    // against an archer — 5 damage, doubled by the triangle, doubled again by the landing
    // — which is 20 a strike and killed the thing being measured before the measurement
    // finished. Spear into ram is even, so what is left is the landing penalty alone.
    const sim = strait([
      { owner: 1, kind: UnitKind.Ram, col: HOME_LAST_COL, row: 20 },
      { owner: 2, kind: UnitKind.Spear, col: AWAY_FIRST_COL + 5, row: 1 },
    ]);
    const [ram, defender] = sim.entities.all();
    const port = portOf(sim, 1);
    const beach = sim.beaches(2, port.cell)[0];
    sim.issue({ type: 'embark', unit: ram.id, port: port.id, cell: beach });
    sim.run(3);
    const convoy = sim.convoys.all()[0];
    sim.runTo(convoy.arriveTick);
    expect(ram.disembarkTimer).toBe(DISEMBARK_TICKS);

    const nearBeach = () => {
      defender.x = cellCentre(sim.terrain!.colOf(beach));
      defender.y = cellCentre(sim.terrain!.rowOf(beach) + 1);
    };
    const away = () => {
      defender.x = cellCentre(AWAY_FIRST_COL + 5);
      defender.y = cellCentre(1);
    };

    nearBeach();
    const before = ram.hp;
    sim.run(seconds(2));
    const underPenalty = before - ram.hp;
    expect(underPenalty).toBeGreaterThan(0);

    // The defender steps back while the landing finishes, so the second window measures
    // the same fight without the penalty rather than measuring a corpse.
    away();
    sim.run(DISEMBARK_TICKS);
    expect(ram.disembarkTimer).toBe(0);
    expect(ram.hp).toBeGreaterThan(0);

    nearBeach();
    const mid = ram.hp;
    sim.run(seconds(2));
    const normal = mid - ram.hp;
    expect(normal).toBeGreaterThan(0);
    // Same spear, same two seconds, half the damage once the landing is over.
    expect(underPenalty).toBe(normal * 2);
  });
});

describe('the port (rule V)', () => {
  it('may only be built on a coast', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Villager, col: 5, row: 20 }]);
    const villager = sim.entities.all()[0];
    sim.issue({ type: 'build', unit: villager.id, kind: BuildingKind.Port, cell: at(5, 20) });
    sim.run(3);
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Port)).toHaveLength(1);

    sim.issue({ type: 'build', unit: villager.id, kind: BuildingKind.Port, cell: at(HOME_LAST_COL, 25) });
    sim.run(3);
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Port)).toHaveLength(2);
  });

  it('cannot put to sea until it is finished', () => {
    const sim = strait([{ owner: 1, kind: UnitKind.Spear, col: HOME_LAST_COL, row: 25 }]);
    const spear = sim.entities.all()[0];
    const site = sim.buildings.place({
      kind: BuildingKind.Port,
      owner: 1,
      cell: at(HOME_LAST_COL, 25),
    });
    sim.issue({ type: 'embark', unit: spear.id, port: site.id, cell: sim.beaches(2, site.cell)[0] });
    sim.run(3);
    expect(sim.convoys.all()).toHaveLength(0);
    expect(BUILDING_SPECS[BuildingKind.Port].buildTicks).toBeGreaterThan(0);
  });
});

describe('every unit kind can sail', () => {
  it('carries villagers and rams, not only the ones that fight', () => {
    // Rule I's colonist has to be able to reach an island, and the brief's siege has to
    // be able to bring its rams. A convoy that only took soldiers would make Britannia
    // unsettleable and unbesiegeable at once.
    for (const kind of [UnitKind.Villager, UnitKind.Ram, UnitKind.Scout]) {
      const sim = strait([{ owner: 1, kind, col: HOME_LAST_COL, row: 20 }]);
      const unit = sim.entities.all()[0];
      const port = portOf(sim, 1);
      sim.issue({ type: 'embark', unit: unit.id, port: port.id, cell: sim.beaches(2, port.cell)[0] });
      sim.run(3);
      expect(sim.convoys.all()).toHaveLength(1);
      expect(COMBAT_SPECS[kind] === undefined || kind === UnitKind.Ram).toBe(true);
    }
  });
});
