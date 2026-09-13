import { mix32, Rng } from './rng';
import { TICK_RATE } from './constants';
import { toIntFloor } from './fixed';
import type { Command } from './commands';
import type { Building } from './buildings';
import type { Player } from './players';
import type { Province } from './provinces';
import type { Unit } from './entities';
import type { TerrainGrid } from './terrain';
import type { ProvinceGeography } from './tribes';
import type { Sim } from './sim';

/**
 * The seam a policy bot acts through.
 *
 * Bots are POLICIES, not intelligence: fixed build orders with a few timing parameters,
 * driving the same command API a human does. That last part is the point — because they
 * go through `sim.issue`, their orders land in the replay exactly as a human's would, a
 * bot cannot reach past the command surface to move a unit it does not own, and the same
 * bots can be the live solo opponent without a second code path.
 *
 * ## What a bot may see
 *
 * Everything a human currently sees, and nothing more. Decision 26 is "ownership is
 * public; positions are fogged", but fog does not exist yet — the tactical view shows
 * every unit on the map — so a view that hid enemy positions from bots would handicap
 * them against a human who can see them. This interface is the ONE seam where fog will
 * be applied when it arrives, and the only place that will need to change.
 *
 * ## Determinism
 *
 * A bot's `rng` is its own stream, seeded from the match seed and its seat. It must never
 * draw from the simulation's — tribe raid targeting reads that stream, so a bot pulling
 * from it would make raids depend on how many decisions its opponents happened to make.
 */
export interface BotView {
  /** The seat this bot plays. */
  readonly seat: number;
  /** Current tick; `tick / TICK_RATE` is seconds elapsed. */
  readonly tick: number;
  readonly grid: TerrainGrid;
  /** This bot's own generator. Never the simulation's. */
  readonly rng: Rng;
  readonly player: Player;
  /** Every province and who holds it — public information, per decision 26. */
  readonly provinces: readonly Province[];
  /** Every unit on the map, both sides. See the fog note above. */
  readonly units: readonly Unit[];
  readonly buildings: readonly Building[];
  /** What this seat's next province costs right now (rule I). */
  readonly colonisePrice: number;
  /** Provinces on the map, for majority arithmetic. */
  readonly provinceCount: number;
  /**
   * Land adjacency and frontier cells, derived from the grid once per match. A bot that
   * answered "which neutral province is nearest" by scanning the map would cost more than
   * the simulation it plays, so it asks this instead.
   */
  readonly geography: ProvinceGeography;
}

export interface Bot {
  /** Short stable name, used in lab output and match records. */
  readonly name: string;
  /**
   * Orders for this moment. Called on a fixed cadence rather than every tick, and
   * returning an empty array is the normal case — a policy that had nothing to do.
   */
  think(view: BotView): Command[];
}

/**
 * How often a bot is asked for orders: once a second.
 *
 * Every tick would be both wasteful and dishonest — no human issues fifteen orders a
 * second, and a bot that could would not be testing the game humans will play. It is also
 * the knob that makes bots cheaper than the simulation they drive, which is what lets the
 * lab run thousands of matches.
 */
export const BOT_THINK_INTERVAL_TICKS = TICK_RATE;

/**
 * The tick offset within the interval at which a seat thinks.
 *
 * Staggered so four bots do not all decide on the same tick and then all issue orders
 * that land on the same two ticks later. Deterministic, and derived from the seat alone.
 */
export function botThinkOffset(seat: number, interval: number = BOT_THINK_INTERVAL_TICKS): number {
  return ((seat % interval) + interval) % interval;
}

/** True when this seat is due to think on this tick. */
export function shouldThink(seat: number, tick: number, interval: number = BOT_THINK_INTERVAL_TICKS): boolean {
  return ((tick % interval) + interval) % interval === botThinkOffset(seat, interval);
}

/** A bot's private generator seed: the match seed stirred with the seat. */
export function botSeed(matchSeed: number, seat: number): number {
  return mix32((matchSeed ^ mix32(seat >>> 0)) >>> 0) >>> 0;
}

/** Builds the view a seat sees this tick. Cheap: it borrows the sim's own arrays. */
export function viewFor(sim: Sim, seat: number, rng: Rng, geography: ProvinceGeography): BotView | null {
  const player = sim.players.get(seat);
  const grid = sim.terrain;
  if (!player || !grid) return null;
  return {
    seat,
    tick: sim.tick,
    grid,
    rng,
    player,
    provinces: sim.provinces.all(),
    units: sim.entities.all(),
    buildings: sim.buildings.all(),
    colonisePrice: sim.colonisePriceFor(seat),
    provinceCount: sim.provinces.all().length,
    geography,
  };
}

/** The cell a unit is standing on, or -1 when it has somehow left the grid. */
export function cellOf(unit: Unit, grid: TerrainGrid): number {
  const col = toIntFloor(unit.x);
  const row = toIntFloor(unit.y);
  return grid.inBounds(col, row) ? grid.index(col, row) : -1;
}

/** A fresh generator for a seat in a match. */
export function rngFor(matchSeed: number, seat: number): Rng {
  return new Rng(botSeed(matchSeed, seat));
}
