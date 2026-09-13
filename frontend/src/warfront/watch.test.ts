import { describe, it, expect } from 'vitest';
import {
  Biome,
  BuildingKind,
  FIRST_RAID_TICK,
  RAID_DURATION_TICKS,
  Sim,
  TerrainGrid,
  UnitKind,
  cellCentre,
  packCell,
} from '@borderfall/warfront-sim';
import { MatchWatch } from './watch';

/**
 * The tribes test map, from the simulation's own suite: three provinces of ten cells on
 * row 1, wide enough that the seat's six-cell reach does not cover the frontier — so a
 * raid can actually land instead of being shot on arrival.
 */
const WIDTH = 32;
const ROW = 1;

function testGrid(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * 3).fill(sea);
  for (let c = 0; c < 30; c++) {
    cells[ROW * WIDTH + c] = packCell({
      owner: c < 10 ? 1 : c < 20 ? 2 : 3,
      tier: 0,
      passable: true,
      biome: Biome.Plains,
    });
  }
  return new TerrainGrid(WIDTH, 3, cells, {
    provinces: [
      { index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 2, territory_id: 'belgica', name: 'Gallia Belgica' },
      { index: 3, territory_id: 'germania', name: 'Germania Inferior' },
    ],
  });
}

const cellAt = (col: number) => ROW * WIDTH + col;

function matchSim(options: { villagerCols?: number[]; farm?: boolean; food?: number } = {}) {
  return new Sim({
    seed: 5,
    terrain: testGrid(),
    scenario: {
      players: [{ index: 1, food: options.food ?? 100000, timber: 500, silver: 100 }],
      buildings: [
        { owner: 1, kind: BuildingKind.Seat, cell: cellAt(1) },
        ...(options.farm ? [{ owner: 1, kind: BuildingKind.Farm as 3, cell: cellAt(8) }] : []),
      ],
      units: (options.villagerCols ?? []).map((col) => ({
        owner: 1,
        kind: UnitKind.Villager,
        x: cellCentre(col),
        y: cellCentre(ROW),
        speed: 0,
      })),
    },
  });
}

/** Runs to `tick`, polling as the page does, and returns every alert raised on the way. */
function watchTo(sim: Sim, watch: MatchWatch, tick: number, every = 10) {
  const seen: ReturnType<MatchWatch['poll']> = [];
  watch.poll(sim, 1);
  while (sim.tick < tick) {
    sim.run(Math.min(every, tick - sim.tick));
    seen.push(...watch.poll(sim, 1));
  }
  return seen;
}

describe('MatchWatch', () => {
  it('says nothing about the opening position', () => {
    const sim = matchSim({ villagerCols: [8] });
    expect(new MatchWatch().poll(sim, 1)).toEqual([]);
  });

  it('reports raiders the moment they cross into your land, once each', () => {
    const sim = matchSim({ farm: true });
    const alerts = watchTo(sim, new MatchWatch(), FIRST_RAID_TICK + RAID_DURATION_TICKS);
    const raids = alerts.filter((a) => a.kind === 'raid');
    expect(raids.length).toBeGreaterThan(0);
    expect(raids[0].message).toMatch(/Raiders in Gallia Lugdunensis/);
    // Exactly one alert per raider that crossed, across ninety polls — the watch must not
    // lean on the alert queue's dedupe to avoid flooding the player.
    const raiders = [...sim.entities.all()].filter((u) => u.owner === 0);
    expect(raiders.length).toBeGreaterThan(0);
    expect(raids).toHaveLength(raiders.length);
    // And nothing further while the same raiders are still standing there.
    const watch = new MatchWatch();
    watch.poll(sim, 1);
    expect(watchTo(sim, watch, sim.tick + 100).filter((a) => a.kind === 'raid')).toEqual([]);
  });

  it('points the jump key at the cell the raiders are actually on', () => {
    const sim = matchSim({ farm: true });
    const alerts = watchTo(sim, new MatchWatch(), FIRST_RAID_TICK + RAID_DURATION_TICKS);
    const raid = alerts.find((a) => a.kind === 'raid')!;
    expect(sim.terrain!.owner(raid.cell)).toBe(1);
  });

  it('reports villagers killed, and where they fell', () => {
    const sim = matchSim({ farm: true, villagerCols: [8] });
    const alerts = watchTo(sim, new MatchWatch(), FIRST_RAID_TICK + RAID_DURATION_TICKS);
    const loss = alerts.find((a) => a.kind === 'loss');
    expect(loss).toBeDefined();
    expect(loss!.cell).toBe(cellAt(8));
    expect(sim.entities.get(1)).toBeUndefined();
  });

  it('reports a seat that falls, and the province that goes with it', () => {
    const sim = matchSim();
    const watch = new MatchWatch();
    watch.poll(sim, 1);
    sim.damageBuilding(1, 99999);
    sim.run(2);
    const alerts = watch.poll(sim, 1);
    const seat = alerts.find((a) => a.kind === 'seat')!;
    expect(seat.message).toMatch(/Gallia Lugdunensis has fallen/);
    expect(seat.cell).toBe(cellAt(1));
    // Once only: the province is already gone, so there is nothing new to say.
    sim.run(30);
    expect(watch.poll(sim, 1).filter((a) => a.kind === 'seat')).toEqual([]);
  });

  it('reports hunger on the edge, not every tick it lasts', () => {
    const sim = matchSim({ villagerCols: [1, 2], food: 0 });
    const watch = new MatchWatch();
    watch.poll(sim, 1);
    const alerts = watchTo(sim, watch, 1000);
    expect(alerts.filter((a) => a.kind === 'hunger')).toHaveLength(1);
  });

  it('attaches to a match already in progress without shouting about its history', () => {
    // A watch built mid-match — which is what step 4's lab will do — must report what
    // happens NEXT, not greet the player with every raider already standing in their land.
    const sim = matchSim({ farm: true });
    sim.runTo(FIRST_RAID_TICK + RAID_DURATION_TICKS);
    expect([...sim.entities.all()].some((u) => u.owner === 0)).toBe(true);
    const late = new MatchWatch();
    expect(late.poll(sim, 1)).toEqual([]);
    // And it still reports the next thing that actually changes.
    sim.damageBuilding(1, 99999);
    sim.run(2);
    expect(late.poll(sim, 1).some((a) => a.kind === 'seat')).toBe(true);
  });

  it('says nothing about a quiet match', () => {
    const sim = matchSim({ villagerCols: [1] });
    expect(watchTo(sim, new MatchWatch(), FIRST_RAID_TICK - 1)).toEqual([]);
  });
});
