import { cellOf, type Bot, type BotView } from '../bot';
import type { Building } from '../buildings';
import type { Command } from '../commands';
import { cellCentre } from '../geometry';
import {
  BUILDING_COMBAT,
  BUILDING_SPECS,
  BuildingKind,
  Resource,
  UNIT_SPECS,
  UnitKind,
  type BuildingKindValue,
} from '../rules';
import {
  canAfford,
  cellDistance,
  countOwn,
  findBuildSite,
  hiring,
  idleVillagers,
  ownBuildings,
  popRoom,
  seatBuilding,
  underGuard,
  unsettledFrontiers,
} from './helpers';

/**
 * `Colonist` — the baseline: expand as fast as the price allows, and defend.
 *
 * This is the policy every other one is measured against, and the one the seat-fairness
 * self-play runs in every seat, so it is deliberately plain: a fixed build order, a
 * standing rule for idle labour, and one colonist walking at a time. No cleverness, no
 * reading of the opponent. If the map is unbalanced, a mirror of this bot is what says so.
 *
 * The whole policy is a priority list, evaluated once a second, top down — the first
 * thing that applies is what it does. Ordered that way because an economy bot that
 * expanded before it could feed itself would be testing starvation rather than the
 * colonisation price.
 */

export interface ColonistParams {
  /** Villagers to hold before the first colony is worth paying for. */
  villagersBeforeExpanding: number;
  /** Food kept back from the colonisation price, so buying land cannot starve the empire. */
  foodReserve: number;
  /** Population headroom below which a house is worth more than another villager. */
  houseAtRoom: number;
  /** Spears kept at the seat once tribes start raiding (rule VI, from minute two). */
  garrison: number;
  /**
   * How close a raider must be, in cells, before a villager drops its job and runs.
   *
   * Villagers cannot fight at all, so standing still is the same as dying. The brief's own
   * answer to the attention problem is alerts, a jump key and "raiders always visible
   * inside your borders" — that is, a player is expected to RESPOND, and a policy that
   * does not respond is not playing the game the brief describes.
   */
  fleeCells: number;
  /**
   * How far from a seat a new building may be sited, in cells.
   *
   * Province-sized, not neighbourhood-sized. At 4 km cells a province runs 100-250 cells
   * across, and a farm slot is everywhere — but a FOREST slot is not: no seat on this map
   * has forest within fourteen cells, and Gaul and Hispania have no highland near home
   * either. A bot that would only build next to its seat can therefore never raise a
   * lumber camp or a mine, which means it never earns another timber or a single silver
   * for the whole match. Villagers walking to the trees is the cost, and it is the right
   * cost: rule IV says where you settle decides what you can build.
   */
  buildRadius: number;
}

/** The tower's own reach, from the table of buildings that shoot. See `underGuard`. */
const TOWER_RANGE = BUILDING_COMBAT[BuildingKind.Tower].range;

export const COLONIST_DEFAULTS: ColonistParams = {
  villagersBeforeExpanding: 6,
  foodReserve: 60,
  houseAtRoom: 2,
  garrison: 2,
  fleeCells: 8,
  buildRadius: 70,
};

/**
 * The economy order.
 *
 * Timber leads, not food. The opening stock is 100 timber and nothing produces more until
 * a lumber camp stands, so anything built before it is spent from a fixed purse: two farms
 * first leaves twenty timber, thirty short of the lumber camp, and the bot never earns
 * another timber for the rest of the match. Food is the softer constraint because the seat
 * starts with 200 of it and a farm is only 40 timber away.
 */
const BUILD_ORDER: readonly BuildingKindValue[] = [
  BuildingKind.LumberCamp,
  BuildingKind.Farm,
  // Third, not fifth. Rule VI puts the first raid at minute two and villagers cannot
  // fight back at all, so a barracks that arrives after the mine arrives after the
  // economy it was meant to protect.
  BuildingKind.Barracks,
  BuildingKind.Farm,
  BuildingKind.Mine,
];

/**
 * The baseline, and the base class.
 *
 * Raider, Turtle and Rusher are variations on running an economy, not separate species —
 * they all colonise, employ villagers and follow a build order, and differ in what they
 * spend the surplus on and when they stop expanding. Subclassing says that, and means a
 * fix to the economy is a fix to all four rather than to one of four copies.
 */
export class ColonistBot implements Bot {
  readonly name: string = 'colonist';
  protected readonly params: ColonistParams;
  /** The villager currently walking to found a colony, or -1. */
  private colonistId = -1;
  private colonistTarget = -1;
  private colonistProvince = 0;
  /** Villagers running for the seat. They are not re-employed until they get there. */
  private readonly fleeing = new Set<number>();

  constructor(params: Partial<ColonistParams> = {}) {
    this.params = { ...COLONIST_DEFAULTS, ...params };
  }

  think(view: BotView): Command[] {
    const seat = seatBuilding(view);
    // No seat, no policy. A seat that has lost its capital is playing rule III's claim
    // game, which the simulation runs for it as long as a villager is standing there.
    if (!seat) return [];

    return (
      // Running comes first. Everything else this policy might do is worth less than the
      // villagers it would be doing it with.
      this.fleeRaiders(view, seat) ??
      this.finishColonising(view) ??
      this.employIdleVillagers(view, seat.cell) ??
      this.guardTower(view) ??
      this.raiseGarrison(view) ??
      this.military(view, seat) ??
      this.expand(view, seat.cell) ??
      this.buildNext(view, seat.cell) ??
      this.trainVillager(view, seat) ??
      []
    );
  }

  /**
   * Whatever this policy does with a surplus beyond defending itself. The Colonist does
   * nothing — it is the baseline, and every other bot is measured as a delta from it.
   */
  protected military(view: BotView, seat: Building): Command[] | null {
    void view;
    void seat;
    return null;
  }

  /** The build order this policy follows. Overridden by policies with other priorities. */
  protected buildOrder(): readonly BuildingKindValue[] {
    return BUILD_ORDER;
  }

  /** Provinces this policy is willing to hold. The Turtle stops short of the map. */
  protected provinceCeiling(): number {
    return Number.MAX_SAFE_INTEGER;
  }

  /**
   * Villagers near a raider drop their job and run for the seat, which is the one place
   * with a tower over it.
   *
   * Each villager is ordered once per flight — re-issuing every second would reset its
   * path and leave it walking on the spot — and the set is cleared when the raider is
   * gone, so the same villager can flee again from the next raid.
   */
  private fleeRaiders(view: BotView, seat: Building): Command[] | null {
    const raiders = view.units.filter((u) => u.owner === 0);
    if (raiders.length === 0) {
      this.fleeing.clear();
      return null;
    }
    const raiderCells = raiders.map((r) => cellOf(r, view.grid)).filter((c) => c >= 0);
    const commands: Command[] = [];

    // A villager that has already run stays "fleeing" until it actually REACHES the seat,
    // rather than until the raider happens to step out of range. Without that hysteresis
    // it is re-employed the moment the raider turns away, walks back to the same farm, and
    // runs again — a loop the lab caught as 268 assignment orders in one match, with the
    // villagers spending the whole game walking and the economy never accumulating a thing.
    for (const id of [...this.fleeing]) {
      const unit = view.units.find((u) => u.id === id);
      const at = unit ? cellOf(unit, view.grid) : -1;
      if (!unit || at < 0 || chebyshev(view, at, seat.cell) <= 1) this.fleeing.delete(id);
    }

    for (const villager of view.units) {
      if (villager.owner !== view.seat || villager.kind !== UnitKind.Villager) continue;
      if (villager.id === this.colonistId || this.fleeing.has(villager.id)) continue;
      const at = cellOf(villager, view.grid);
      if (at < 0) continue;
      if (!raiderCells.some((c) => chebyshev(view, c, at) <= this.params.fleeCells)) continue;
      // A villager runs even from ground a tower is holding, and the lab is emphatic about
      // it. Letting a defended villager stand its ground earns two more timber
      // worker-minutes across the roster and costs 3.6 villagers per seat — a tower fires
      // once a second at one target, rule VI's raids arrive every ninety seconds and
      // stack, and twenty raiders kill everything under it while it works through them one
      // at a time. What the tower buys is not a villager that stays; it is ground that is
      // still worth COMING BACK to, which is `employIdleVillagers`' side of this.
      this.fleeing.add(villager.id);
      // Off the job first: rule II says the only way off a job is onto another, and a
      // villager still on a farm's worker list is counted as labour it is not doing.
      commands.push({ type: 'assign', unit: villager.id, building: -1 });
      commands.push(this.walkTo(villager.id, seat.cell, view));
    }
    return commands.length > 0 ? commands : null;
  }

  /** A colonist that has arrived plants its seat; one still walking is left alone. */
  private finishColonising(view: BotView): Command[] | null {
    if (this.colonistId < 0) return null;
    const unit = view.units.find((u) => u.id === this.colonistId);
    if (!unit || unit.owner !== view.seat) {
      this.clearColonist();
      return null;
    }
    const province = view.provinces.find((p) => p.index === this.colonistProvince);
    // Somebody else took it, or it was razed and is now claimed rather than bought.
    if (!province || province.owner !== 0 || province.seat >= 0 || province.everSettled) {
      this.clearColonist();
      return null;
    }
    if (cellOf(unit, view.grid) !== this.colonistTarget) {
      // Still walking. Re-issue the walk if it has stopped short — the terrain may have
      // turned it back, and a colonist standing still forever is a lost villager.
      if (unit.moving) return [];
      return [this.walkTo(unit.id, this.colonistTarget, view)];
    }
    if (view.player.food < view.colonisePrice) return [];
    const command: Command = { type: 'colonise', unit: unit.id, province: this.colonistProvince };
    this.clearColonist();
    return [command];
  }

  /** Rule II: an unemployed villager is put on a building, or on raising a new one. */
  private employIdleVillagers(view: BotView, seatCell: number): Command[] | null {
    const idle = idleVillagers(view).filter((u) => u.id !== this.colonistId && !this.fleeing.has(u.id));
    if (idle.length === 0) return null;
    const commands: Command[] = [];
    // A local copy of the free slots, so several villagers in one tick do not all get
    // assigned to the same single opening.
    // Never staff a building with raiders on it: that is feeding villagers to the raid
    // one at a time, which is worse than leaving them idle at the seat.
    const raiderCells = view.units
      .filter((u) => u.owner === 0)
      .map((u) => cellOf(u, view.grid))
      .filter((c) => c >= 0);
    // Ground a tower covers is ground we have already paid to hold. Without this clause the
    // safety test is "is a raider near?" alone, and since `raidTargetCell` aims raids AT
    // producing buildings, an outlying lumber camp is near a raider essentially always —
    // so it is never staffed again after the first raid finds it, tower or no tower.
    const safe = hiring(view, seatCell).filter(
      (b) =>
        underGuard(view, b.cell) ||
        !raiderCells.some((c) => chebyshev(view, c, b.cell) <= this.params.fleeCells),
    );
    const openings = safe.map((b) => {
      const spec = BUILDING_SPECS[b.kind];
      const slots = b.complete ? spec.workerSlots : 4;
      return { id: b.id, free: slots - b.workers.length };
    });
    for (const villager of idle) {
      const opening = openings.find((o) => o.free > 0);
      if (!opening) break;
      opening.free -= 1;
      commands.push({ type: 'assign', unit: villager.id, building: opening.id });
    }
    return commands.length > 0 ? commands : null;
  }

  /** Two spears at the seat once the tribes are due. Rule VI arrives at minute two. */
  protected raiseGarrison(view: BotView): Command[] | null {
    const barracks = ownBuildings(view, BuildingKind.Barracks).find((b) => b.complete);
    if (!barracks) return null;
    const spears = view.units.filter((u) => u.owner === view.seat && u.kind === UnitKind.Spear).length;
    const queued = barracks.queue.length;
    if (spears + queued >= this.params.garrison) return null;
    const spec = UNIT_SPECS[UnitKind.Spear];
    if (view.player.food < spec.food + this.params.foodReserve || view.player.silver < spec.silver) return null;
    if (popRoom(view) < spec.pop) return null;
    return [{ type: 'train', building: barracks.id, unit: UnitKind.Spear }];
  }

  /**
   * A tower over the timber source, once one stands.
   *
   * The brief's answer to raids is "towers on the shared border" and a tower "fires on its
   * own" — which is the whole point under rule VI. A lumber camp is not near the seat and
   * cannot be: no seat on this map has forest inside fourteen cells, so the camp is tens of
   * cells out, alone, and it is also precisely where raids are aimed (`raidTargetCell`
   * prefers a producing building). A villager walks 54 cells a minute, so a raider passing
   * within `fleeCells` costs the camp a round trip measured in minutes — and raids arrive
   * every ninety seconds. Measured without this: the camp earned six worker-minutes out of
   * forty, and timber income was zero from minute four to the end of the match.
   *
   * A tower answers it without spending attention, which is the one resource a policy
   * cannot buy. It is deliberately the FIRST call on the opening silver, ahead of the
   * garrison: thirty silver buys either one tower that defends the economy forever or two
   * spears that die, and only one of those leaves a seat still earning at minute twenty.
   */
  protected guardTower(view: BotView): Command[] | null {
    if (!canAfford(view, BuildingKind.Tower)) return null;
    const towers = ownBuildings(view, BuildingKind.Tower);
    for (const source of ownBuildings(view)) {
      if (!source.complete) continue;
      const spec = BUILDING_SPECS[source.kind];
      if (!spec || spec.produces === Resource.None) continue;
      // Already defended: by the seat's own guns, or by a tower that is finished. A tower
      // still going up is counted separately, below — it shoots nothing yet, but a policy
      // that ignored it would queue a fresh one every second until the timber ran out.
      if (underGuard(view, source.cell)) continue;
      if (towers.some((t) => cellDistance(view.grid, t.cell, source.cell) <= TOWER_RANGE)) continue;
      const site = findBuildSite(view, BuildingKind.Tower, source.cell, TOWER_RANGE);
      if (site < 0) continue;
      const builder = this.pickBuilder(view, site);
      if (builder === null) continue;
      return [{ type: 'build', unit: builder, kind: BuildingKind.Tower, cell: site }];
    }
    return null;
  }

  /** Rule I: send one villager to found the nearest colony this seat can afford. */
  protected expand(view: BotView, seatCell: number): Command[] | null {
    if (this.colonistId >= 0) return null;
    if (view.provinces.filter((p) => p.owner === view.seat).length >= this.provinceCeiling()) return null;
    const villagers = view.units.filter((u) => u.owner === view.seat && u.kind === UnitKind.Villager);
    if (villagers.length < this.params.villagersBeforeExpanding) return null;
    if (view.player.food < view.colonisePrice + this.params.foodReserve) return null;

    const target = unsettledFrontiers(view, seatCell, 1)[0];
    if (!target) return null;

    // The villager nearest the target goes, so the walk is as short as the map allows;
    // ties fall to the lowest id because the list is in ascending id order.
    let chosen = villagers[0];
    let best = Infinity;
    for (const villager of villagers) {
      const at = cellOf(villager, view.grid);
      if (at < 0) continue;
      const dc = Math.abs(view.grid.colOf(at) - view.grid.colOf(target.cell));
      const dr = Math.abs(view.grid.rowOf(at) - view.grid.rowOf(target.cell));
      const d = dc > dr ? dc : dr;
      if (d < best) {
        best = d;
        chosen = villager;
      }
    }

    this.colonistId = chosen.id;
    this.colonistTarget = target.cell;
    this.colonistProvince = target.province;
    // Taken off its job first: a villager still on a farm's worker list would be counted
    // as labour it no longer is, and rule II says the only way off a job is onto another.
    return [{ type: 'assign', unit: chosen.id, building: -1 }, this.walkTo(chosen.id, target.cell, view)];
  }

  /**
   * The next building in the order, sited near the seat on ground that will take it.
   *
   * The order is WALKED rather than indexed, because a kind whose ground does not exist
   * in this province can never be built here however long the bot waits, and stalling on
   * it stalls everything behind it. That is not hypothetical: the committed map gives
   * Rome and Carthage no forest at all inside their home province, so their lumber camp
   * has no site — and the lab measured the consequence. Both seats raised not one
   * building in a whole match, banked their opening food against a colonisation price
   * they had no income to reach, and starved to death by minute nine.
   *
   * Affordability is deliberately NOT skipped the same way, and the difference is the
   * point: a kind that is merely unpaid-for is the thing the bot is saving towards, and
   * stepping past it to something cheaper is exactly how the order collapses into all
   * the farms first. Waiting for timber is a plan; waiting for forest to appear is not.
   */
  private buildNext(view: BotView, seatCell: number): Command[] | null {
    for (const kind of this.wantedBuildings(view)) {
      const site = findBuildSite(view, kind, seatCell, this.params.buildRadius);
      if (site < 0) continue;
      if (!canAfford(view, kind)) return null;
      // A villager already at work is the right builder: it is nearest, and construction
      // finishing frees it straight back onto a job.
      const builder = this.pickBuilder(view, site);
      if (!builder) return null;
      return [{ type: 'build', unit: builder, kind, cell: site }];
    }
    return null;
  }

  /**
   * What this policy still wants to raise, in the order it wants it.
   *
   * The ORDER is the policy, so it is walked in sequence and each kind already standing
   * consumes one slot of its own kind as it goes. Tallying the list by kind instead —
   * "two farms wanted, one lumber camp wanted" — collapses it into all the farms first,
   * which on the opening stock spends every last timber on farms and leaves the bot
   * unable to afford the lumber camp that is the only source of more. It deadlocks at
   * twenty timber for the rest of the match.
   *
   * A house jumps the queue when population is the binding constraint: the brief's own
   * pop rule makes a house the cheapest unit you can buy.
   */
  private wantedBuildings(view: BotView): BuildingKindValue[] {
    const wanted: BuildingKindValue[] = [];
    if (popRoom(view) <= this.params.houseAtRoom && canAfford(view, BuildingKind.House)) {
      wanted.push(BuildingKind.House);
    }
    const spare = new Map<BuildingKindValue, number>();
    for (const kind of this.buildOrder()) {
      if (!spare.has(kind)) spare.set(kind, countOwn(view, kind));
      const have = spare.get(kind)!;
      if (have > 0) {
        spare.set(kind, have - 1);
        continue;
      }
      wanted.push(kind);
    }
    return wanted;
  }

  /** The villager nearest a site, preferring one that is not mid-construction elsewhere. */
  protected pickBuilder(view: BotView, site: number): number | null {
    const sites = new Set(view.buildings.filter((b) => !b.complete).map((b) => b.id));
    let best: number | null = null;
    let bestKey = Infinity;
    for (const unit of view.units) {
      if (unit.owner !== view.seat || unit.kind !== UnitKind.Villager) continue;
      if (unit.id === this.colonistId) continue;
      const at = cellOf(unit, view.grid);
      if (at < 0) continue;
      const dc = Math.abs(view.grid.colOf(at) - view.grid.colOf(site));
      const dr = Math.abs(view.grid.rowOf(at) - view.grid.rowOf(site));
      // Builders already on a site cost a half-finished building to take away, so they
      // sort behind everyone else rather than being excluded — with two villagers and one
      // site, excluding them would stall the build order entirely.
      const busy = sites.has(unit.job) ? 1_000_000 : 0;
      const key = busy + (dc > dr ? dc : dr);
      if (key < bestKey) {
        bestKey = key;
        best = unit.id;
      }
    }
    return best;
  }

  /**
   * More villagers, always, while there is food and somewhere to put them.
   *
   * No food reserve here, deliberately. The reserve exists so that BUYING LAND cannot
   * starve the empire; applying it to training too means a seat that has lost its
   * villagers to a raid sits on ninety-seven food refusing to train the one villager
   * that would restart its income, forever. A villager pays for itself; a province does
   * not.
   */
  protected trainVillager(view: BotView, seat: Building): Command[] | null {
    const spec = UNIT_SPECS[UnitKind.Villager];
    if (popRoom(view) < spec.pop) return null;
    if (view.player.food < spec.food) return null;
    // Stop and BANK once there are enough hands and there is somewhere to put a colony.
    // Rule I is the centre of the game — "colonise, and it costs more each time" — and a
    // policy that spends every forty food the moment it arrives never accumulates the
    // price, so it never colonises at all. The lab measured exactly that: twenty-four
    // four-seat matches, every one a four-way tie on one province each, with the
    // colonisation price never paid once and therefore never tested.
    const villagers = view.units.filter((u) => u.owner === view.seat && u.kind === UnitKind.Villager).length;
    if (
      villagers >= this.params.villagersBeforeExpanding &&
      view.player.food < view.colonisePrice + this.params.foodReserve &&
      unsettledFrontiers(view, seat.cell, 1).length > 0
    ) {
      return null;
    }
    const building = view.buildings.find((b) => b.id === seat.id);
    // One in the queue at a time: the food is spent on enqueue, and a seat with five
    // queued villagers has nothing left to pay a colonisation price with.
    if (!building || building.queue.length > 0) return null;
    return [{ type: 'train', building: seat.id, unit: UnitKind.Villager }];
  }

  protected walkTo(unit: number, cell: number, view: BotView): Command {
    return { type: 'move', unit, x: cellCentre(view.grid.colOf(cell)), y: cellCentre(view.grid.rowOf(cell)) };
  }

  private clearColonist(): void {
    this.colonistId = -1;
    this.colonistTarget = -1;
    this.colonistProvince = 0;
  }
}

/** Chebyshev distance in cells between two cell indices. */
function chebyshev(view: BotView, a: number, b: number): number {
  const dc = Math.abs(view.grid.colOf(a) - view.grid.colOf(b));
  const dr = Math.abs(view.grid.rowOf(a) - view.grid.rowOf(b));
  return dc > dr ? dc : dr;
}
