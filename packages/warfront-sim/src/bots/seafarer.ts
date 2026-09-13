import { cellOf, type BotView } from '../bot';
import type { Command } from '../commands';
import { cellCentre } from '../geometry';
import { BuildingKind, EMBARK_RANGE_CELLS, UnitKind, type BuildingKindValue } from '../rules';
import { ColonistBot, type ColonistParams } from './colonist';
import { cellDistance, ownBuildings, stableSortBy } from './helpers';

/**
 * The shared half of the two policies that use rule V's lanes.
 *
 * The brief names six policies and four were built in step 4; these are the missing two,
 * and they were missing for a reason — `Islander` ("Britannia by lane as early as a port
 * allows") and `Mariner` ("Carthage's game: ports first, islands second") are exactly the
 * policies that cannot exist until the sea does.
 *
 * What they share is one voyage at a time: pick a target across a lane, walk a villager to
 * the quay, put it aboard, and colonise once it is ashore. What they differ in is which
 * target they want, which is the whole of the difference between them.
 *
 * One voyage at a time on purpose. Rule I's price rises with every province held, so a
 * policy that launched three colonists at once would pay the FIRST price three times and
 * arrive with two villagers it could no longer afford to settle.
 */

/** Where a colonist is in its crossing. */
type Stage = 'to-port' | 'aboard' | 'ashore';

export abstract class SeafarerBot extends ColonistBot {
  private voyagerId = -1;
  private voyageProvince = 0;
  private voyageLanding = -1;
  private stage: Stage = 'to-port';

  constructor(params: Partial<ColonistParams> = {}) {
    super(params);
  }

  /**
   * A port after the first farm: nothing can cross before one stands, and the brief puts
   * the Mariner's whole identity in getting there early. The barracks slips one place,
   * which is the trade — a seat that spends eighty timber on a harbour is eighty timber
   * later to its first spear, and whether that is worth it is what the lab is for.
   */
  protected override buildOrder(): readonly BuildingKindValue[] {
    return [
      BuildingKind.LumberCamp,
      BuildingKind.Farm,
      BuildingKind.Port,
      BuildingKind.Barracks,
      BuildingKind.Farm,
      BuildingKind.Mine,
    ];
  }

  /** Which unsettled province across a lane this policy wants. Null when none appeals. */
  protected abstract chooseTarget(view: BotView, reachable: number[]): number | null;

  /**
   * The nearest of a set of reachable provinces, by the crossing its first beach implies.
   *
   * On the base because both policies want it: it IS the Mariner's whole choice, and it is
   * the Islander's fallback once the islands are gone. Sorting by province index instead
   * would be arbitrary — and was, in the first version of this file, where the docstring
   * promised nearest-anything and the code quietly took the lowest number. The mutation
   * that should have caught it could not, because on the test map the lowest number
   * happened to BE the island.
   */
  protected nearestReachable(view: BotView, reachable: number[]): number | null {
    const port = ownBuildings(view, BuildingKind.Port).find((b) => b.complete);
    if (!port) return null;
    const ranked = stableSortBy(reachable, (province) => {
      const beach = view.sea.beaches(province, port.cell)[0];
      return beach === undefined ? Number.MAX_SAFE_INTEGER : cellDistance(view.grid, beach, port.cell);
    });
    return ranked[0] ?? null;
  }

  /**
   * The sea route first, then the land one.
   *
   * A seafarer that walked to the nearest frontier whenever one was free would be a
   * Colonist with a harbour — the point of both policies is that the crossing is the plan,
   * not the fallback.
   */
  protected override expand(view: BotView, seatCell: number): Command[] | null {
    return this.sail(view) ?? super.expand(view, seatCell);
  }

  /** The voyage, one step per think. */
  private sail(view: BotView): Command[] | null {
    const port = ownBuildings(view, BuildingKind.Port).find((b) => b.complete);
    if (!port) return null;

    if (this.voyagerId >= 0) return this.continueVoyage(view, port.cell);

    // Nothing starts until the price is in hand — and it is checked here as well as at
    // the far end, because a colonist that sails without it is a villager parked on a
    // beach for the rest of the match.
    if (view.player.food < view.colonisePrice) return null;

    const home = view.grid.owner(port.cell);
    const settled = new Set(view.provinces.filter((p) => p.owner !== 0 || p.seat >= 0 || p.everSettled).map((p) => p.index));
    const reachable = view.sea.lanesFrom(home).filter((p) => !settled.has(p));
    if (reachable.length === 0) return null;

    const target = this.chooseTarget(view, reachable);
    if (target === null) return null;
    const landing = view.sea.beaches(target, port.cell)[0];
    if (landing === undefined) return null;

    const villager = this.pickVoyager(view, port.cell);
    if (!villager) return null;

    this.voyagerId = villager;
    this.voyageProvince = target;
    this.voyageLanding = landing;
    this.stage = 'to-port';
    // Off its job before it walks: rule II says a villager on a worker list is counted as
    // labour, and one halfway to the harbour is not doing any.
    return [
      { type: 'assign', unit: villager, building: -1 },
      {
        type: 'move',
        unit: villager,
        x: cellCentre(view.grid.colOf(port.cell)),
        y: cellCentre(view.grid.rowOf(port.cell)),
      },
    ];
  }

  private continueVoyage(view: BotView, portCell: number): Command[] | null {
    const unit = view.units.find((u) => u.id === this.voyagerId);
    if (!unit || unit.owner !== view.seat) {
      this.abandon();
      return null;
    }
    const province = view.provinces.find((p) => p.index === this.voyageProvince);
    // Somebody else got there first, or razed it into a claim. Either way it is no longer
    // a thing rule I can buy.
    if (!province || province.owner !== 0 || province.seat >= 0 || province.everSettled) {
      this.abandon();
      return null;
    }

    if (unit.convoy >= 0) {
      this.stage = 'aboard';
      return [];
    }

    const at = cellOf(unit, view.grid);
    if (at < 0) return [];

    if (this.stage === 'aboard') {
      // It has landed. Ashore in the target province is the only place the crossing can
      // have put it, so colonise from where it stands.
      this.stage = 'ashore';
    }

    if (this.stage === 'ashore') {
      if (view.grid.owner(at) !== this.voyageProvince) {
        this.abandon();
        return null;
      }
      if (view.player.food < view.colonisePrice) return [];
      const command: Command = { type: 'colonise', unit: unit.id, province: this.voyageProvince };
      this.abandon();
      return [command];
    }

    // Still walking to the quay.
    const port = ownBuildings(view, BuildingKind.Port).find((b) => b.cell === portCell && b.complete);
    if (!port) {
      this.abandon();
      return null;
    }
    if (cellDistance(view.grid, at, portCell) > EMBARK_RANGE_CELLS) {
      // Re-issued only when it has stopped short: re-ordering every second would reset the
      // path and leave it walking on the spot.
      if (unit.moving) return [];
      return [
        {
          type: 'move',
          unit: unit.id,
          x: cellCentre(view.grid.colOf(portCell)),
          y: cellCentre(view.grid.rowOf(portCell)),
        },
      ];
    }
    return [{ type: 'embark', unit: unit.id, port: port.id, cell: this.voyageLanding }];
  }

  /** The villager nearest the quay that is not already colonising by land. */
  private pickVoyager(view: BotView, portCell: number): number | null {
    const free = view.units.filter(
      (u) => u.owner === view.seat && u.kind === UnitKind.Villager && u.convoy < 0,
    );
    if (free.length <= 1) return null;
    const sorted = stableSortBy(free, (u) => {
      const at = cellOf(u, view.grid);
      return at < 0 ? Number.MAX_SAFE_INTEGER : cellDistance(view.grid, at, portCell);
    });
    return sorted[0].id;
  }

  private abandon(): void {
    this.voyagerId = -1;
    this.voyageProvince = 0;
    this.voyageLanding = -1;
    this.stage = 'to-port';
  }

  /** True while a colonist is crossing. Read by tests and the lab. */
  get isSailing(): boolean {
    return this.voyagerId >= 0;
  }
}

/**
 * `Mariner` — the brief's "Carthage's game: ports first, islands second".
 *
 * Takes the NEAREST thing across a lane, island or not. Carthage's lanes reach Sicily,
 * Sardinia and southern Italy, and the policy being tested is whether a seat that spends
 * early timber on a harbour out-expands one that walks.
 */
export class MarinerBot extends SeafarerBot {
  override readonly name = 'mariner';

  protected chooseTarget(view: BotView, reachable: number[]): number | null {
    return this.nearestReachable(view, reachable);
  }
}

/**
 * `Islander` — the brief's "Britannia by lane as early as a port allows".
 *
 * Wants an ISLAND, and an island is a province the geography gives no land neighbours —
 * which is a property of the map rather than a name hard-coded here. On the western twenty
 * that is Britannia, Sicilia and Sardinia-Corsica, and Britannia is the one three lanes
 * reach, so preferring the most-connected island is what points this policy at the prize
 * without naming it.
 *
 * Falls back to the Mariner's nearest-anything only when no island is left, because a
 * policy that sat in port once Britannia was taken would stop being a policy.
 */
export class IslanderBot extends SeafarerBot {
  override readonly name = 'islander';

  protected chooseTarget(view: BotView, reachable: number[]): number | null {
    const islands = reachable.filter((p) => (view.geography.neighbours.get(p) ?? []).length === 0);
    if (islands.length === 0) return this.nearestReachable(view, reachable);
    // Most lanes first, lowest index breaking a tie: the island everyone can reach is the
    // one worth reaching first.
    const ranked = stableSortBy(islands, (p) => -view.sea.lanesFrom(p).length);
    return ranked[0];
  }
}
