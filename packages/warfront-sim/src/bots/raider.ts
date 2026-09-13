import type { BotView } from '../bot';
import type { Building } from '../buildings';
import type { Command } from '../commands';
import { cellCentre } from '../geometry';
import { BUILDING_SPECS, BuildingKind, Resource, UNIT_SPECS, UnitKind, type BuildingKindValue } from '../rules';
import { ColonistBot, type ColonistParams } from './colonist';
import { ownBuildings, stableSortBy } from './helpers';

/**
 * `Raider` — early skirmishers, harassing lumber camps.
 *
 * The brief's own description, and the policy that tests whether harassment pays: it
 * trades expansion for pressure, and the metric that matters is whether the exchange is
 * worth it. The target is the enemy's WORK, not their army — a skirmisher loses any
 * straight fight and doubles on villagers, so it goes where the villagers are.
 */
export class RaiderBot extends ColonistBot {
  override readonly name = 'raider';
  private readonly skirmishers: number;

  constructor(params: Partial<ColonistParams> & { skirmishers?: number } = {}) {
    super({ villagersBeforeExpanding: 8, ...params });
    this.skirmishers = params.skirmishers ?? 4;
  }

  /** Barracks second, because the whole policy is buying skirmishers early. */
  protected override buildOrder(): readonly BuildingKindValue[] {
    return [BuildingKind.LumberCamp, BuildingKind.Barracks, BuildingKind.Farm, BuildingKind.Mine, BuildingKind.Farm];
  }

  protected override military(view: BotView, seat: Building): Command[] | null {
    const barracks = ownBuildings(view, BuildingKind.Barracks).find((b) => b.complete);
    if (!barracks) return null;

    const mine = view.units.filter((u) => u.owner === view.seat && u.kind === UnitKind.Skirmisher);
    const spec = UNIT_SPECS[UnitKind.Skirmisher];
    if (mine.length + barracks.queue.length < this.skirmishers) {
      const affordable = view.player.food >= spec.food && view.player.silver >= spec.silver;
      const room = view.player.popCap - view.player.pop >= spec.pop;
      if (affordable && room && barracks.queue.length === 0) {
        return [{ type: 'train', building: barracks.id, unit: UnitKind.Skirmisher }];
      }
      return null;
    }

    // A full band goes hunting. Combat is auto-attack, so an order to walk at the target
    // IS the attack — there is no separate attack command and there does not need to be.
    const target = this.hunt(view);
    if (target < 0) return null;
    const idle = mine.filter((u) => !u.moving);
    if (idle.length < this.skirmishers) return null;
    void seat;
    return idle.map((u) => ({
      type: 'move' as const,
      unit: u.id,
      x: cellCentre(view.grid.colOf(target)),
      y: cellCentre(view.grid.rowOf(target)),
    }));
  }

  /**
   * The nearest enemy building that PAYS somebody — a lumber camp, a farm, a mine.
   * Villagers stand on those, and villagers are what a skirmisher is for.
   */
  private hunt(view: BotView): number {
    const home = ownBuildings(view, BuildingKind.Seat)[0];
    if (!home) return -1;
    const prey = view.buildings.filter((b) => {
      if (b.owner === view.seat || b.owner === 0 || !b.complete) return false;
      return BUILDING_SPECS[b.kind]?.produces !== Resource.None;
    });
    if (prey.length === 0) return -1;
    const nearest = stableSortBy(prey, (b) => {
      const dc = Math.abs(view.grid.colOf(b.cell) - view.grid.colOf(home.cell));
      const dr = Math.abs(view.grid.rowOf(b.cell) - view.grid.rowOf(home.cell));
      return dc > dr ? dc : dr;
    })[0];
    return nearest.cell;
  }
}
