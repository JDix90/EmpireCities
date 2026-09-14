import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import { effectiveRange } from './combat';
import {
  BUILDING_COMBAT,
  BUILDING_SPECS,
  BuildingKind,
  COMBAT_SPECS,
  UNIT_SPECS,
  UnitKind,
  damageMultiplier,
  seconds,
  type UnitKindValue,
} from './rules';

/**
 * A 16x3 strip of passable plains on row 1, all one province, with two high-ground cells
 * at columns 10 and 11 so an archer can stand on a hill. Row 0 and row 2 are sea, which
 * keeps every fight one-dimensional and every distance easy to read.
 */
const WIDTH = 16;
const ROW = 1;
const HIGH_GROUND_COL = 10;

function testGrid(): TerrainGrid {
  const height = 3;
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * height).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    const high = c >= HIGH_GROUND_COL && c <= HIGH_GROUND_COL + 1;
    cells[ROW * WIDTH + c] = packCell({
      owner: 1,
      tier: high ? 1 : 0,
      passable: true,
      biome: high ? Biome.Highland : Biome.Plains,
    });
  }
  return new TerrainGrid(WIDTH, height, cells, {
    provinces: [{ index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' }],
  });
}

const cellAt = (col: number) => ROW * WIDTH + col;

interface Fighter {
  owner: number;
  kind: UnitKindValue;
  col: number;
}

/**
 * A match on the strip. Every unit has speed 0, so nothing walks and a test measures
 * combat alone. Generous stores, because starvation is the economy's business.
 */
function battle(fighters: Fighter[], buildings: Array<{ owner: number; kind: number; col: number }> = []) {
  return new Sim({
    seed: 1,
    terrain: testGrid(),
    scenario: {
      players: [
        { index: 1, food: 5000, timber: 500, silver: 500 },
        { index: 2, food: 5000, timber: 500, silver: 500 },
      ],
      buildings: buildings.map((b) => ({ owner: b.owner, kind: b.kind as 1, cell: cellAt(b.col) })),
      units: fighters.map((f) => ({
        owner: f.owner,
        kind: f.kind,
        x: cellCentre(f.col),
        y: cellCentre(ROW),
        speed: 0,
      })),
    },
  });
}

describe('damageMultiplier (the triangle)', () => {
  it('runs spear → cavalry → archer → spear, each at double into its prey', () => {
    expect(damageMultiplier(UnitKind.Spear, UnitKind.Cavalry)).toBe(200);
    expect(damageMultiplier(UnitKind.Cavalry, UnitKind.Archer)).toBe(200);
    expect(damageMultiplier(UnitKind.Archer, UnitKind.Spear)).toBe(200);
  });

  it('is even in the other direction, so the triangle is one-way', () => {
    expect(damageMultiplier(UnitKind.Cavalry, UnitKind.Spear)).toBe(100);
    expect(damageMultiplier(UnitKind.Archer, UnitKind.Cavalry)).toBe(100);
    expect(damageMultiplier(UnitKind.Spear, UnitKind.Archer)).toBe(100);
  });

  it('makes the skirmisher a raider: double on villagers, half on every soldier', () => {
    expect(damageMultiplier(UnitKind.Skirmisher, UnitKind.Villager)).toBe(200);
    expect(damageMultiplier(UnitKind.Skirmisher, UnitKind.Scout)).toBe(200);
    for (const kind of [UnitKind.Spear, UnitKind.Archer, UnitKind.Cavalry, UnitKind.Ram]) {
      expect(damageMultiplier(UnitKind.Skirmisher, kind)).toBe(50);
    }
  });
});

describe('effectiveRange (rule IV modifies the triangle)', () => {
  it('gives an archer its listed reach on the flat', () => {
    const sim = battle([{ owner: 1, kind: UnitKind.Archer, col: 1 }]);
    const archer = sim.entities.get(1)!;
    expect(effectiveRange(archer, sim.terrain!)).toBe(COMBAT_SPECS[UnitKind.Archer].range * 65536);
  });

  it('gives it one cell more on high ground', () => {
    const sim = battle([{ owner: 1, kind: UnitKind.Archer, col: HIGH_GROUND_COL }]);
    const archer = sim.entities.get(1)!;
    expect(effectiveRange(archer, sim.terrain!)).toBe((COMBAT_SPECS[UnitKind.Archer].range + 1) * 65536);
  });

  it('leaves every other unit alone on the same hill', () => {
    const sim = battle([{ owner: 1, kind: UnitKind.Spear, col: HIGH_GROUND_COL }]);
    expect(effectiveRange(sim.entities.get(1)!, sim.terrain!)).toBe(COMBAT_SPECS[UnitKind.Spear].range * 65536);
  });

  it('is zero for a unit with no combat entry, which is how villagers refuse to fight', () => {
    const sim = battle([{ owner: 1, kind: UnitKind.Villager, col: 1 }]);
    expect(effectiveRange(sim.entities.get(1)!, sim.terrain!)).toBe(0);
  });
});

describe('auto-attack', () => {
  it('strikes an adjacent enemy on the first tick, without an order', () => {
    const sim = battle([
      { owner: 1, kind: UnitKind.Spear, col: 3 },
      { owner: 2, kind: UnitKind.Spear, col: 4 },
    ]);
    sim.step();
    const damage = COMBAT_SPECS[UnitKind.Spear].damage;
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp - damage);
    expect(sim.entities.get(2)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp - damage);
  });

  it('then strikes once per interval, not once per tick', () => {
    const sim = battle([
      { owner: 1, kind: UnitKind.Spear, col: 3 },
      { owner: 2, kind: UnitKind.Spear, col: 4 },
    ]);
    const spec = COMBAT_SPECS[UnitKind.Spear];
    // Exactly `interval` ticks is exactly one strike: the tick that struck is the first
    // of the interval, so a second landing here would make a spear faster than its table.
    sim.run(spec.interval);
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp - spec.damage);
    sim.step();
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp - 2 * spec.damage);
  });

  it('does nothing at all when the nearest enemy is out of reach', () => {
    const sim = battle([
      { owner: 1, kind: UnitKind.Spear, col: 1 },
      { owner: 2, kind: UnitKind.Spear, col: 5 },
    ]);
    sim.run(100);
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
    expect(sim.entities.get(2)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
  });

  it('never strikes a friend, however close', () => {
    const sim = battle([
      { owner: 1, kind: UnitKind.Spear, col: 3 },
      { owner: 1, kind: UnitKind.Cavalry, col: 4 },
    ]);
    sim.run(100);
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
    expect(sim.entities.get(2)!.hp).toBe(UNIT_SPECS[UnitKind.Cavalry].hp);
  });

  it('applies the triangle: a spear takes twice as much off cavalry as off a spear', () => {
    const vsCavalry = battle([
      { owner: 1, kind: UnitKind.Spear, col: 3 },
      { owner: 2, kind: UnitKind.Cavalry, col: 4 },
    ]);
    vsCavalry.step();
    const cavalryLost = UNIT_SPECS[UnitKind.Cavalry].hp - vsCavalry.entities.get(2)!.hp;
    expect(cavalryLost).toBe(2 * COMBAT_SPECS[UnitKind.Spear].damage);
    // And the cavalry's own blow is only even, which is what makes it a counter and not
    // simply a better unit.
    expect(UNIT_SPECS[UnitKind.Spear].hp - vsCavalry.entities.get(1)!.hp).toBe(
      COMBAT_SPECS[UnitKind.Cavalry].damage,
    );
  });

  it('lets an archer on high ground outrange one on the flat', () => {
    const flat = COMBAT_SPECS[UnitKind.Archer].range;
    const uphill = battle([
      { owner: 1, kind: UnitKind.Archer, col: HIGH_GROUND_COL },
      { owner: 2, kind: UnitKind.Spear, col: HIGH_GROUND_COL - flat - 1 },
    ]);
    uphill.step();
    expect(uphill.entities.get(2)!.hp).toBeLessThan(UNIT_SPECS[UnitKind.Spear].hp);
    // The spear is a cell beyond the archer's listed reach, so on level ground nothing
    // happens — the hill is the whole difference.
    const level = battle([
      { owner: 1, kind: UnitKind.Archer, col: 5 },
      { owner: 2, kind: UnitKind.Spear, col: 5 - flat - 1 },
    ]);
    level.step();
    expect(level.entities.get(2)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
  });

  it('leaves villagers to be robbed: they never strike back', () => {
    const sim = battle([
      { owner: 1, kind: UnitKind.Villager, col: 3 },
      { owner: 2, kind: UnitKind.Villager, col: 4 },
    ]);
    sim.run(200);
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Villager].hp);
    expect(sim.entities.get(2)!.hp).toBe(UNIT_SPECS[UnitKind.Villager].hp);
  });

  it('kills, and leaves nothing pointing at the corpse', () => {
    const sim = battle(
      [
        { owner: 1, kind: UnitKind.Skirmisher, col: 3 },
        { owner: 2, kind: UnitKind.Villager, col: 4 },
      ],
      [{ owner: 2, kind: BuildingKind.Farm, col: 4 }],
    );
    const farm = sim.buildings.all()[0];
    sim.issue({ type: 'assign', unit: 2, building: farm.id });
    sim.run(5);
    expect(farm.workers).toEqual([2]);
    sim.run(400);
    expect(sim.entities.get(2)).toBeUndefined();
    expect(farm.workers).toEqual([]);
  });
});

describe('targeting', () => {
  it('takes the nearest enemy', () => {
    const sim = battle([
      { owner: 1, kind: UnitKind.Archer, col: 4 },
      { owner: 2, kind: UnitKind.Spear, col: 7 },
      { owner: 2, kind: UnitKind.Spear, col: 5 },
    ]);
    sim.step();
    expect(sim.entities.get(2)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
    expect(sim.entities.get(3)!.hp).toBeLessThan(UNIT_SPECS[UnitKind.Spear].hp);
  });

  it('breaks a tie on the lowest unit id, so the choice never depends on scan order', () => {
    const sim = battle([
      { owner: 1, kind: UnitKind.Archer, col: 5 },
      { owner: 2, kind: UnitKind.Spear, col: 7 },
      { owner: 2, kind: UnitKind.Spear, col: 3 },
    ]);
    sim.step();
    expect(sim.entities.get(2)!.hp).toBeLessThan(UNIT_SPECS[UnitKind.Spear].hp);
    expect(sim.entities.get(3)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
  });
});

describe('siege', () => {
  it('lets a ram reduce a building and ignore the soldier next to it', () => {
    const sim = battle(
      [
        { owner: 1, kind: UnitKind.Ram, col: 3 },
        { owner: 2, kind: UnitKind.Archer, col: 4 },
      ],
      [{ owner: 2, kind: BuildingKind.Farm, col: 4 }],
    );
    const farm = sim.buildings.all()[0];
    const before = farm.hp;
    sim.step();
    expect(farm.hp).toBe(before - COMBAT_SPECS[UnitKind.Ram].damage);
    // A siege engine is harmless to units: the archer is untouched by the ram, and its
    // own shot lands, which is exactly why a ram needs an escort.
    expect(sim.entities.get(2)!.hp).toBe(UNIT_SPECS[UnitKind.Archer].hp);
    expect(sim.entities.get(1)!.hp).toBeLessThan(UNIT_SPECS[UnitKind.Ram].hp);
  });

  it("brings a seat down at the brief's rate, and the province falls with it", () => {
    const sim = battle(
      [{ owner: 2, kind: UnitKind.Ram, col: 4 }],
      [{ owner: 1, kind: BuildingKind.Seat, col: 3 }],
    );
    expect(sim.provinces.get(1)!.owner).toBe(1);
    const seatHp = BUILDING_SPECS[BuildingKind.Seat].hp;
    // The seat shoots back at 8/s and a ram has 120 hp, so a lone ram dies at tick 211
    // having taken 450 off 1500 — a seat costs about four rams, or one ram with an
    // escort to draw the tower. Rule III is not a formality, and this is the number.
    sim.run(seconds(15));
    expect(sim.entities.get(1)).toBeUndefined();
    expect(sim.buildings.get(1)!.hp).toBe(seatHp - 450);
    expect(sim.provinces.get(1)!.owner).toBe(1);
  });
});

describe('self-defending seats and towers (rule III)', () => {
  it("deals the brief's 8 damage a second at 6 cells", () => {
    const spec = BUILDING_COMBAT[BuildingKind.Tower];
    const sim = battle(
      [{ owner: 2, kind: UnitKind.Spear, col: 6 + spec.range }],
      [{ owner: 1, kind: BuildingKind.Tower, col: 6 }],
    );
    // One second is one shot, and the next lands on the very next tick: a tower that
    // needed interval + 1 ticks would quietly deal 7.5/s instead of the brief's 8.
    sim.run(seconds(1));
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp - spec.damage);
    sim.step();
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp - 2 * spec.damage);
  });

  it('does not reach a cell further', () => {
    const spec = BUILDING_COMBAT[BuildingKind.Tower];
    const sim = battle(
      [{ owner: 2, kind: UnitKind.Spear, col: 6 + spec.range + 1 }],
      [{ owner: 1, kind: BuildingKind.Tower, col: 6 }],
    );
    sim.run(seconds(10));
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
  });

  it('arms the seat itself, so walking up to one costs something', () => {
    const sim = battle(
      [{ owner: 2, kind: UnitKind.Villager, col: 5 }],
      [{ owner: 1, kind: BuildingKind.Seat, col: 3 }],
    );
    sim.run(seconds(1));
    expect(sim.entities.get(1)!.hp).toBeLessThan(UNIT_SPECS[UnitKind.Villager].hp);
  });

  it('does not fire from a building still under construction', () => {
    const sim = battle([{ owner: 2, kind: UnitKind.Spear, col: 7 }]);
    sim.players.get(1)!.timber = 500;
    // Placed by hand at half health: a tower that shot while it was still scaffolding
    // would make the build time meaningless.
    sim.buildings.place({ owner: 1, kind: BuildingKind.Tower, cell: cellAt(6) });
    sim.run(seconds(10));
    expect(sim.entities.get(1)!.hp).toBe(UNIT_SPECS[UnitKind.Spear].hp);
  });
});

describe('determinism', () => {
  it('replays a skirmish to the same hash, twice', () => {
    const fight = () => {
      const sim = battle([
        { owner: 1, kind: UnitKind.Spear, col: 3 },
        { owner: 1, kind: UnitKind.Archer, col: 2 },
        { owner: 2, kind: UnitKind.Cavalry, col: 4 },
        { owner: 2, kind: UnitKind.Skirmisher, col: 5 },
      ]);
      const hashes: string[] = [];
      for (let i = 0; i < 120; i++) {
        sim.step();
        hashes.push(sim.hash());
      }
      return hashes;
    };
    expect(fight()).toEqual(fight());
  });
});

/**
 * The two combat tables, and the collision between them.
 *
 * `COMBAT_SPECS` is keyed by unit kind and `BUILDING_COMBAT` by building kind — and the
 * two enums share a numeric keyspace. `UnitKind.Ram` is 7 and `BuildingKind.Tower` is also
 * 7, so `COMBAT_SPECS[BuildingKind.Tower]` returns a perfectly valid spec that belongs to
 * the ram: range one instead of six, siege true instead of false, and no error anywhere to
 * say so. A bot policy read it that way and quietly believed its towers reached a single
 * cell.
 *
 * Renaming the keys apart is not free — a building's kind is hashed into every replay — so
 * this pins the hazard instead: the tables stay disjoint in meaning, and anything that
 * wants a building's guns reads `BUILDING_COMBAT`.
 */
describe('the combat tables do not lend each other their numbers', () => {
  it('gives the tower the reach the brief measures, via the building table', () => {
    // "Seat 1500 HP; its tower deals 8/s at 6 cells."
    expect(BUILDING_COMBAT[BuildingKind.Tower]).toEqual({ damage: 8, range: 6, interval: seconds(1), siege: false });
    expect(BUILDING_COMBAT[BuildingKind.Seat].range).toBe(6);
  });

  it('hands back the RAM when a building kind is looked up in the unit table', () => {
    // Not a property worth having — a property worth knowing about. If this ever stops
    // being true the collision has been designed away, and the warning above can go.
    expect(UnitKind.Ram).toBe(BuildingKind.Tower);
    expect(COMBAT_SPECS[BuildingKind.Tower]).toBe(COMBAT_SPECS[UnitKind.Ram]);
    expect(COMBAT_SPECS[BuildingKind.Tower].range).not.toBe(BUILDING_COMBAT[BuildingKind.Tower].range);
  });

  it('keeps the unit table free of buildings, so "has a combat spec" still means "fights"', () => {
    // attrition.ts asks exactly this question to decide who bleeds under rule VII.
    for (const kind of Object.values(BuildingKind)) {
      if (Object.values(UnitKind).includes(kind as never)) continue;
      expect(COMBAT_SPECS[kind]).toBeUndefined();
    }
  });
});
