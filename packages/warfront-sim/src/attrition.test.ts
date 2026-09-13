import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import { exposedAt, musterAt } from './attrition';
import {
  ATTRITION_INTERVAL_TICKS,
  BUILDING_SPECS,
  BuildingKind,
  CAMP_MIN_SOLDIERS,
  CAMP_RADIUS_CELLS,
  UNIT_SPECS,
  UnitKind,
  seconds,
  type UnitKindValue,
} from './rules';

/**
 * Rule VII on a strip of three provinces: yours, nobody's, and theirs.
 *
 * Sixty columns so the two seats sit far enough apart that neither tower reaches the
 * ground the tests use — a seat fires 8 a second at six cells, which would drown the
 * signal this file is trying to read. Everything stands still (speed 0) so a bleed is
 * the only thing that can change a unit's health.
 */
const WIDTH = 60;
const ROW = 1;
const HOME_SEAT_COL = 2;
const ENEMY_SEAT_COL = 59;

/** Columns 0-19 are province 1, 20-39 province 2, 40-59 province 3. */
function provinceOf(col: number): number {
  return col < 20 ? 1 : col < 40 ? 2 : 3;
}

function testGrid(): TerrainGrid {
  const height = 3;
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * height).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    cells[ROW * WIDTH + c] = packCell({
      owner: provinceOf(c),
      tier: 0,
      passable: true,
      biome: Biome.Plains,
    });
  }
  return new TerrainGrid(WIDTH, height, cells, {
    provinces: [
      { index: 1, territory_id: 'home', name: 'Home' },
      { index: 2, territory_id: 'nobody', name: "Nobody's" },
      { index: 3, territory_id: 'theirs', name: 'Theirs' },
    ],
  });
}

const cellAt = (col: number) => ROW * WIDTH + col;

interface Soldier {
  owner: number;
  kind: UnitKindValue;
  col: number;
}

/**
 * Seat 1 holds province 1, seat 2 holds province 3, province 2 stays neutral.
 *
 * Generous stores because starvation is the economy's business and would otherwise bite
 * the same health this file is measuring.
 */
function field(units: Soldier[], extraBuildings: Array<{ owner: number; kind: number; col: number }> = []) {
  return new Sim({
    seed: 1,
    terrain: testGrid(),
    scenario: {
      players: [
        { index: 1, food: 5000, timber: 500, silver: 500 },
        { index: 2, food: 5000, timber: 500, silver: 500 },
      ],
      buildings: [
        { owner: 1, kind: BuildingKind.Seat, cell: cellAt(HOME_SEAT_COL) },
        { owner: 2, kind: BuildingKind.Seat, cell: cellAt(ENEMY_SEAT_COL) },
        ...extraBuildings.map((b) => ({ owner: b.owner, kind: b.kind as 1, cell: cellAt(b.col) })),
      ],
      units: units.map((u) => ({
        owner: u.owner,
        kind: u.kind,
        x: cellCentre(u.col),
        y: cellCentre(ROW),
        speed: 0,
      })),
    },
  });
}

/** The bleed for a kind: 1% of max health, floored at one point. */
function bite(kind: UnitKindValue): number {
  return Math.max(1, Math.floor(UNIT_SPECS[kind].hp / 100));
}

describe('attrition (rule VII)', () => {
  it("bleeds a soldier standing in somebody else's province, once an interval", () => {
    const sim = field([{ owner: 1, kind: UnitKind.Spear, col: 45 }]);
    const spear = sim.entities.all()[0];
    const full = spear.maxHp;

    // One tick short of the interval is still untouched: the bleed is a cadence, not a
    // stream, exactly like combat.
    sim.run(ATTRITION_INTERVAL_TICKS - 1);
    expect(spear.hp).toBe(full);

    sim.run(1);
    expect(spear.hp).toBe(full - bite(UnitKind.Spear));

    sim.run(ATTRITION_INTERVAL_TICKS * 2);
    expect(spear.hp).toBe(full - bite(UnitKind.Spear) * 3);
  });

  it('kills a soldier left abroad long enough', () => {
    const sim = field([{ owner: 1, kind: UnitKind.Spear, col: 45 }]);
    const id = sim.entities.all()[0].id;
    // 60 health at a point per interval is ten minutes. A number worth asserting rather
    // than assuming: it is the whole of "an army abroad is a clock the owner can read".
    sim.run(ATTRITION_INTERVAL_TICKS * UNIT_SPECS[UnitKind.Spear].hp);
    expect(sim.entities.get(id)).toBeUndefined();
  });

  it('leaves a soldier at home alone', () => {
    const sim = field([{ owner: 1, kind: UnitKind.Spear, col: 10 }]);
    const spear = sim.entities.all()[0];
    sim.run(ATTRITION_INTERVAL_TICKS * 5);
    expect(spear.hp).toBe(spear.maxHp);
  });

  it('leaves a soldier in a neutral province alone, under the reading the brief priced', () => {
    // The two halves of the brief disagree about neutral ground; ATTRITION_IN_NEUTRAL
    // picks one and this pins which. Flip that constant and this test is what says so.
    const sim = field([{ owner: 1, kind: UnitKind.Spear, col: 30 }]);
    const spear = sim.entities.all()[0];
    sim.run(ATTRITION_INTERVAL_TICKS * 5);
    expect(spear.hp).toBe(spear.maxHp);
  });

  it('leaves villagers and scouts alone wherever they stand', () => {
    // Rule I sends villagers into other people's provinces to colonise and rule V sends a
    // scout onto somebody else's beach to watch a lane. A bleed that hit everything with
    // legs would make both of those a death march.
    const sim = field([
      { owner: 1, kind: UnitKind.Villager, col: 45 },
      { owner: 1, kind: UnitKind.Scout, col: 46 },
    ]);
    const [villager, scout] = sim.entities.all();
    sim.run(ATTRITION_INTERVAL_TICKS * 5);
    expect(villager.hp).toBe(villager.maxHp);
    expect(scout.hp).toBe(scout.maxHp);
  });

  it('leaves tribal raiders alone — they are on rule VI’s clock, not this one', () => {
    const sim = field([{ owner: 0, kind: UnitKind.Skirmisher, col: 45 }]);
    const raider = sim.entities.all()[0];
    sim.run(ATTRITION_INTERVAL_TICKS * 5);
    expect(raider.hp).toBe(raider.maxHp);
  });

  it('starts the clock over when a soldier comes home', () => {
    const sim = field([{ owner: 1, kind: UnitKind.Spear, col: 45 }]);
    const spear = sim.entities.all()[0];

    // Nearly a full interval abroad...
    sim.run(ATTRITION_INTERVAL_TICKS - 2);
    expect(spear.hp).toBe(spear.maxHp);

    // ...then home. Moved by hand rather than walked: this is a test of the timer, and
    // routing a unit sixty cells would measure the pathfinder instead.
    spear.x = cellCentre(10);
    sim.run(2);
    expect(spear.attritionTimer).toBe(0);

    // Back out, and it needs a WHOLE interval again rather than the two ticks it was
    // short of. Otherwise stepping over the border and back would be free.
    spear.x = cellCentre(45);
    sim.run(ATTRITION_INTERVAL_TICKS - 1);
    expect(spear.hp).toBe(spear.maxHp);
    sim.run(1);
    expect(spear.hp).toBe(spear.maxHp - bite(UnitKind.Spear));
  });

  it('bleeds every kind at the same single point, which is the floor and not the percentage', () => {
    // The rate the roster actually produces. 1% of sixty, ninety or a hundred and twenty
    // all floor to zero, so the one-point minimum governs everything and a ram outlasts a
    // spear purely by having more health. Pinned because it is easy to read the constant
    // as "1% a tick" and design against a number the game does not have.
    const sim = field([
      { owner: 1, kind: UnitKind.Spear, col: 44 },
      { owner: 1, kind: UnitKind.Cavalry, col: 45 },
      { owner: 1, kind: UnitKind.Ram, col: 46 },
    ]);
    const before = sim.entities.all().map((u) => u.hp);
    sim.run(ATTRITION_INTERVAL_TICKS);
    for (const [i, unit] of sim.entities.all().entries()) {
      expect(before[i] - unit.hp).toBe(1);
    }
  });

  it('reads exposure from who holds the ground, not from who is standing on it', () => {
    const sim = field([]);
    const ctx = {
      entities: sim.entities,
      buildings: sim.buildings,
      provinces: sim.provinces,
      grid: sim.terrain!,
    };
    expect(exposedAt(ctx, 1, cellAt(10))).toBe(false); // own province
    expect(exposedAt(ctx, 1, cellAt(30))).toBe(false); // neutral
    expect(exposedAt(ctx, 1, cellAt(45))).toBe(true); // theirs
    expect(exposedAt(ctx, 2, cellAt(45))).toBe(false); // theirs, to them
    expect(exposedAt(ctx, 2, cellAt(10))).toBe(true);
  });
});

describe('the marching camp (rule VII)', () => {
  /** `n` spears of `owner` in a row starting at `col`. */
  function squad(owner: number, col: number, n: number): Soldier[] {
    return Array.from({ length: n }, (_, i) => ({ owner, kind: UnitKind.Spear, col: col + i }));
  }

  it('needs the brief’s five soldiers mustered, and refuses four', () => {
    const four = field(squad(1, 44, CAMP_MIN_SOLDIERS - 1));
    four.issue({ type: 'camp', unit: four.entities.all()[0].id, cell: cellAt(45) });
    four.run(5);
    expect(four.buildings.all().filter((b) => b.kind === BuildingKind.Camp)).toHaveLength(0);

    const five = field(squad(1, 44, CAMP_MIN_SOLDIERS));
    five.issue({ type: 'camp', unit: five.entities.all()[0].id, cell: cellAt(45) });
    five.run(5);
    expect(five.buildings.all().filter((b) => b.kind === BuildingKind.Camp)).toHaveLength(1);
  });

  it('refuses a villager, however many of them there are', () => {
    const sim = field(
      Array.from({ length: 10 }, (_, i) => ({ owner: 1, kind: UnitKind.Villager, col: 44 + i })),
    );
    sim.issue({ type: 'camp', unit: sim.entities.all()[0].id, cell: cellAt(45) });
    sim.run(5);
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Camp)).toHaveLength(0);
  });

  it('shelters nobody while it is still rising, and everybody once it stands', () => {
    const sim = field(squad(1, 44, CAMP_MIN_SOLDIERS));
    const spear = sim.entities.all()[0];
    sim.issue({ type: 'camp', unit: spear.id, cell: cellAt(45) });
    sim.run(2);

    // Thirty seconds of raising is three bleeds. A camp that sheltered from the moment it
    // was ordered would make rule VII free.
    sim.run(ATTRITION_INTERVAL_TICKS);
    expect(spear.hp).toBeLessThan(spear.maxHp);

    const wounded = spear.hp;
    sim.runTo(BUILDING_SPECS[BuildingKind.Camp].buildTicks + 10);
    const camp = sim.buildings.all().find((b) => b.kind === BuildingKind.Camp)!;
    expect(camp.complete).toBe(true);

    const sheltered = spear.hp;
    expect(sheltered).toBeLessThan(wounded + 1);
    sim.run(ATTRITION_INTERVAL_TICKS * 4);
    expect(spear.hp).toBe(sheltered);
  });

  it('covers its radius and not a cell more', () => {
    // Sited at 42 rather than 45 so the cell just outside the radius is still nine columns
    // clear of the enemy seat. A tower reaches six and deals 8 a second — the first draft
    // of this test put the "outside" spear inside that and measured the tower instead.
    const CAMP_COL = 42;
    const sim = field([
      ...squad(1, CAMP_COL - 1, CAMP_MIN_SOLDIERS),
      { owner: 1, kind: UnitKind.Spear, col: CAMP_COL + CAMP_RADIUS_CELLS },
      { owner: 1, kind: UnitKind.Spear, col: CAMP_COL + CAMP_RADIUS_CELLS + 1 },
    ]);
    const units = sim.entities.all();
    const inside = units[CAMP_MIN_SOLDIERS];
    const outside = units[CAMP_MIN_SOLDIERS + 1];
    sim.issue({ type: 'camp', unit: units[0].id, cell: cellAt(CAMP_COL) });
    sim.runTo(BUILDING_SPECS[BuildingKind.Camp].buildTicks + 5);

    const insideAt = inside.hp;
    const outsideAt = outside.hp;
    sim.run(ATTRITION_INTERVAL_TICKS * 3);
    expect(inside.hp).toBe(insideAt);
    expect(outside.hp).toBeLessThan(outsideAt);
  });

  it('stalls when the muster walks away, and does not un-build', () => {
    const sim = field(squad(1, 44, CAMP_MIN_SOLDIERS));
    sim.issue({ type: 'camp', unit: sim.entities.all()[0].id, cell: cellAt(45) });
    sim.run(seconds(10));
    const camp = sim.buildings.all().find((b) => b.kind === BuildingKind.Camp)!;
    const reached = camp.progress;
    expect(reached).toBeGreaterThan(0);
    expect(camp.complete).toBe(false);

    // The army marches off. Driving the soldiers away is the defender's other answer to a
    // camp, alongside burning one that already stands.
    for (const unit of sim.entities.all()) unit.x = cellCentre(10);
    sim.run(seconds(30));
    expect(camp.progress).toBe(reached);
    expect(camp.complete).toBe(false);
  });

  it('is a building, so the defender can burn it and the bleeding resumes', () => {
    // The ram starts out of reach and is walked in only once the camp stands. Sent with
    // the army it would knock the camp over while it was still a one-health building site,
    // which proves an unfinished camp is fragile rather than that a finished one burns.
    const CAMP_COL = 42;
    const sim = field([
      ...squad(1, CAMP_COL - 1, CAMP_MIN_SOLDIERS),
      { owner: 2, kind: UnitKind.Ram, col: 55 },
    ]);
    const units = sim.entities.all();
    const garrison = units[0];
    const ram = units[CAMP_MIN_SOLDIERS];
    sim.issue({ type: 'camp', unit: garrison.id, cell: cellAt(CAMP_COL) });
    sim.runTo(BUILDING_SPECS[BuildingKind.Camp].buildTicks + 5);
    expect(sim.buildings.all().some((b) => b.kind === BuildingKind.Camp && b.complete)).toBe(true);

    // The army moves on, as an army does, leaving one spear under the camp. Four more
    // would shoot the ram down in four seconds and the camp would never burn — which is a
    // fair outcome in a real match and a useless one in a test of burning.
    for (const unit of units.slice(1, CAMP_MIN_SOLDIERS)) unit.x = cellCentre(10);
    ram.x = cellCentre(CAMP_COL + 1);

    // 375 health against 30 a second is thirteen seconds; the lone spear needs twenty to
    // kill a ram, so the ram gets there first.
    sim.run(seconds(20));
    expect(sim.buildings.all().some((b) => b.kind === BuildingKind.Camp)).toBe(false);

    // And with the shelter gone the survivor is exposed again.
    const at = garrison.hp;
    sim.run(ATTRITION_INTERVAL_TICKS);
    expect(garrison.hp).toBeLessThan(at);
  });

  it('counts the muster from the site, not from whoever gave the order', () => {
    const sim = field(squad(1, 44, CAMP_MIN_SOLDIERS));
    const ctx = {
      entities: sim.entities,
      buildings: sim.buildings,
      provinces: sim.provinces,
      grid: sim.terrain!,
    };
    expect(musterAt(ctx, 1, cellAt(45))).toBe(CAMP_MIN_SOLDIERS);
    // Far from the squad, nobody is mustered — and the squad's own order would fail there.
    expect(musterAt(ctx, 1, cellAt(10))).toBe(0);
    expect(musterAt(ctx, 2, cellAt(45))).toBe(0);
  });
});
