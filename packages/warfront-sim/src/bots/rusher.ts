import type { BotView } from '../bot';
import type { Building } from '../buildings';
import type { Command } from '../commands';
import { cellCentre } from '../geometry';
import {
  BuildingKind,
  CAMP_MIN_SOLDIERS,
  CAMP_MUSTER_CELLS,
  TICKS_PER_MINUTE,
  UNIT_SPECS,
  UnitKind,
  type BuildingKindValue,
} from '../rules';
import { cellOf } from '../bot';
import { ColonistBot, type ColonistParams } from './colonist';
import { campCovers, cellDistance, ownBuildings, soldiersOnForeignGround, stableSortBy } from './helpers';

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

    // Rule VII, and the brief's own order of operations: "camp first, then rams." A siege
    // is the one thing in the game that has to STAND somewhere hostile for minutes at a
    // time, so the Rusher is the policy the rule exists to price — a ram grinding 1500
    // hit points while its escort bleeds a point every ten seconds is the exact trade the
    // camp answers.
    //
    // Only the Rusher does this, deliberately. The Raider is harassment — "a raid, not a
    // war" — and a raiding band that stopped to fortify would be playing a different rule.
    const camp = this.campIfBesieging(view);
    if (camp) return camp;
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

  /**
   * Plant a camp where the army has come to a stop on enemy ground.
   *
   * Sited on the soldier that has the most company within muster range rather than on the
   * first one found, so the camp lands in the middle of the band and its radius covers
   * the siege instead of one flank of it.
   */
  private campIfBesieging(view: BotView): Command[] | null {
    const arrived = soldiersOnForeignGround(view);
    if (arrived.length < CAMP_MIN_SOLDIERS) return null;

    let best: { unit: number; cell: number; company: number } | null = null;
    for (const soldier of arrived) {
      const cell = cellOf(soldier, view.grid);
      if (cell < 0 || campCovers(view, cell)) continue;
      const company = arrived.filter((u) => {
        const at = cellOf(u, view.grid);
        return at >= 0 && cellDistance(view.grid, at, cell) <= CAMP_MUSTER_CELLS;
      }).length;
      if (company < CAMP_MIN_SOLDIERS) continue;
      // Ascending id breaks a tie, because `arrived` is in id order and this keeps only a
      // strictly better site.
      if (!best || company > best.company) best = { unit: soldier.id, cell, company };
    }
    if (!best) return null;
    return [{ type: 'camp', unit: best.unit, cell: best.cell }];
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
