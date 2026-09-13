import { cellOf, type Bot, type BotView } from '../bot';
import type { Command } from '../commands';
import { cellCentre } from '../geometry';
import { BUILDING_SPECS, BuildingKind, UNIT_SPECS, UnitKind, type BuildingKindValue } from '../rules';
import {
  canAfford,
  countOwn,
  findBuildSite,
  hiring,
  idleVillagers,
  ownBuildings,
  popRoom,
  seatBuilding,
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

export const COLONIST_DEFAULTS: ColonistParams = {
  villagersBeforeExpanding: 6,
  foodReserve: 60,
  houseAtRoom: 2,
  garrison: 2,
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

export class ColonistBot implements Bot {
  readonly name = 'colonist';
  private readonly params: ColonistParams;
  /** The villager currently walking to found a colony, or -1. */
  private colonistId = -1;
  private colonistTarget = -1;
  private colonistProvince = 0;

  constructor(params: Partial<ColonistParams> = {}) {
    this.params = { ...COLONIST_DEFAULTS, ...params };
  }

  think(view: BotView): Command[] {
    const seat = seatBuilding(view);
    // No seat, no policy. A seat that has lost its capital is playing rule III's claim
    // game, which the simulation runs for it as long as a villager is standing there.
    if (!seat) return [];

    return (
      this.finishColonising(view) ??
      this.employIdleVillagers(view, seat.cell) ??
      this.raiseGarrison(view) ??
      this.expand(view, seat.cell) ??
      this.buildNext(view, seat.cell) ??
      this.trainVillager(view, seat) ??
      []
    );
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
    const idle = idleVillagers(view).filter((u) => u.id !== this.colonistId);
    if (idle.length === 0) return null;
    const commands: Command[] = [];
    // A local copy of the free slots, so several villagers in one tick do not all get
    // assigned to the same single opening.
    const openings = hiring(view, seatCell).map((b) => {
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
  private raiseGarrison(view: BotView): Command[] | null {
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

  /** Rule I: send one villager to found the nearest colony this seat can afford. */
  private expand(view: BotView, seatCell: number): Command[] | null {
    if (this.colonistId >= 0) return null;
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

  /** The next building in the order, sited near the seat on ground that will take it. */
  private buildNext(view: BotView, seatCell: number): Command[] | null {
    const kind = this.nextBuilding(view);
    if (kind === null || !canAfford(view, kind)) return null;
    const site = findBuildSite(view, kind, seatCell, this.params.buildRadius);
    if (site < 0) return null;
    // A villager already at work is the right builder: it is nearest, and construction
    // finishing frees it straight back onto a job.
    const builder = this.pickBuilder(view, site);
    if (!builder) return null;
    return [{ type: 'build', unit: builder, kind, cell: site }];
  }

  /**
   * What to raise next: the first slot in the order that is not yet filled.
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
  private nextBuilding(view: BotView): BuildingKindValue | null {
    if (popRoom(view) <= this.params.houseAtRoom && canAfford(view, BuildingKind.House)) {
      return BuildingKind.House;
    }
    const spare = new Map<BuildingKindValue, number>();
    for (const kind of BUILD_ORDER) {
      if (!spare.has(kind)) spare.set(kind, countOwn(view, kind));
      const have = spare.get(kind)!;
      if (have > 0) {
        spare.set(kind, have - 1);
        continue;
      }
      return kind;
    }
    return null;
  }

  /** The villager nearest a site, preferring one that is not mid-construction elsewhere. */
  private pickBuilder(view: BotView, site: number): number | null {
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
  private trainVillager(view: BotView, seat: { id: number }): Command[] | null {
    const spec = UNIT_SPECS[UnitKind.Villager];
    if (popRoom(view) < spec.pop) return null;
    if (view.player.food < spec.food) return null;
    const building = view.buildings.find((b) => b.id === seat.id);
    // One in the queue at a time: the food is spent on enqueue, and a seat with five
    // queued villagers has nothing left to pay a colonisation price with.
    if (!building || building.queue.length > 0) return null;
    return [{ type: 'train', building: seat.id, unit: UnitKind.Villager }];
  }

  private walkTo(unit: number, cell: number, view: BotView): Command {
    return { type: 'move', unit, x: cellCentre(view.grid.colOf(cell)), y: cellCentre(view.grid.rowOf(cell)) };
  }

  private clearColonist(): void {
    this.colonistId = -1;
    this.colonistTarget = -1;
    this.colonistProvince = 0;
  }
}
