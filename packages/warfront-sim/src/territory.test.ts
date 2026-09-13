import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import { colonisePrice } from './territory';
import { BuildingKind, CLAIM_TICKS, COLONISE_BASE_FOOD, UnitKind } from './rules';

/**
 * A 12x3 strip split into three provinces along row 1, so a villager can walk from one
 * into the next:
 *
 *   col:  0 1 2 3 | 4 5 6 7 | 8 9 10 11
 *   prov:    1        2          3
 */
const WIDTH = 12;

function testGrid(): TerrainGrid {
  const height = 3;
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * height).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    const province = c < 4 ? 1 : c < 8 ? 2 : 3;
    cells[1 * WIDTH + c] = packCell({ owner: province, tier: 0, passable: true, biome: Biome.Plains });
  }
  return new TerrainGrid(WIDTH, height, cells, {
    provinces: [
      { index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 2, territory_id: 'belgica', name: 'Belgica' },
      { index: 3, territory_id: 'aquitania', name: 'Aquitania' },
    ],
  });
}

const cellAt = (col: number) => 1 * WIDTH + col;

/** One seat in province 1 at column 1, and villagers wherever you put them. */
function territorySim(options: { villagerCols?: number[]; food?: number; owners?: number[] } = {}) {
  const cols = options.villagerCols ?? [1];
  const owners = options.owners ?? cols.map(() => 1);
  return new Sim({
    seed: 1,
    terrain: testGrid(),
    scenario: {
      players: [
        { index: 1, food: options.food ?? 1000, timber: 100, silver: 0 },
        { index: 2, food: options.food ?? 1000, timber: 100, silver: 0 },
      ],
      buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: cellAt(1) }],
      units: cols.map((col, i) => ({
        owner: owners[i],
        kind: UnitKind.Villager,
        x: cellCentre(col),
        y: cellCentre(1),
        speed: 1 << 14,
      })),
    },
  });
}

describe('colonisePrice (rule I)', () => {
  it("starts at the brief's 80 food and compounds by about 1.4", () => {
    expect(colonisePrice(0)).toBe(COLONISE_BASE_FOOD);
    expect(colonisePrice(1)).toBe(112);
    expect(colonisePrice(2)).toBe(156);
    expect(colonisePrice(3)).toBe(218);
  });

  it('never decreases, so the leader always pays more than the small player', () => {
    let previous = 0;
    for (let held = 0; held < 20; held++) {
      const price = colonisePrice(held);
      expect(price).toBeGreaterThanOrEqual(previous);
      expect(Number.isInteger(price)).toBe(true);
      previous = price;
    }
  });
});

describe('starting seats (rule III)', () => {
  it('a starting seat owns the province it stands in, from tick zero', () => {
    const sim = territorySim();
    expect(sim.provinces.get(1)!.owner).toBe(1);
    expect(sim.provinces.get(1)!.seat).toBe(1);
    expect(sim.provinces.get(2)!.owner).toBe(0);
    expect(sim.provinces.heldBy(1)).toBe(1);
  });
});

describe('colonising (rule I)', () => {
  it('plants a seat, takes the province and charges the rising price', () => {
    const sim = territorySim({ villagerCols: [5] }); // standing in province 2
    const before = sim.players.get(1)!.food;
    const price = sim.colonisePriceFor(1);
    expect(price).toBe(112); // one province already held

    sim.issue({ type: 'colonise', unit: 1, province: 2 });
    sim.run(3);

    expect(sim.provinces.get(2)!.owner).toBe(1);
    expect(sim.buildings.atCell(cellAt(5))!.kind).toBe(BuildingKind.Seat);
    expect(sim.players.get(1)!.food).toBe(before - price);
    // And the next one costs more again.
    expect(sim.colonisePriceFor(1)).toBe(156);
  });

  it('refuses when the food is not there', () => {
    const sim = territorySim({ villagerCols: [5], food: 50 });
    sim.issue({ type: 'colonise', unit: 1, province: 2 });
    sim.run(3);
    expect(sim.provinces.get(2)!.owner).toBe(0);
    expect(sim.players.get(1)!.food).toBe(50);
  });

  it('refuses a province that already has a seat', () => {
    const sim = territorySim({ villagerCols: [1] }); // standing in its own province
    const before = sim.players.get(1)!.food;
    sim.issue({ type: 'colonise', unit: 1, province: 1 });
    sim.run(3);
    expect(sim.players.get(1)!.food).toBe(before);
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Seat)).toHaveLength(1);
  });

  it('refuses anything that is not a villager', () => {
    const sim = territorySim({ villagerCols: [5] });
    const scout = sim.entities.spawn({ owner: 1, kind: UnitKind.Scout, x: cellCentre(5), y: cellCentre(1), speed: 1 });
    sim.issue({ type: 'colonise', unit: scout.id, province: 2 });
    sim.run(3);
    expect(sim.provinces.get(2)!.owner).toBe(0);
  });
});

describe('losing a seat (rule III)', () => {
  it('a razed seat releases its province to neutral', () => {
    const sim = territorySim();
    const seat = sim.buildings.get(1)!;
    expect(sim.provinces.get(1)!.owner).toBe(1);
    sim.damageBuilding(seat.id, seat.hp);
    sim.run(1);
    expect(sim.buildings.get(1)).toBeUndefined();
    expect(sim.provinces.get(1)!.owner).toBe(0);
    expect(sim.provinces.get(1)!.seat).toBe(-1);
  });

  it('leaves nothing pointing at the rubble', () => {
    const sim = territorySim();
    const seat = sim.buildings.get(1)!;
    // Employ the villager at the seat's own cell so it holds a job on it.
    const farm = sim.buildings.place({ kind: BuildingKind.Farm, owner: 1, cell: cellAt(2), complete: true });
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    sim.run(3);
    sim.damageBuilding(farm.id, farm.hp);
    sim.run(1);
    expect(sim.entities.get(1)!.job).toBe(-1);
    expect(sim.damageBuilding(seat.id, 1)).toBeUndefined(); // still safe to call
  });
});

describe('claiming a razed province (rule III)', () => {
  function razedSim(options: { villagerCols: number[]; owners?: number[] }) {
    const sim = territorySim(options);
    sim.damageBuilding(1, 99999); // raze the starting seat
    sim.run(1);
    return sim;
  }

  it('takes 45 seconds with a villager present, then plants a seat', () => {
    const sim = razedSim({ villagerCols: [1] });
    expect(sim.provinces.get(1)!.owner).toBe(0);

    sim.run(CLAIM_TICKS - 2);
    expect(sim.provinces.get(1)!.owner).toBe(0); // not yet
    expect(sim.provinces.get(1)!.claimant).toBe(1);

    sim.run(3);
    const province = sim.provinces.get(1)!;
    expect(province.owner).toBe(1);
    expect(province.seat).toBeGreaterThan(0);
    expect(sim.buildings.get(province.seat)!.kind).toBe(BuildingKind.Seat);
    expect(province.claimTicks).toBe(0);
  });

  it('stalls while two empires both have villagers on the ground', () => {
    const sim = razedSim({ villagerCols: [1, 2], owners: [1, 2] });
    sim.run(CLAIM_TICKS + 50);
    // Contested: the claim is a fight worth having, not a race won by arriving first.
    expect(sim.provinces.get(1)!.owner).toBe(0);
    expect(sim.provinces.get(1)!.claimant).toBe(0);
    expect(sim.provinces.get(1)!.claimTicks).toBe(0);
  });

  it('resets when the claimant walks away', () => {
    const sim = razedSim({ villagerCols: [1] });
    sim.run(200);
    expect(sim.provinces.get(1)!.claimTicks).toBeGreaterThan(100);
    // Walk out of the province, into province 2.
    sim.issue({ type: 'move', unit: 1, x: cellCentre(6), y: cellCentre(1) });
    sim.run(3 + 4 * 5);
    expect(sim.provinces.get(1)!.claimTicks).toBe(0);
    expect(sim.provinces.get(1)!.claimant).toBe(0);
  });

  it('cannot be bought: a razed province is claimed, never colonised', () => {
    const sim = razedSim({ villagerCols: [1] });
    const before = sim.players.get(1)!.food;
    sim.issue({ type: 'colonise', unit: 1, province: 1 });
    sim.run(3);
    // Still neutral and still free: paying to skip the 45s would remove the window the
    // rule exists to give the defender.
    expect(sim.provinces.get(1)!.owner).toBe(0);
    expect(sim.players.get(1)!.food).toBe(before);
  });

  it('an enemy villager can take a province whose seat it razed', () => {
    const sim = razedSim({ villagerCols: [1], owners: [2] });
    sim.run(CLAIM_TICKS + 2);
    expect(sim.provinces.get(1)!.owner).toBe(2);
    expect(sim.provinces.heldBy(1)).toBe(0);
    expect(sim.provinces.heldBy(2)).toBe(1);
  });
});

describe('determinism', () => {
  it('a colonisation and a claim replay to the same hash', () => {
    const live = territorySim({ villagerCols: [5] });
    live.issue({ type: 'colonise', unit: 1, province: 2 });
    live.run(50);
    live.damageBuilding(1, 99999); // raze the original seat mid-match
    live.run(CLAIM_TICKS + 100);

    const replayed = Sim.fromReplay(live.toReplay(), testGrid());
    // The raze is a rules path rather than a command, so the replay re-applies it at the
    // same tick — which is exactly how a ram will drive it in the next step.
    replayed.run(50 + 2);
    replayed.damageBuilding(1, 99999);
    replayed.runTo(live.tick);
    expect(replayed.hash()).toBe(live.hash());
  });
});
