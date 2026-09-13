import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import { MATCH_CAP_MINUTES_FOUR, MATCH_CAP_MINUTES_TWO, majorityOf, matchCapTicks } from './scoring';
import { BuildingKind, TICKS_PER_MINUTE, UnitKind } from './rules';

/** Four one-cell-wide provinces in a row, so ownership is trivial to arrange. */
const WIDTH = 16;
const ROW = 1;

function testGrid(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * 3).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    cells[ROW * WIDTH + c] = packCell({ owner: Math.floor(c / 4) + 1, tier: 0, passable: true, biome: Biome.Plains });
  }
  return new TerrainGrid(WIDTH, 3, cells, {
    provinces: [
      { index: 1, territory_id: 'a', name: 'A' },
      { index: 2, territory_id: 'b', name: 'B' },
      { index: 3, territory_id: 'c', name: 'C' },
      { index: 4, territory_id: 'd', name: 'D' },
    ],
  });
}

const cellAt = (col: number) => ROW * WIDTH + col;

/**
 * `seats` places one seat building per entry. A province is bound to its seat by the
 * constructor (and by colonising, and by a claim) — never by dropping a building on it —
 * so a test that wants a seat to HOLD a second province declares both here.
 */
function scoringSim(seats: Array<{ index: number; col: number }>, villagerCols: number[] = []) {
  const players = [...new Set(seats.map((s) => s.index))].sort((a, b) => a - b);
  return new Sim({
    seed: 1,
    terrain: testGrid(),
    scenario: {
      players: players.map((index) => ({ index, food: 10000, timber: 100, silver: 0 })),
      buildings: seats.map((s) => ({ owner: s.index, kind: BuildingKind.Seat, cell: cellAt(s.col) })),
      units: villagerCols.map((col) => ({
        owner: 1,
        kind: UnitKind.Villager,
        x: cellCentre(col),
        y: cellCentre(ROW),
        speed: 0,
      })),
    },
  });
}

describe('matchCapTicks', () => {
  it("uses decision 30's two fixed points", () => {
    expect(matchCapTicks(2)).toBe(TICKS_PER_MINUTE * MATCH_CAP_MINUTES_TWO);
    expect(matchCapTicks(4)).toBe(TICKS_PER_MINUTE * MATCH_CAP_MINUTES_FOUR);
  });

  it('scales linearly between them, so three seats is not an invented number', () => {
    expect(matchCapTicks(3)).toBe((matchCapTicks(2) + matchCapTicks(4)) / 2);
    expect(Number.isInteger(matchCapTicks(3))).toBe(true);
  });

  it('never goes below the two-seat cap', () => {
    expect(matchCapTicks(1)).toBe(matchCapTicks(2));
    expect(matchCapTicks(0)).toBe(matchCapTicks(2));
  });
});

describe('majorityOf', () => {
  it('is more than half, never exactly half', () => {
    expect(majorityOf(20)).toBe(11);
    expect(majorityOf(4)).toBe(3);
    expect(majorityOf(3)).toBe(2);
    expect(majorityOf(1)).toBe(1);
  });
});

describe('province-ticks', () => {
  it('banks one tick per province held, every tick', () => {
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }]);
    sim.run(100);
    expect(sim.players.get(1)!.provinceTicks).toBe(100);
    expect(sim.players.get(2)!.provinceTicks).toBe(100);
  });

  it('pays double for two provinces, which is what makes early ground worth holding', () => {
    const sim = scoringSim([
      { index: 1, col: 1 },
      { index: 1, col: 5 },
      { index: 2, col: 9 },
    ]);
    sim.run(100);
    expect(sim.players.get(1)!.provinceTicks).toBe(200);
    expect(sim.players.get(2)!.provinceTicks).toBe(100);
  });

  it('stops banking the tick a province is lost', () => {
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }]);
    sim.run(50);
    const banked = sim.players.get(1)!.provinceTicks;
    sim.damageBuilding(1, 99999);
    sim.run(50);
    // One more tick is banked before territory notices the seat is gone, and none after.
    expect(sim.players.get(1)!.provinceTicks).toBeLessThanOrEqual(banked + 1);
  });

  it('is reported in minutes too, floored', () => {
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }]);
    sim.run(TICKS_PER_MINUTE * 3 + 10);
    expect(sim.standings.find((s) => s.seat === 1)!.provinceMinutes).toBe(3);
  });
});

describe('matchResult', () => {
  it('is not over while the clock runs and nobody has a majority', () => {
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }]);
    sim.run(10);
    expect(sim.result).toMatchObject({ over: false, reason: null, winner: 0 });
  });

  it('ends outright on a majority of every province on the map', () => {
    // Two of four is not a majority; three is.
    const two = scoringSim([{ index: 1, col: 1 }, { index: 1, col: 5 }, { index: 2, col: 13 }]);
    two.run(2);
    expect(two.result.over).toBe(false);

    const three = scoringSim([
      { index: 1, col: 1 },
      { index: 1, col: 5 },
      { index: 1, col: 9 },
      { index: 2, col: 13 },
    ]);
    three.run(2);
    expect(three.result).toMatchObject({ over: true, reason: 'majority', winner: 1 });
  });

  it('ends when only one seat is left standing', () => {
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }]);
    sim.run(2);
    sim.damageBuilding(2, 99999);
    sim.run(2);
    expect(sim.result).toMatchObject({ over: true, reason: 'last-standing', winner: 1 });
  });

  it('keeps a seat alive while it still has a villager to claim with', () => {
    // Rule III: a seat that lost its capital is down, not out — elimination is slow by
    // design, and a villager is the way back.
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }], []);
    sim.entities.spawn({ owner: 2, kind: UnitKind.Villager, x: cellCentre(5), y: cellCentre(ROW), speed: 0 });
    sim.run(2);
    sim.damageBuilding(2, 99999);
    sim.run(2);
    expect(sim.result.over).toBe(false);
    expect(sim.standings.find((s) => s.seat === 2)!.eliminated).toBe(false);
  });

  it('ends at the cap, placing by provinces held', () => {
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 1, col: 5 }, { index: 2, col: 13 }]);
    sim.runTo(matchCapTicks(2));
    const result = sim.result;
    expect(result).toMatchObject({ over: true, reason: 'cap', winner: 1 });
    expect(result.standings.map((s) => s.seat)).toEqual([1, 2]);
    expect(result.standings[0].place).toBe(1);
  });

  it('breaks a tie on provinces with cumulative province-minutes', () => {
    // Seat 2 holds a second province for a while, then loses it — it ends level on
    // provinces but ahead on the ground it held.
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }, { index: 2, col: 9 }]);
    const extra = sim.buildings.all().find((b) => b.owner === 2 && b.cell === cellAt(9))!;
    sim.run(500);
    sim.damageBuilding(extra.id, 99999);
    sim.runTo(matchCapTicks(2));
    const result = sim.result;
    expect(result.standings[0].seat).toBe(2);
    expect(result.standings[0].provinces).toBe(result.standings[1].provinces);
    expect(result.standings[0].provinceTicks).toBeGreaterThan(result.standings[1].provinceTicks);
    expect(result.winner).toBe(2);
  });

  it('declares no winner when the leaders tie on both keys', () => {
    const sim = scoringSim([{ index: 1, col: 1 }, { index: 2, col: 5 }]);
    sim.runTo(matchCapTicks(2));
    const result = sim.result;
    expect(result.reason).toBe('cap');
    expect(result.winner).toBe(0);
  });
});
