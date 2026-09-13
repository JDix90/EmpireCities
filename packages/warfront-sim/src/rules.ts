/**
 * Every tunable number for the Warfront economy, in one place.
 *
 * EVERY VALUE HERE IS A FIRST GUESS. The design brief is explicit that its economy
 * figures exist so a simulation harness has something to disagree with, and that none
 * should survive a thousand simulated matches unchanged. They are gathered in one module
 * precisely so the lab (step 4) can sweep them without hunting through the rules code.
 *
 * Everything is an integer, and rates are expressed PER MINUTE rather than per tick.
 * A per-tick rate would have to be fractional — 12 food/minute is 12/900 per tick — and
 * the whole package forbids fractions in state. Instead each rate accumulates its
 * per-minute value every tick and flushes whole units at `TICKS_PER_MINUTE`, which is
 * exact integer arithmetic with no drift. See economy.ts.
 */

import { TICK_RATE } from './constants';

/** 15 ticks/s × 60s. Every per-minute rate divides by this. */
export const TICKS_PER_MINUTE = TICK_RATE * 60;

export function seconds(n: number): number {
  return n * TICK_RATE;
}

/** Unit kinds. Integers, not strings: commands and the state hash stay all-integer. */
export const UnitKind = {
  Villager: 1,
  Scout: 2,
  Spear: 3,
  Archer: 4,
  Skirmisher: 5,
  Cavalry: 6,
  Ram: 7,
} as const;
export type UnitKindValue = (typeof UnitKind)[keyof typeof UnitKind];

export const UNIT_KIND_NAMES: Record<number, string> = {
  [UnitKind.Villager]: 'villager',
  [UnitKind.Scout]: 'scout',
  [UnitKind.Spear]: 'spear',
  [UnitKind.Archer]: 'archer',
  [UnitKind.Skirmisher]: 'skirmisher',
  [UnitKind.Cavalry]: 'cavalry',
  [UnitKind.Ram]: 'ram',
};

export interface UnitSpec {
  food: number;
  timber: number;
  silver: number;
  /** Population cost — the real army cap. */
  pop: number;
  /** Training time in ticks. */
  trainTicks: number;
  hp: number;
  /** Cells per tick, 16.16 fixed. Assigned in units.ts to keep this table pure data. */
  speedPerMinute: number;
  /** Food eaten per minute. */
  upkeep: number;
}

/**
 * Costs and training times straight from the brief's roster table. `speedPerMinute` is
 * in CELLS per minute, converted to fixed cells-per-tick at use; at 4 km cells a
 * villager covering 9 cells a minute is a placeholder pace, not a measured one.
 */
export const UNIT_SPECS: Record<number, UnitSpec> = {
  [UnitKind.Villager]: { food: 40, timber: 0, silver: 0, pop: 1, trainTicks: seconds(20), hp: 40, speedPerMinute: 9, upkeep: 3 },
  [UnitKind.Scout]: { food: 30, timber: 0, silver: 0, pop: 1, trainTicks: seconds(10), hp: 30, speedPerMinute: 20, upkeep: 3 },
  [UnitKind.Spear]: { food: 40, timber: 0, silver: 15, pop: 1, trainTicks: seconds(15), hp: 60, speedPerMinute: 9, upkeep: 4 },
  [UnitKind.Archer]: { food: 40, timber: 0, silver: 20, pop: 1, trainTicks: seconds(15), hp: 45, speedPerMinute: 9, upkeep: 4 },
  [UnitKind.Skirmisher]: { food: 30, timber: 0, silver: 10, pop: 1, trainTicks: seconds(12), hp: 40, speedPerMinute: 12, upkeep: 4 },
  [UnitKind.Cavalry]: { food: 80, timber: 0, silver: 40, pop: 2, trainTicks: seconds(25), hp: 90, speedPerMinute: 16, upkeep: 4 },
  [UnitKind.Ram]: { food: 0, timber: 100, silver: 40, pop: 3, trainTicks: seconds(40), hp: 120, speedPerMinute: 5, upkeep: 4 },
};

/** Building kinds. Step 3's economy set; the military and coastal ones arrive later. */
export const BuildingKind = {
  Seat: 1,
  House: 2,
  Farm: 3,
  LumberCamp: 4,
  Mine: 5,
} as const;
export type BuildingKindValue = (typeof BuildingKind)[keyof typeof BuildingKind];

export const BUILDING_KIND_NAMES: Record<number, string> = {
  [BuildingKind.Seat]: 'seat',
  [BuildingKind.House]: 'house',
  [BuildingKind.Farm]: 'farm',
  [BuildingKind.LumberCamp]: 'lumber camp',
  [BuildingKind.Mine]: 'mine',
};

/** Which resource a worked building produces. */
export const Resource = {
  None: 0,
  Food: 1,
  Timber: 2,
  Silver: 3,
} as const;
export type ResourceValue = (typeof Resource)[keyof typeof Resource];

export interface BuildingSpec {
  timber: number;
  silver: number;
  /** Build time in ticks with ONE builder; two builders halve it (see economy.ts). */
  buildTicks: number;
  hp: number;
  /** Population this building adds to the cap. */
  pop: number;
  /** Resource produced per assigned worker per minute, or Resource.None. */
  produces: ResourceValue;
  yieldPerMinute: number;
  /** Workers this building can hold. */
  workerSlots: number;
  /**
   * Biomes this may be built on, by the terrain asset's biome values. Empty means
   * anywhere walkable. This is where rule IV feeds rule II: WHERE you colonise decides
   * WHAT you can build, because the terrain pipeline already decided what is there.
   */
  biomes: readonly number[];
}

// Biome values from terrain.ts, repeated as literals to keep this a pure data module.
const PLAINS = 2;
const FOREST = 3;
const HIGHLAND = 4;

export const BUILDING_SPECS: Record<number, BuildingSpec> = {
  [BuildingKind.Seat]: {
    timber: 0,
    silver: 0,
    buildTicks: seconds(30),
    hp: 1500,
    pop: 10,
    produces: Resource.None,
    yieldPerMinute: 0,
    workerSlots: 0,
    biomes: [],
  },
  [BuildingKind.House]: {
    timber: 40,
    silver: 0,
    buildTicks: seconds(15),
    hp: 200,
    pop: 5,
    produces: Resource.None,
    yieldPerMinute: 0,
    workerSlots: 0,
    biomes: [],
  },
  [BuildingKind.Farm]: {
    timber: 40,
    silver: 0,
    buildTicks: seconds(20),
    hp: 150,
    pop: 0,
    produces: Resource.Food,
    yieldPerMinute: 12,
    workerSlots: 4,
    biomes: [PLAINS],
  },
  [BuildingKind.LumberCamp]: {
    timber: 30,
    silver: 0,
    buildTicks: seconds(20),
    hp: 150,
    pop: 0,
    produces: Resource.Timber,
    yieldPerMinute: 8,
    workerSlots: 4,
    biomes: [FOREST],
  },
  [BuildingKind.Mine]: {
    timber: 60,
    silver: 0,
    buildTicks: seconds(25),
    hp: 150,
    pop: 0,
    produces: Resource.Silver,
    yieldPerMinute: 6,
    workerSlots: 4,
    biomes: [HIGHLAND],
  },
};

/** Starting stock, per the brief: seat, 4 villagers, 1 scout, 200 food, 100 timber. */
export const START_FOOD = 200;
export const START_TIMBER = 100;
export const START_SILVER = 0;
export const START_VILLAGERS = 4;
export const START_SCOUTS = 1;

/**
 * A worker gathers only while it is at its building — walking there costs real time,
 * which is what makes WHERE the buildings go a decision. One cell of slack (Chebyshev)
 * so a unit resting on an adjacent cell still counts.
 */
export const WORK_RADIUS_CELLS = 1;

/** Starvation. The brief says it "bleeds like attrition": 1% of max health per 10s. */
export const STARVATION_INTERVAL_TICKS = seconds(10);
export const STARVATION_PERCENT_PER_INTERVAL = 1;

/**
 * Builders a single construction site accepts. The brief only says "two halve the time";
 * a cap keeps a whole empire from finishing a farm in one tick. A first guess like the
 * rest of this file.
 */
export const BUILDER_SLOTS = 4;

/** What each building can train in step 3. Barracks and soldiers arrive with combat. */
export const TRAINS_AT: Record<number, readonly UnitKindValue[]> = {
  [BuildingKind.Seat]: [UnitKind.Villager, UnitKind.Scout],
};
