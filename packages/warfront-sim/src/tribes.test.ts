import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import { buildProvinceGeography, firstRaidTick, raidSize } from './tribes';
import {
  BuildingKind,
  RAID_BASE_SIZE,
  RAID_DURATION_TICKS,
  RAID_INTERVAL_TICKS,
  RAID_LOOT_SILVER,
  RAID_MARCH_LIMIT_TICKS,
  RAID_MAX_SIZE,
  RAID_SIZE_PER_MINUTE,
  RAIDER_KIND,
  TICKS_PER_MINUTE,
  UnitKind,
} from './rules';

/**
 * A 32x5 map. Row 1 is a land bridge of three touching provinces, ten cells each; row 3
 * is an island province reachable only by sea, which is how a province with no land
 * border gets tested without inventing a second asset.
 *
 *   row 1:  1 x10 | 2 x10 | 3 x10
 *   row 3:                     4 4 4        (island, open water all round)
 *
 * Ten cells a province is the point, not decoration: a seat is armed out to six cells, so
 * a narrower province would let the seat shoot every raider the moment it crossed the
 * frontier and a test meaning to watch a raid would be watching target practice instead.
 */
const WIDTH = 32;
const ROW = 1;

function testGrid(): TerrainGrid {
  const height = 5;
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * height).fill(sea);
  for (let c = 0; c < 30; c++) {
    const province = c < 10 ? 1 : c < 20 ? 2 : 3;
    cells[ROW * WIDTH + c] = packCell({ owner: province, tier: 0, passable: true, biome: Biome.Plains });
  }
  // The island sits on row 3, leaving row 2 as open water between it and the mainland.
  for (let c = 25; c < 28; c++) {
    cells[3 * WIDTH + c] = packCell({ owner: 4, tier: 0, passable: true, biome: Biome.Plains });
  }
  return new TerrainGrid(WIDTH, height, cells, {
    provinces: [
      { index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 2, territory_id: 'belgica', name: 'Gallia Belgica' },
      { index: 3, territory_id: 'germania', name: 'Germania Inferior' },
      { index: 4, territory_id: 'britannia', name: 'Britannia' },
    ],
  });
}

const cellAt = (col: number, row = ROW) => row * WIDTH + col;

/**
 * Gaul settled in province 1 with whatever villagers a test wants, and provinces 2-4 left
 * neutral — which makes every one of them a tribe's home.
 */
function raidSim(
  options: {
    villagerCols?: number[];
    silver?: number;
    seatCol?: number;
    farmCol?: number;
    extra?: Array<{ kind: number; col: number }>;
  } = {},
) {
  const cols = options.villagerCols ?? [];
  const seatCol = options.seatCol ?? 1;
  return new Sim({
    seed: 7,
    terrain: testGrid(),
    scenario: {
      players: [{ index: 1, food: 100000, timber: 500, silver: options.silver ?? 0 }],
      buildings: [
        { owner: 1, kind: BuildingKind.Seat, cell: cellAt(seatCol) },
        ...(options.farmCol === undefined
          ? []
          : [{ owner: 1, kind: BuildingKind.Farm, cell: cellAt(options.farmCol) }]),
        ...(options.extra ?? []).map((b) => ({ owner: 1, kind: b.kind as 1, cell: cellAt(b.col) })),
      ],
      units: cols.map((col) => ({
        owner: 1,
        kind: UnitKind.Villager,
        x: cellCentre(col),
        y: cellCentre(ROW),
        speed: 0,
      })),
    },
  });
}

const raiders = (sim: Sim) => [...sim.entities.all()].filter((u) => u.owner === 0);

/**
 * When province 2 — the only tribe that borders settled Gaul on this map — first musters.
 * Tribes are staggered so minute two brings one raid rather than one per frontier, so a
 * test asking "has the raid landed" must ask about a PARTICULAR tribe's clock.
 */
const RAIDER_TRIBE_DUE = firstRaidTick(2);

describe('buildProvinceGeography', () => {
  const geography = buildProvinceGeography(testGrid());

  it('derives land adjacency from touching passable cells, with no map document', () => {
    expect(geography.neighbours.get(1)).toEqual([2]);
    expect(geography.neighbours.get(2)).toEqual([1, 3]);
    expect(geography.neighbours.get(3)).toEqual([2]);
  });

  it('gives a province reachable only by sea no land neighbours at all', () => {
    expect(geography.neighbours.get(4)).toEqual([]);
  });

  it('puts each border cell on its own side of the frontier', () => {
    // A raid musters on the tribe's land and lands on the victim's, one cell apart.
    expect(geography.border.get(2)!.get(1)).toBe(cellAt(10));
    expect(geography.border.get(1)!.get(2)).toBe(cellAt(9));
    expect(geography.border.get(2)!.get(3)).toBe(cellAt(19));
    expect(geography.border.get(3)!.get(2)).toBe(cellAt(20));
  });
});

describe('raidSize', () => {
  it('starts at one raider and grows with the clock', () => {
    expect(raidSize(0, 0)).toBe(RAID_BASE_SIZE);
    expect(raidSize(TICKS_PER_MINUTE * RAID_SIZE_PER_MINUTE, 0)).toBe(RAID_BASE_SIZE + 1);
    expect(raidSize(TICKS_PER_MINUTE * RAID_SIZE_PER_MINUTE * 2, 0)).toBe(RAID_BASE_SIZE + 2);
  });

  it('grows with the victim, which is the half that punishes a turtle', () => {
    // Counted from the SECOND province: holding the one you started in is not expansion,
    // and taxing it doubled the very first raid of every match.
    expect(raidSize(0, 1)).toBe(RAID_BASE_SIZE);
    expect(raidSize(0, 3)).toBe(RAID_BASE_SIZE + 2);
    expect(raidSize(0, 3)).toBeGreaterThan(raidSize(0, 1));
  });

  it('never becomes an army', () => {
    expect(raidSize(TICKS_PER_MINUTE * 60, 40)).toBe(RAID_MAX_SIZE);
  });
});

describe('raids (rule VI)', () => {
  it('sends nobody before minute two', () => {
    const sim = raidSim();
    sim.runTo(RAIDER_TRIBE_DUE - 1);
    expect(raiders(sim)).toHaveLength(0);
    expect(sim.tribes.activeRaiders()).toHaveLength(0);
  });

  it('musters on the frontier at minute two, from the settled neighbour only', () => {
    const sim = raidSim();
    sim.runTo(RAIDER_TRIBE_DUE);
    const out = raiders(sim);
    // Province 2 borders settled Gaul and raids it. Province 3 borders only neutral
    // ground and province 4 is an island, so neither sends anybody.
    expect(out).toHaveLength(raidSize(RAIDER_TRIBE_DUE, 1));
    for (const raider of out) expect(raider.kind).toBe(RAIDER_KIND);
    // Mustered on province 2's own side of the frontier, not somewhere in its interior.
    expect(sim.tribes.activeRaiders().every((r) => r.homeCell === cellAt(10))).toBe(true);
    expect(sim.terrain!.owner(cellAt(10))).toBe(2);
  });

  it('waits the full interval before mustering the next one', () => {
    const sim = raidSim();
    sim.runTo(RAIDER_TRIBE_DUE);
    expect(raiders(sim).length).toBeGreaterThan(0);
    expect(sim.tribes.home(2)!.nextRaidTick).toBe(RAIDER_TRIBE_DUE + RAID_INTERVAL_TICKS);
    // The first raid is home and disbanded by now (see the retreat test below), so the
    // map is empty right up to the tick the next one is due.
    sim.runTo(RAIDER_TRIBE_DUE + RAID_INTERVAL_TICKS - 1);
    expect(raiders(sim)).toHaveLength(0);
    sim.runTo(RAIDER_TRIBE_DUE + RAID_INTERVAL_TICKS);
    expect(raiders(sim).length).toBeGreaterThan(0);
  });

  it("aims at the border farm — the brief's own beat — and not at the seat behind it", () => {
    const sim = raidSim({ farmCol: 8, villagerCols: [8], silver: 100 });
    sim.runTo(RAIDER_TRIBE_DUE + 1);
    const farmCentre = cellCentre(8);
    // Every raider is walking at the farm, which is nearer the frontier than the seat.
    expect(sim.tribes.activeRaiders().length).toBeGreaterThan(0);
    for (const raider of raiders(sim)) expect(raider.goalX).toBe(farmCentre);
  });

  it('goes past a nearer tower to reach the workers behind it', () => {
    // The tower sits on the frontier and the farm four cells behind it. A raid is after
    // villagers, not walls: "skirmishers on your lumber camps" is the brief's own beat.
    const sim = raidSim({ farmCol: 4, extra: [{ kind: BuildingKind.Tower, col: 9 }] });
    sim.runTo(RAIDER_TRIBE_DUE + 1);
    expect(sim.tribes.activeRaiders().length).toBeGreaterThan(0);
    for (const raider of raiders(sim)) expect(raider.goalX).toBe(cellCentre(4));
  });

  it('takes the nearest of several equal targets', () => {
    const sim = raidSim({ farmCol: 4, extra: [{ kind: BuildingKind.Farm, col: 8 }] });
    sim.runTo(RAIDER_TRIBE_DUE + 1);
    expect(sim.tribes.activeRaiders().length).toBeGreaterThan(0);
    for (const raider of raiders(sim)) expect(raider.goalX).toBe(cellCentre(8));
  });

  it('kills the villagers working it, and takes loot', () => {
    const sim = raidSim({ farmCol: 8, villagerCols: [8], silver: 100 });
    sim.runTo(RAIDER_TRIBE_DUE + RAID_DURATION_TICKS);
    expect(sim.entities.get(1)).toBeUndefined();
    expect(sim.players.get(1)!.silver).toBe(100 - RAID_LOOT_SILVER);
  });

  it('never takes more loot than the victim has', () => {
    const sim = raidSim({ farmCol: 8, villagerCols: [8], silver: 0 });
    sim.runTo(RAIDER_TRIBE_DUE + RAID_DURATION_TICKS);
    expect(sim.entities.get(1)).toBeUndefined();
    expect(sim.players.get(1)!.silver).toBe(0);
  });

  it('retreats: every raider goes home and the tribe keeps no standing army', () => {
    const sim = raidSim({ farmCol: 8 });
    sim.runTo(RAIDER_TRIBE_DUE + 1);
    expect(raiders(sim).length).toBeGreaterThan(0);
    // March in, loot for a minute, march out — comfortably inside one raid interval on
    // this map, and none of them shot: the farm is beyond the seat's six cells.
    sim.runTo(RAIDER_TRIBE_DUE + RAID_INTERVAL_TICKS - 1);
    expect(raiders(sim)).toHaveLength(0);
    expect(sim.tribes.activeRaiders()).toHaveLength(0);
  });

  it('walks into the guns when the seat is the only thing to raid', () => {
    // No farm: the nearest thing worth hitting is the seat itself, which is armed.
    const sim = raidSim();
    sim.runTo(RAIDER_TRIBE_DUE + RAID_MARCH_LIMIT_TICKS);
    expect(raiders(sim)).toHaveLength(0);
    expect(sim.buildings.get(1)!.hp).toBe(1500);
  });

  it('ends a source when its home is colonised, with no rule of its own', () => {
    const sim = raidSim({ villagerCols: [3] });
    // Walk the villager into province 2 and plant a seat there.
    sim.issue({ type: 'move', unit: 1, x: cellCentre(15), y: cellCentre(ROW) });
    sim.entities.get(1)!.speed = 1 << 16;
    sim.runTo(200);
    sim.issue({ type: 'colonise', unit: 1, province: 2 });
    sim.runTo(210);
    expect(sim.provinces.get(2)!.owner).toBe(1);

    // Province 3's own clock, not province 2's: tribes are staggered, and province 3 is
    // the one that raids now.
    sim.runTo(firstRaidTick(3) + 1);
    // Province 2 is settled, so it musters nothing. Province 3 now borders settled land,
    // so the frontier has simply moved — which is the rule working, not failing.
    expect(sim.tribes.activeRaiders().length).toBeGreaterThan(0);
    expect(sim.tribes.activeRaiders().every((r) => r.homeCell === cellAt(20))).toBe(true);
  });

  it('writes off a raider that can never reach its target OR get home again', () => {
    const sim = raidSim({ farmCol: 8 });
    // Let the raid get under way, then freeze one raider partway across — out of its own
    // muster cell, out of the seat's reach, and unable ever to arrive or walk back.
    sim.runTo(RAIDER_TRIBE_DUE + 20);
    const stranded = raiders(sim)[0];
    stranded.speed = 0;
    const record = sim.tribes.activeRaiders().find((r) => r.unit === stranded.id)!;
    expect(sim.terrain!.index(stranded.x >> 16, ROW)).not.toBe(record.homeCell);
    // It gives up marching in at one limit and is written off a limit after that. Without
    // the second deadline it would haunt the map for the rest of the match.
    sim.runTo(RAIDER_TRIBE_DUE + 2 * RAID_MARCH_LIMIT_TICKS - 1);
    expect(sim.entities.get(stranded.id)).toBeDefined();
    sim.step();
    expect(sim.entities.get(stranded.id)).toBeUndefined();
    expect(sim.tribes.activeRaiders().some((r) => r.unit === stranded.id)).toBe(false);
  });
});

describe('determinism', () => {
  it('replays a raid to the same hash, twice', () => {
    const run = () => {
      const sim = raidSim({ farmCol: 8, villagerCols: [8, 9], silver: 100 });
      sim.runTo(RAIDER_TRIBE_DUE + RAID_INTERVAL_TICKS);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });

  it('hashes the raid itself, so a lost raider is a divergence and not a rounding error', () => {
    const sim = raidSim();
    sim.runTo(RAIDER_TRIBE_DUE);
    const before = sim.hash();
    sim.tribes.dropRaider(sim.tribes.activeRaiders()[0].unit);
    expect(sim.hash()).not.toBe(before);
  });
});
