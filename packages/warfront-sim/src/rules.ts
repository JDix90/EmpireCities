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
 * Costs and training times straight from the brief's roster table. The brief gives no
 * speeds, so `speedPerMinute` — CELLS per minute, converted to fixed cells-per-tick at
 * use — is derived from the map instead of guessed.
 *
 * THE DERIVATION MATTERS, because the first pass got it wrong. The committed western
 * twenty asset has 4 km cells: Gallia Lugdunensis is 147x149 of them, and its seat sits
 * 53-82 cells from each of its five land frontiers. The brief's own timeline wants the
 * first colony planted around minute two and first contact by minute six. That fixes the
 * pace: a villager must cover a seat-to-frontier hop (~70 cells) in about 80 seconds, so
 * ~54 cells a minute, and every other unit scales from it. At 4 km a cell that is not a
 * marching pace — it is a 24-minute match played across Western Europe, and the map's
 * scale is the thing being abstracted, not the clock.
 *
 * The earlier placeholder table was six times slower, which made rule VI a dead letter:
 * raiders mustered on a frontier could not reach anything before their raid expired, so
 * they accumulated on the map and no villager was ever in danger. Pace is not cosmetic.
 */
export const UNIT_SPECS: Record<number, UnitSpec> = {
  [UnitKind.Villager]: { food: 40, timber: 0, silver: 0, pop: 1, trainTicks: seconds(20), hp: 40, speedPerMinute: 54, upkeep: 3 },
  [UnitKind.Scout]: { food: 30, timber: 0, silver: 0, pop: 1, trainTicks: seconds(10), hp: 30, speedPerMinute: 120, upkeep: 3 },
  [UnitKind.Spear]: { food: 40, timber: 0, silver: 15, pop: 1, trainTicks: seconds(15), hp: 60, speedPerMinute: 54, upkeep: 4 },
  [UnitKind.Archer]: { food: 40, timber: 0, silver: 20, pop: 1, trainTicks: seconds(15), hp: 45, speedPerMinute: 54, upkeep: 4 },
  [UnitKind.Skirmisher]: { food: 30, timber: 0, silver: 10, pop: 1, trainTicks: seconds(12), hp: 40, speedPerMinute: 72, upkeep: 4 },
  [UnitKind.Cavalry]: { food: 80, timber: 0, silver: 40, pop: 2, trainTicks: seconds(25), hp: 90, speedPerMinute: 96, upkeep: 4 },
  [UnitKind.Ram]: { food: 0, timber: 100, silver: 40, pop: 3, trainTicks: seconds(40), hp: 120, speedPerMinute: 30, upkeep: 4 },
};

/** Building kinds. Step 3's economy set; the military and coastal ones arrive later. */
export const BuildingKind = {
  Seat: 1,
  House: 2,
  Farm: 3,
  LumberCamp: 4,
  Mine: 5,
  Barracks: 6,
  Tower: 7,
} as const;
export type BuildingKindValue = (typeof BuildingKind)[keyof typeof BuildingKind];

export const BUILDING_KIND_NAMES: Record<number, string> = {
  [BuildingKind.Seat]: 'seat',
  [BuildingKind.House]: 'house',
  [BuildingKind.Farm]: 'farm',
  [BuildingKind.LumberCamp]: 'lumber camp',
  [BuildingKind.Mine]: 'mine',
  [BuildingKind.Barracks]: 'barracks',
  [BuildingKind.Tower]: 'tower',
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
  [BuildingKind.Barracks]: {
    timber: 80,
    silver: 0,
    buildTicks: seconds(35),
    hp: 300,
    pop: 0,
    produces: Resource.None,
    yieldPerMinute: 0,
    workerSlots: 0,
    biomes: [],
  },
  [BuildingKind.Tower]: {
    timber: 60,
    silver: 20,
    buildTicks: seconds(30),
    hp: 400,
    pop: 0,
    produces: Resource.None,
    yieldPerMinute: 0,
    workerSlots: 0,
    biomes: [],
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
  [BuildingKind.Barracks]: [UnitKind.Spear, UnitKind.Archer, UnitKind.Skirmisher, UnitKind.Cavalry, UnitKind.Ram],
};

/**
 * Rule I: colonisation costs more each time. The brief's figure is 80 food × 1.4 per
 * province already held.
 *
 * 1.4 is not an integer, so the price compounds as ×7÷5 with `idiv` at each step rather
 * than as a power of a float. That floors a little at each multiplication — 80, 112, 156,
 * 218 instead of 80, 112, 156.8, 219.5 — which is deterministic, monotonic, and slightly
 * cheaper for the leader than the brief's arithmetic. Worth the lab's attention, and
 * worth knowing it is a floor and not a rounding.
 */
export const COLONISE_BASE_FOOD = 80;
export const COLONISE_NUMERATOR = 7;
export const COLONISE_DENOMINATOR = 5;

/** Rule III: a fallen seat is claimed in 45 seconds with a villager present. */
export const CLAIM_TICKS = seconds(45);

/* ── Combat (rule VI's enabler, and rule III's ram) ───────────────────────────── */

export interface CombatSpec {
  /** Damage per strike, before the triangle multiplier. */
  damage: number;
  /** Reach in whole cells. */
  range: number;
  /** Ticks between strikes. */
  interval: number;
  /** True for a siege engine: it damages buildings and is harmless to units. */
  siege: boolean;
}

/**
 * Combat stats. The brief fixes two of these — a ram does 30/s to buildings and a tower
 * 8/s at 6 cells — and leaves the rest to the lab, so the others are first guesses shaped
 * to the triangle rather than measured.
 *
 * Villagers and scouts have no entry: they do not fight. Rule VI says villagers die to
 * raids, and a villager that fought back would make the raid a skirmish instead of a
 * robbery.
 */
export const COMBAT_SPECS: Record<number, CombatSpec> = {
  [UnitKind.Spear]: { damage: 6, range: 1, interval: seconds(1), siege: false },
  [UnitKind.Archer]: { damage: 5, range: 4, interval: 18, siege: false },
  [UnitKind.Skirmisher]: { damage: 4, range: 1, interval: 12, siege: false },
  [UnitKind.Cavalry]: { damage: 10, range: 1, interval: seconds(1), siege: false },
  [UnitKind.Ram]: { damage: 30, range: 1, interval: seconds(1), siege: true },
};

/**
 * The triangle, as percentages so the arithmetic stays integer: spear → cavalry →
 * archer → spear, each at double damage into its prey.
 *
 * The skirmisher is the brief's odd one out: it loots villagers and loses any straight
 * fight, so it hits villagers hard and every soldier at half.
 */
const ADVANTAGE = 200;
const DISADVANTAGE = 50;
const EVEN = 100;

export function damageMultiplier(attacker: number, defender: number): number {
  if (attacker === UnitKind.Spear && defender === UnitKind.Cavalry) return ADVANTAGE;
  if (attacker === UnitKind.Cavalry && defender === UnitKind.Archer) return ADVANTAGE;
  if (attacker === UnitKind.Archer && defender === UnitKind.Spear) return ADVANTAGE;
  if (attacker === UnitKind.Skirmisher) {
    return defender === UnitKind.Villager || defender === UnitKind.Scout ? ADVANTAGE : DISADVANTAGE;
  }
  return EVEN;
}

/**
 * Buildings that shoot, and the brief's only measured combat figures: "Seat 1500 HP; its
 * tower deals 8/s at 6 cells".
 *
 * The SEAT is armed, not just the tower building — that is rule III ("its tower fires on
 * its own") and the answer the brief gives to the attention problem ("self-defending
 * seats and towers"). A seat a raider could stroll up to would make rule III a formality.
 * The standalone tower gets the same numbers, the brief giving it none of its own.
 */
export const BUILDING_COMBAT: Record<number, CombatSpec> = {
  [BuildingKind.Seat]: { damage: 8, range: 6, interval: seconds(1), siege: false },
  [BuildingKind.Tower]: { damage: 8, range: 6, interval: seconds(1), siege: false },
};

/**
 * Rule IV modifying the triangle rather than adding to it: an archer on high ground
 * reaches one cell further. The brief's line is "range and vision grow on high ground";
 * vision does not exist yet, so this is the half that can be built.
 */
export const HIGH_GROUND_ARCHER_RANGE_BONUS = 1;

/* ── Tribes (rule VI) ─────────────────────────────────────────────────────────── */

/** Raids start at minute two. The one number in rule VI the brief actually fixes. */
export const FIRST_RAID_TICK = seconds(120);
/** Ticks between a tribe's raids. The brief's minute-four line says "every 90s". */
export const RAID_INTERVAL_TICKS = seconds(90);
/** Raiders in the first raid of a match. */
export const RAID_BASE_SIZE = 1;
/** One more raider per this many provinces the victim holds — raids scale with holdings. */
export const RAID_SIZE_PER_PROVINCE = 1;
/** One more raider per this many minutes elapsed — raids scale with the clock. */
export const RAID_SIZE_PER_MINUTE = 4;
/** However hard it scales, a raid never becomes an army. */
export const RAID_MAX_SIZE = 6;
/** How long a raider loots once it reaches the victim's land, before turning for home. */
export const RAID_DURATION_TICKS = seconds(60);
/**
 * The hard cap on a march, in or out. A raider that cannot reach its target in this long
 * gives up and turns for home; one that cannot get home is written off. Without it a raid
 * ordered at an unreachable cell would wander the map for the rest of the match.
 */
export const RAID_MARCH_LIMIT_TICKS = seconds(240);
/**
 * Raiders are skirmishers, owned by nobody: fast, loot villagers, lose any straight
 * fight. They use the skirmisher's own spec rather than a tribal one, so a raid is
 * something a player can measure against a unit they can build themselves.
 */
export const RAIDER_KIND = UnitKind.Skirmisher;
/**
 * Silver a raider takes off a villager it kills — rule VI's "and loot". A tribe keeps no
 * stockpile, so the loot is purely what the victim loses; the Britannia-style loot the
 * brief describes (an overrun mine paying out) is Slice B.
 */
export const RAID_LOOT_SILVER = 5;
