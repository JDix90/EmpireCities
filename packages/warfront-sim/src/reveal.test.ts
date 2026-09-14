import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import { laneKey, revealedLanes, withinHops } from './reveal';
import { buildProvinceGeography } from './tribes';
import {
  BuildingKind,
  UnitKind,
  type BuildingKindValue,
  type UnitKindValue,
} from './rules';

/**
 * A mainland coast of three provinces, and one island off it.
 *
 * The shape is chosen to make the brief's two clauses tell each other apart. "A
 * lighthouse reveals lanes within one province; a port reveals its own lanes" is only a
 * meaningful sentence if one of them reaches further than the other, so the map has to
 * contain a lane that is one province away from a watcher and nowhere near it — which a
 * pair of islands cannot express, because islands have no land neighbours and every hop
 * is therefore zero.
 *
 *   cols 0-11   mainland, in three provinces stacked north to south, 32 rows each
 *   cols 12-27  sea
 *   cols 28-39  the isle
 *
 * Lanes run isle↔north and isle↔middle. So a watcher in the middle is exactly one hop
 * from the northern crossing and zero hops from its own, and a watcher in the south is
 * one hop from the middle crossing and TWO from the northern one — which is what pins
 * the reach to one province rather than to "the mainland".
 */
const WIDTH = 40;
const HEIGHT = 96;
const LAND_LAST_COL = 11;
const ISLE_FIRST_COL = 28;
const NORTH = 1;
const MIDDLE = 2;
const SOUTH = 3;
const ISLE = 4;

function coastAndIsle(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * HEIGHT).fill(sea);
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const province =
        col >= ISLE_FIRST_COL ? ISLE : col <= LAND_LAST_COL ? (row < 32 ? NORTH : row < 64 ? MIDDLE : SOUTH) : 0;
      if (province === 0) continue;
      cells[row * WIDTH + col] = packCell({ owner: province, tier: 0, passable: true, biome: Biome.Plains });
    }
  }
  return new TerrainGrid(WIDTH, HEIGHT, cells, {
    provinces: [
      { index: NORTH, territory_id: 'north', name: 'North' },
      { index: MIDDLE, territory_id: 'middle', name: 'Middle' },
      { index: SOUTH, territory_id: 'south', name: 'South' },
      { index: ISLE, territory_id: 'isle', name: 'Isle' },
    ],
    lanes: [
      { from: 'isle', to: 'north' },
      { from: 'isle', to: 'middle' },
    ],
  });
}

const at = (col: number, row: number) => row * WIDTH + col;

/** A cell in each province that a seat can stand on, well clear of the shore. */
const SEAT_CELL: Record<number, number> = {
  [NORTH]: at(2, 16),
  [MIDDLE]: at(2, 48),
  [SOUTH]: at(2, 80),
  [ISLE]: at(38, 48),
};

interface Placed {
  owner: number;
  kind: BuildingKindValue;
  cell: number;
}

interface Spawned {
  owner: number;
  kind: UnitKindValue;
  cell: number;
}

/**
 * Seat 1 on the isle with a harbour, seat 2 holding all three mainland provinces.
 *
 * Seat 1 is the attacker in every test here and seat 2 the one that has to pay to see it
 * coming, which is the arrangement rule V is actually about.
 */
function channel(watchers: Placed[] = [], units: Spawned[] = []): Sim {
  return new Sim({
    seed: 5,
    terrain: coastAndIsle(),
    scenario: {
      players: [
        { index: 1, food: 5000, timber: 500, silver: 500 },
        { index: 2, food: 5000, timber: 500, silver: 500 },
      ],
      buildings: [
        { owner: 1, kind: BuildingKind.Seat, cell: SEAT_CELL[ISLE] },
        { owner: 2, kind: BuildingKind.Seat, cell: SEAT_CELL[NORTH] },
        { owner: 2, kind: BuildingKind.Seat, cell: SEAT_CELL[MIDDLE] },
        { owner: 2, kind: BuildingKind.Seat, cell: SEAT_CELL[SOUTH] },
        { owner: 1, kind: BuildingKind.Port, cell: at(ISLE_FIRST_COL, 48) },
        ...watchers,
      ],
      units: units.map((u) => ({
        owner: u.owner,
        kind: u.kind,
        x: cellCentre(u.cell % WIDTH),
        y: cellCentre(Math.floor(u.cell / WIDTH)),
        speed: 0,
      })),
    },
  });
}

const isleQuay = at(ISLE_FIRST_COL, 48);

/** Puts one of seat 1's spears to sea toward a beach in `province`, and returns the convoy. */
function sail(sim: Sim, province: number) {
  const port = sim.buildings.all().find((b) => b.kind === BuildingKind.Port && b.owner === 1)!;
  const spear = sim.entities.all().find((u) => u.owner === 1 && u.kind === UnitKind.Spear)!;
  const beach = sim.beaches(province, port.cell)[0];
  expect(beach).toBeDefined();
  sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: beach });
  sim.run(3);
  const convoy = sim.convoys.all()[0];
  expect(convoy).toBeDefined();
  return convoy;
}

const spearAtQuay = (): Spawned => ({ owner: 1, kind: UnitKind.Spear, cell: isleQuay });

describe('lane keys', () => {
  it('name a lane the same way from either end', () => {
    expect(laneKey(MIDDLE, ISLE)).toBe(laneKey(ISLE, MIDDLE));
  });

  it('do not collide across different pairs', () => {
    const keys = new Set<number>();
    for (let a = 0; a < 40; a++) for (let b = a + 1; b < 40; b++) keys.add(laneKey(a, b));
    expect(keys.size).toBe((40 * 39) / 2);
  });
});

describe('how far a watcher sees', () => {
  const geography = buildProvinceGeography(coastAndIsle());

  it('at zero hops, sees only where it stands', () => {
    expect(withinHops(geography, MIDDLE, 0)).toEqual([MIDDLE]);
  });

  it('at one hop, reaches its land neighbours and stops', () => {
    expect(withinHops(geography, MIDDLE, 1)).toEqual([NORTH, MIDDLE, SOUTH]);
    expect(withinHops(geography, SOUTH, 1)).toEqual([MIDDLE, SOUTH]);
  });

  it('cannot hop over water, however many hops it is given', () => {
    // The isle has no land neighbours at all, so a light on it watches its own lanes and
    // nothing else — the sea is not a step.
    expect(withinHops(geography, ISLE, 1)).toEqual([ISLE]);
    expect(withinHops(geography, ISLE, 9)).toEqual([ISLE]);
  });
});

describe('nothing sees a convoy by default (rule V)', () => {
  it('hides a crossing from the seat it is aimed at', () => {
    const sim = channel([], [spearAtQuay()]);
    const convoy = sail(sim, MIDDLE);
    expect(convoy.toProvince).toBe(MIDDLE);
    expect(sim.sightings(2)).toEqual([]);
  });

  it('never hides a seat’s own shipping from itself, even once the quay is gone', () => {
    // The only way to reach the rule. A convoy always leaves from a port in its owner's
    // own province, and that port watches its own lanes — so for as long as it stands,
    // "I own this convoy" and "I watch this lane" are the same answer and the first
    // draft of this test proved nothing. Burn the harbour behind the fleet and they come
    // apart: the owner still knows where its own army is, and nobody else does.
    const sim = channel([], [spearAtQuay()]);
    const convoy = sail(sim, MIDDLE);
    const quay = sim.buildings.all().find((b) => b.kind === BuildingKind.Port && b.owner === 1)!;
    sim.buildings.remove(quay.id);
    expect(sim.tick).toBeLessThan(convoy.arriveTick);

    expect(sim.seesLane(1, MIDDLE, ISLE)).toBe(false);
    const mine = sim.sightings(1);
    expect(mine).toHaveLength(1);
    expect(mine[0].own).toBe(true);
    expect(sim.sightings(2)).toEqual([]);
  });

  it('reports nothing at all when nothing is at sea', () => {
    const sim = channel([{ owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 48) }]);
    expect(sim.sightings(2)).toEqual([]);
  });
});

describe('a port reveals its own lanes, and only its own', () => {
  it('sees a crossing into the province it stands in', () => {
    const sim = channel([{ owner: 2, kind: BuildingKind.Port, cell: at(LAND_LAST_COL, 48) }], [spearAtQuay()]);
    sail(sim, MIDDLE);
    expect(sim.sightings(2).map((s) => s.toProvince)).toEqual([MIDDLE]);
  });

  it('is blind to the crossing one province along', () => {
    // The decisive pair. A harbour in the north and a crossing into the middle: hop zero
    // cannot see it, and the lighthouse test below puts a light on the same shore and
    // does. If both buildings reached equally far, one of these two tests must fail.
    const sim = channel([{ owner: 2, kind: BuildingKind.Port, cell: at(LAND_LAST_COL, 16) }], [spearAtQuay()]);
    sail(sim, MIDDLE);
    expect(sim.sightings(2)).toEqual([]);
    expect(sim.seesLane(2, NORTH, ISLE)).toBe(true);
    expect(sim.seesLane(2, MIDDLE, ISLE)).toBe(false);
  });
});

describe('a lighthouse reveals lanes within one province', () => {
  it('sees the crossing one province along', () => {
    const sim = channel([{ owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 16) }], [spearAtQuay()]);
    sail(sim, MIDDLE);
    expect(sim.sightings(2).map((s) => s.toProvince)).toEqual([MIDDLE]);
  });

  it('stops at one province, not at the coastline', () => {
    // South is two hops from the northern crossing. A light there watches the middle's
    // lane and not the north's, which is what makes the reach a number rather than
    // "everything I own".
    const sim = channel([{ owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 80) }], [spearAtQuay()]);
    sail(sim, NORTH);
    expect(sim.sightings(2)).toEqual([]);
    expect(sim.seesLane(2, MIDDLE, ISLE)).toBe(true);
    expect(sim.seesLane(2, NORTH, ISLE)).toBe(false);
  });

  it('sees nothing while it is still being built', () => {
    const sim = channel([{ owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 48) }], [spearAtQuay()]);
    const light = sim.buildings.all().find((b) => b.kind === BuildingKind.Lighthouse)!;
    light.complete = false;
    sail(sim, MIDDLE);
    expect(sim.sightings(2)).toEqual([]);
    light.complete = true;
    expect(sim.sightings(2)).toHaveLength(1);
  });

  it('goes dark the moment it burns, mid-crossing', () => {
    const sim = channel([{ owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 48) }], [spearAtQuay()]);
    const convoy = sail(sim, MIDDLE);
    expect(sim.sightings(2)).toHaveLength(1);

    const light = sim.buildings.all().find((b) => b.kind === BuildingKind.Lighthouse)!;
    sim.buildings.remove(light.id);
    expect(sim.tick).toBeLessThan(convoy.arriveTick);
    expect(sim.sightings(2)).toEqual([]);
  });

  it('belongs to its owner alone', () => {
    const sim = channel([{ owner: 1, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 48) }], [spearAtQuay()]);
    sail(sim, MIDDLE);
    expect(sim.sightings(2)).toEqual([]);
  });
});

describe('a scout on a beach reveals that beach’s lane', () => {
  const scoutOnIsleShore = (): Spawned => ({ owner: 2, kind: UnitKind.Scout, cell: at(ISLE_FIRST_COL, 70) });

  it('watches a shore its owner does not hold', () => {
    // The attacker's own blindness is the brief's point here, read the other way round:
    // seat 2 owns nothing on the isle, and a thirty-food scout standing on its beach sees
    // every hull that leaves it.
    const sim = channel([], [spearAtQuay(), scoutOnIsleShore()]);
    sail(sim, MIDDLE);
    expect(sim.sightings(2).map((s) => s.fromProvince)).toEqual([ISLE]);
  });

  it('sees nothing from inland', () => {
    const sim = channel([], [spearAtQuay(), { owner: 2, kind: UnitKind.Scout, cell: at(35, 70) }]);
    sail(sim, MIDDLE);
    expect(sim.sightings(2)).toEqual([]);
  });

  it('sees nothing once it is dead', () => {
    const sim = channel([], [spearAtQuay(), scoutOnIsleShore()]);
    sail(sim, MIDDLE);
    const scout = sim.entities.all().find((u) => u.kind === UnitKind.Scout)!;
    scout.hp = 0;
    expect(sim.sightings(2)).toEqual([]);
  });

  it('sees nothing while it is a passenger', () => {
    const sim = channel([], [spearAtQuay(), scoutOnIsleShore()]);
    sail(sim, MIDDLE);
    const scout = sim.entities.all().find((u) => u.kind === UnitKind.Scout)!;
    scout.convoy = 99;
    expect(sim.sightings(2)).toEqual([]);
  });

  it('is not a thing a soldier can do', () => {
    // "Scout | Vision" is a role in the roster, and the cheapest unit in the game buying
    // the same sight as a forty-timber light would make the light pointless.
    const sim = channel(
      [],
      [spearAtQuay(), { owner: 2, kind: UnitKind.Spear, cell: at(ISLE_FIRST_COL, 70) }],
    );
    sail(sim, MIDDLE);
    expect(sim.sightings(2)).toEqual([]);
  });
});

describe('what a sighting shows', () => {
  it('gives size, arrival and the beach — and no roster', () => {
    const sim = channel(
      [{ owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 48) }],
      [
        spearAtQuay(),
        { owner: 1, kind: UnitKind.Archer, cell: isleQuay },
        { owner: 1, kind: UnitKind.Ram, cell: isleQuay },
      ],
    );
    const port = sim.buildings.all().find((b) => b.kind === BuildingKind.Port)!;
    const beach = sim.beaches(MIDDLE, port.cell)[0];
    for (const unit of sim.entities.all().filter((u) => u.owner === 1)) {
      sim.issue({ type: 'embark', unit: unit.id, port: port.id, cell: beach });
    }
    sim.run(3);

    const seen = sim.sightings(2);
    expect(seen).toHaveLength(1);
    const sighting = seen[0];
    expect(sighting.size).toBe(3);
    expect(sighting.toCell).toBe(beach);
    expect(sighting.overBeach).toBe(true);
    expect(sighting.arriveTick).toBeGreaterThan(sighting.departTick);
    expect(sighting.own).toBe(false);
    // A watcher counts hulls. Which three of the roster are aboard is what the landing
    // tells you, and there is nothing in the sighting that could say.
    expect(Object.keys(sighting).sort()).toEqual(
      ['arriveTick', 'departTick', 'fromProvince', 'id', 'overBeach', 'own', 'owner', 'size', 'toCell', 'toProvince'],
    );
  });

  it('lists several crossings in launch order', () => {
    const sim = channel(
      [{ owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 48) }],
      [spearAtQuay(), { owner: 1, kind: UnitKind.Archer, cell: isleQuay }],
    );
    const port = sim.buildings.all().find((b) => b.kind === BuildingKind.Port)!;
    const beaches = sim.beaches(MIDDLE, port.cell);
    const [spear, archer] = sim.entities.all().filter((u) => u.owner === 1);
    sim.issue({ type: 'embark', unit: spear.id, port: port.id, cell: beaches[0] });
    sim.run(3);
    sim.issue({ type: 'embark', unit: archer.id, port: port.id, cell: beaches[1] });
    sim.run(3);

    const seen = sim.sightings(2);
    expect(seen.map((s) => s.id)).toEqual([1, 2]);
    // The brief's decoy: two convoys, two doors, and the defender has to choose.
    expect(seen[0].toCell).not.toBe(seen[1].toCell);
  });
});

describe('building a lighthouse', () => {
  function villagerAt(cell: number): Sim {
    return channel([], [{ owner: 2, kind: UnitKind.Villager, cell }]);
  }

  it('needs a coast', () => {
    const sim = villagerAt(at(5, 48));
    const villager = sim.entities.all()[0];
    sim.issue({ type: 'build', unit: villager.id, kind: BuildingKind.Lighthouse, cell: at(5, 48) });
    sim.run(3);
    expect(sim.buildings.all().some((b) => b.kind === BuildingKind.Lighthouse)).toBe(false);
  });

  it('does not need a lane of its own, unlike a port', () => {
    // South has no lane. A harbour there would be eighty timber facing nothing; a light
    // there watches the middle's crossing, which is the entire reason the reach exists.
    const shore = at(LAND_LAST_COL, 80);
    const sim = villagerAt(shore);
    const villager = sim.entities.all()[0];
    expect(sim.lanesFrom(SOUTH)).toEqual([]);

    sim.issue({ type: 'build', unit: villager.id, kind: BuildingKind.Port, cell: shore });
    sim.run(3);
    expect(sim.buildings.all().some((b) => b.kind === BuildingKind.Port && b.owner === 2)).toBe(false);

    sim.issue({ type: 'build', unit: villager.id, kind: BuildingKind.Lighthouse, cell: shore });
    sim.run(3);
    expect(sim.buildings.all().some((b) => b.kind === BuildingKind.Lighthouse)).toBe(true);
  });

  it('costs what the brief prices it at', () => {
    const shore = at(LAND_LAST_COL, 48);
    const sim = villagerAt(shore);
    const villager = sim.entities.all()[0];
    const before = { timber: sim.players.get(2)!.timber, silver: sim.players.get(2)!.silver };
    sim.issue({ type: 'build', unit: villager.id, kind: BuildingKind.Lighthouse, cell: shore });
    sim.run(3);
    expect(before.timber - sim.players.get(2)!.timber).toBe(40);
    expect(before.silver - sim.players.get(2)!.silver).toBe(20);
  });
});

describe('the watch list', () => {
  it('is the union of every watcher a seat owns', () => {
    const sim = channel([
      { owner: 2, kind: BuildingKind.Port, cell: at(LAND_LAST_COL, 16) },
      { owner: 2, kind: BuildingKind.Lighthouse, cell: at(LAND_LAST_COL, 80) },
    ]);
    const lanes = revealedLanes(
      {
        entities: sim.entities,
        buildings: sim.buildings,
        grid: sim.terrain!,
        geography: buildProvinceGeography(coastAndIsle()),
        lanesFrom: (p) => sim.lanesFrom(p),
      },
      2,
    );
    // The harbour brings the north's lane, the southern light brings the middle's, and
    // between them seat 2 watches the whole coast without a light on it.
    expect([...lanes].sort((a, b) => a - b)).toEqual(
      [laneKey(NORTH, ISLE), laneKey(MIDDLE, ISLE)].sort((a, b) => a - b),
    );
  });

});
