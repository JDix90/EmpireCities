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
import { assertInt } from './fixed';

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
  Camp: 8,
  Port: 9,
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
  [BuildingKind.Camp]: 'camp',
  [BuildingKind.Port]: 'port',
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
  /**
   * Rule VII's marching camp, and the only building that costs no resources.
   *
   * That is deliberate, not an oversight: an army deep in someone else's land has no
   * supply line to spend from, and the brief's price is stated in soldiers rather than
   * timber — "five+ soldiers can build a camp". The five standing there ARE the cost,
   * and they are not fighting while they raise it.
   *
   * What stops a free camp from cancelling the rule is the other two numbers. It takes
   * thirty seconds to raise, which is three bleeds at the attrition interval, and it has
   * a quarter of a seat's health so the defender can burn it — "the defender can burn it"
   * needs no mechanism of its own, because a camp is a building and rams and soldiers
   * already know how to knock those down. An army that keeps marching outruns its own
   * camp radius and bleeds again, which is the whole of "camp first, then rams".
   */
  /**
   * Rule V's port. The one building that must stand on a COAST, which the terrain decides
   * — see coast.ts, where a coast is derived rather than stored because the asset has no
   * coast biome to read.
   *
   * `biomes` stays empty even so: this table's biome list is a whole-cell test, and being
   * coastal is a property of a cell's NEIGHBOURS, not of the cell. The build path checks
   * it separately, which is also where the "province must have a lane" rule lives — a
   * harbour facing an empty sea is a waste of eighty timber, and the game should say so
   * rather than let it be built.
   */
  [BuildingKind.Port]: {
    timber: 80,
    silver: 20,
    buildTicks: seconds(30),
    hp: 400,
    pop: 0,
    produces: Resource.None,
    yieldPerMinute: 0,
    workerSlots: 0,
    biomes: [],
  },
  [BuildingKind.Camp]: {
    timber: 0,
    silver: 0,
    buildTicks: seconds(30),
    hp: 375,
    pop: 0,
    produces: Resource.None,
    yieldPerMinute: 0,
    workerSlots: 0,
    biomes: [],
  },
};

/**
 * Starting stock, per the brief: seat, 4 villagers, 1 scout, 200 food, 100 timber.
 *
 * The silver is NOT from the brief, and it is here because the brief's own minute-two
 * beat cannot be played without it. That line reads "Two spears at the seat, then a
 * second colony" — but a spear costs 15 silver, silver comes only from a mine, a mine
 * needs hills, and no seat on this map has hills inside its opening build range. Starting
 * at zero silver makes the first defensive unit in the game unbuildable until several
 * minutes after the raids that need it, and the lab measured the result: in a Colonist
 * mirror every villager on the map was dead by minute five and neither seat recovered.
 *
 * Thirty is exactly the two spears the brief tells you to build, and not a silver more,
 * so the mine stays the thing that pays for a third.
 */
export const START_FOOD = 200;
/**
 * 160, not the brief's 100, for the same reason as the silver above: the brief's own
 * opening does not fit in 100.
 *
 * The arithmetic. Only a lumber camp produces timber, so everything raised before one
 * comes out of the starting purse. The brief's minute-two board is a lumber camp (30), a
 * farm (40) and "two spears at the seat" — and spears need a barracks (80). That is 150
 * of a 100-timber start, so with the brief's figures the very first raid arrives against
 * a seat that cannot have built the thing that answers it, whatever the player does.
 * 160 covers the three and leaves ten over, which keeps the second farm a decision rather
 * than a formality.
 *
 * The alternative — a cheaper barracks — was not taken because the brief fixes that
 * number in its own building list, while the starting stock is a line the lab was
 * explicitly built to correct.
 */
export const START_TIMBER = 160;
export const START_SILVER = 30;
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

/* ── Attrition and the marching camp (rule VII) ───────────────────────────────── */

/**
 * The bleed. The brief fixes both numbers: "Attrition 1% of health per 10s outside your
 * borders and outside a camp."
 *
 * Percent of MAX health rather than current, so the bleed stays linear instead of going
 * asymptotic and never killing anything: a spear that marches out at minute two is dead
 * ten minutes later wherever it is standing, and an army abroad is a clock its owner can
 * read.
 *
 * Worth knowing that at TODAY'S roster the choice is invisible. Nothing fields more than
 * 120 health, 1% of which floors to zero, so the one-point minimum in `stepAttrition` is
 * what actually sets the rate and every unit in the game bleeds the same single point per
 * interval — a ram simply takes twice as long to die as a spear because it has twice the
 * health. A mutation swapping max for current is therefore undetectable, which is how this
 * note came to be written: the test suite could not tell the two apart, and the honest
 * thing is to say so rather than to claim a distinction the numbers do not yet support.
 * It starts to matter the moment anything fields 200 health or more.
 */
export const ATTRITION_INTERVAL_TICKS = seconds(10);
export const ATTRITION_PERCENT_PER_INTERVAL = 1;

/**
 * WHERE the bleed applies, and the one place the brief contradicts itself.
 *
 * Rule VII's own line is "Inside enemy borders your army bleeds". The economy section's
 * line, which is the one carrying the numbers, is "outside your borders and outside a
 * camp". Those are different sets, and the difference is every neutral province — which
 * at minute zero is the entire map bar four cells.
 *
 * `ATTRITION_IN_NEUTRAL` is the switch between the two readings, and it is a constant
 * rather than a decision because it is exactly the sort of question the lab exists to
 * answer: a match is already dangerous in neutral land (rule VI puts a tribe in every
 * province of it), so taxing it twice may punish leaving home rather than punishing deep
 * invasion, which is what rule VII is for. Measured, then set — see the PR.
 */
export const ATTRITION_IN_NEUTRAL = false;

/**
 * Soldiers needed within `CAMP_MUSTER_CELLS` of the site before a camp may be raised, and
 * how far its protection reaches.
 *
 * Five is the brief's figure. The two distances are not — they are first guesses, and the
 * radius is the more interesting of the two: too small and an army cannot shelter under
 * its own camp, too large and one camp covers the siege, the reinforcements and the road
 * home. A radius a little over the muster distance means the army that built it is
 * covered and the next province is not.
 */
/* ── The sea lane (rule V) ────────────────────────────────────────────────────── */

/**
 * Units one convoy can carry. The brief says "port level caps convoy size", and there is
 * no port LEVEL in the game — levels are not specified anywhere in the brief and nothing
 * else in Slice A upgrades a building. So this is the cap of the only port there is, and
 * the level mechanic is a Slice B question rather than a number invented here.
 */
export const PORT_CONVOY_CAP = 8;

/**
 * How close a unit must be to the quay to board. One cell of slack, the same tolerance
 * rule II already uses for a worker standing at its building.
 */
export const EMBARK_RANGE_CELLS = 1;

/**
 * Transit time, and the place the brief's numbers meet the map and lose.
 *
 * The brief says "transit 1-2 minutes by lane length" and gives the Tin Route "three-
 * minute transit". Measured on the committed asset, the fourteen lanes run from 2 cells
 * (Italy to Sicily, 8 km) to 141 (Sardinia to Tarraconensis, 564 km) — a seventyfold
 * spread. Anything strictly proportional across that range either makes the short
 * crossings instant or the long ones enormous, and a flat 1-2 minutes would make an 8 km
 * strait cost the same as a 564 km open-sea passage, which throws away the only thing
 * lane length is for.
 *
 * So: a floor, a slope, and a ceiling. Sixty seconds for stepping across a strait, about
 * four fifths of a second per cell after that, and no crossing longer than three minutes.
 * Eleven of the fourteen lanes land inside the brief's 1-2 minute band, the two longest
 * run over it because they genuinely are long, and the proposed Lusitania-Britannia tin
 * route comes out at about 2.6 minutes rather than the brief's 3 — which is the map
 * disagreeing with a figure written before anyone measured it, and the map is the thing
 * players will actually sail.
 */
export const TRANSIT_BASE_TICKS = seconds(60);
export const TRANSIT_TICKS_PER_CELL = 13;
export const TRANSIT_MAX_TICKS = seconds(180);

/** Whole ticks a convoy spends at sea crossing `cells` of open water. */
export function transitTicks(cells: number): number {
  const ticks = TRANSIT_BASE_TICKS + assertInt(cells, 'lane length') * TRANSIT_TICKS_PER_CELL;
  return ticks > TRANSIT_MAX_TICKS ? TRANSIT_MAX_TICKS : ticks;
}

/**
 * Landing where you are not welcome: "20s at half armour", the brief's own figures.
 *
 * Half armour is expressed as a damage MULTIPLIER because armour does not exist as a
 * stat — the roster has health and damage and nothing between them — so halving armour
 * is doubling what gets through, which is the same thing said in the vocabulary the
 * simulation has.
 */
export const DISEMBARK_TICKS = seconds(20);
export const DISEMBARK_DAMAGE_PERCENT = 200;

/**
 * How many beaches a province offers, and how far apart they must be.
 *
 * "Islands have several beaches so one tower can't seal them" is the requirement, and the
 * separation is what delivers it: a tower reaches six cells, so beaches fifteen apart
 * cannot be covered by one. Four of them because a defender with four places to watch has
 * to choose, which is what makes the brief's decoy convoy a real play rather than a feint
 * at the only door.
 */
export const BEACHES_PER_PROVINCE = 4;
export const BEACH_SEPARATION_CELLS = 15;

export const CAMP_MIN_SOLDIERS = 5;
export const CAMP_MUSTER_CELLS = 6;
export const CAMP_RADIUS_CELLS = 8;

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
/**
 * How far apart two tribes' FIRST raids fall.
 *
 * The brief's timeline is precise about this and the first build was not: minute two is
 * "first tribal raid on a border lumber camp" — one raid — and it is minute FOUR that
 * brings "raids every 90s from each neutral border". Starting every tribe on the same
 * clock instead meant a seat with four neutral frontiers met four simultaneous raids at
 * minute two, against an economy that by the brief's own roster cannot have bought a
 * single spear yet (a spear costs silver, seats start with none, and silver comes only
 * from a mine). Measured in the lab, that wiped every villager off the map by minute
 * five in a Colonist mirror and neither seat ever recovered.
 *
 * Staggering by the tribe's own province index spreads the frontier up over the first
 * few minutes, which is what the timeline describes, and is deterministic.
 */
export const RAID_STAGGER_TICKS = seconds(30);
/** Tribes past this many are folded back onto the same offsets rather than raiding later. */
export const RAID_STAGGER_WRAP = 8;
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
