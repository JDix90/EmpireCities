import type { BotView } from '../bot';
import type { Building } from '../buildings';
import type { Command } from '../commands';
import { cellCentre } from '../geometry';
import { BuildingKind, TICKS_PER_MINUTE, UNIT_SPECS, UnitKind, type BuildingKindValue } from '../rules';
import { ColonistBot, type ColonistParams } from './colonist';
import { ownBuildings, stableSortBy } from './helpers';

/**
 * `Rusher` — attack the nearest seat at minute six.
 *
 * The brief's answer to "is elimination too fast?" is measured against this policy: no
 * elimination before minute twelve OUTSIDE Rusher games. So the Rusher is the control —
 * it is supposed to be the fast one, and the question is whether everything else is slow.
 *
 * It marches at a seat, which means rams: nothing else reduces one in reasonable time.
 */
export class RusherBot extends ColonistBot {
  override readonly name = 'rusher';
  private readonly attackTick: number;
  private readonly spears: number;
  private readonly rams: number;
  private marching = false;

  constructor(params: Partial<ColonistParams> & { attackMinute?: number; spears?: number; rams?: number } = {}) {
    super({ villagersBeforeExpanding: 10, ...params });
    this.attackTick = (params.attackMinute ?? 6) * TICKS_PER_MINUTE;
    this.spears = params.spears ?? 4;
    this.rams = params.rams ?? 2;
  }

  protected override buildOrder(): readonly BuildingKindValue[] {
    return [BuildingKind.LumberCamp, BuildingKind.Farm, BuildingKind.Barracks, BuildingKind.Mine, BuildingKind.Farm];
  }

  protected override military(view: BotView, seat: Building): Command[] | null {
    const barracks = ownBuildings(view, BuildingKind.Barracks).find((b) => b.complete);
    if (!barracks) return null;

    const own = view.units.filter((u) => u.owner === view.seat);
    const spears = own.filter((u) => u.kind === UnitKind.Spear).length;
    const rams = own.filter((u) => u.kind === UnitKind.Ram).length;

    // Build the siege train first, then march. A ram without an escort dies to the seat's
    // own tower long before it gets through 1500 hit points.
    if (barracks.queue.length === 0) {
      const want = spears < this.spears ? UnitKind.Spear : rams < this.rams ? UnitKind.Ram : null;
      if (want !== null) {
        const spec = UNIT_SPECS[want];
        const affordable =
          view.player.food >= spec.food && view.player.timber >= spec.timber && view.player.silver >= spec.silver;
        if (affordable && view.player.popCap - view.player.pop >= spec.pop) {
          return [{ type: 'train', building: barracks.id, unit: want }];
        }
      }
    }

    if (view.tick < this.attackTick) return null;
    if (spears < this.spears || rams < this.rams) return null;

    const target = this.nearestEnemySeat(view, seat);
    if (target < 0) return null;
    const army = own.filter((u) => u.kind === UnitKind.Spear || u.kind === UnitKind.Ram);
    // Re-issued only when the band is standing still, so the march is not restarted every
    // second — which would reset every unit's path and make the army walk on the spot.
    const idle = army.filter((u) => !u.moving);
    if (idle.length === 0) return null;
    this.marching = true;
    return idle.map((u) => ({
      type: 'move' as const,
      unit: u.id,
      x: cellCentre(view.grid.colOf(target)),
      y: cellCentre(view.grid.rowOf(target)),
    }));
  }

  /** True once the army has been sent. Read by the lab, which asks whether a rush happened. */
  get hasMarched(): boolean {
    return this.marching;
  }

  private nearestEnemySeat(view: BotView, home: Building): number {
    const seats = view.buildings.filter((b) => b.kind === BuildingKind.Seat && b.owner !== view.seat && b.owner !== 0);
    if (seats.length === 0) return -1;
    const nearest = stableSortBy(seats, (b) => {
      const dc = Math.abs(view.grid.colOf(b.cell) - view.grid.colOf(home.cell));
      const dr = Math.abs(view.grid.rowOf(b.cell) - view.grid.rowOf(home.cell));
      return dc > dr ? dc : dr;
    })[0];
    return nearest.cell;
  }
}
