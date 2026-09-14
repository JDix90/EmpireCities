import type { BotView } from '../bot';
import type { Building } from '../buildings';
import type { Command } from '../commands';
import { withinHops } from '../reveal';
import { BuildingKind, LIGHTHOUSE_REVEAL_HOPS, UNIT_SPECS, UnitKind, type BuildingKindValue } from '../rules';
import { ColonistBot, type ColonistParams } from './colonist';
import { canAfford, countOwn, findBuildSite, ownBuildings } from './helpers';

/**
 * `Turtle` — walls and towers, never past three provinces.
 *
 * The brief lists turtling as a failure mode it has an answer for: colonisation cost
 * slows the leader but not the turtle, so raids scale with holdings and the majority
 * format ends on the clock with the turtle losing on points. This policy exists to check
 * that claim. If a Turtle places well, the answer is not working.
 *
 * Walls do not exist in the slice, so its defence is towers and spears.
 */
export class TurtleBot extends ColonistBot {
  override readonly name = 'turtle';
  private readonly ceiling: number;
  private readonly towers: number;

  constructor(params: Partial<ColonistParams> & { ceiling?: number; towers?: number } = {}) {
    super({ garrison: 4, ...params });
    this.ceiling = params.ceiling ?? 3;
    this.towers = params.towers ?? 3;
  }

  protected override provinceCeiling(): number {
    return this.ceiling;
  }

  protected override buildOrder(): readonly BuildingKindValue[] {
    return [BuildingKind.LumberCamp, BuildingKind.Farm, BuildingKind.Barracks, BuildingKind.Mine, BuildingKind.Farm];
  }

  /** Towers on the ground it holds, a light on its coast, then spears behind them. */
  protected override military(view: BotView, seat: Building): Command[] | null {
    if (countOwn(view, BuildingKind.Tower) < this.towers && canAfford(view, BuildingKind.Tower)) {
      const site = findBuildSite(view, BuildingKind.Tower, seat.cell, this.params.buildRadius);
      if (site >= 0) {
        const builder = this.pickBuilder(view, site);
        if (builder !== null) return [{ type: 'build', unit: builder, kind: BuildingKind.Tower, cell: site }];
      }
    }

    // The brief's own minute-six board, in the brief's own order: "towers on the shared
    // border, lighthouse on the exposed coast". Towers first because a turtle's first
    // worry is the land frontier and both buildings want the same scarce silver — and
    // because "walling the Alps and ignoring the Channel deserves what lands at Dover" is
    // a warning about ignoring the coast, not about preferring it.
    if (countOwn(view, BuildingKind.Lighthouse) < 1 && canAfford(view, BuildingKind.Lighthouse)) {
      const site = this.lightSite(view);
      if (site >= 0) {
        const builder = this.pickBuilder(view, site);
        if (builder !== null) return [{ type: 'build', unit: builder, kind: BuildingKind.Lighthouse, cell: site }];
      }
    }

    // Spears past the baseline garrison: a turtle keeps a standing army at home.
    const barracks = ownBuildings(view, BuildingKind.Barracks).find((b) => b.complete);
    if (!barracks || barracks.queue.length > 0) return null;
    const spears = view.units.filter((u) => u.owner === view.seat && u.kind === UnitKind.Spear).length;
    if (spears >= this.params.garrison * 2) return null;
    const spec = UNIT_SPECS[UnitKind.Spear];
    if (view.player.food < spec.food + this.params.foodReserve || view.player.silver < spec.silver) return null;
    if (view.player.popCap - view.player.pop < spec.pop) return null;
    return [{ type: 'train', building: barracks.id, unit: UnitKind.Spear }];
  }

  /**
   * A coast of its own worth watching, or -1.
   *
   * "Worth watching" is the part a siting rule cannot answer: the simulation will happily
   * raise a light on any shore, and forty timber on a shore no lane reaches buys nothing.
   * So the policy asks the reveal rule itself how far a light sees and whether anything
   * crosses inside that — which keeps this in step with `LIGHTHOUSE_REVEAL_HOPS` instead
   * of re-stating the reading in a second place.
   *
   * Provinces in index order, and every one it holds rather than only the capital: a
   * turtle's exposed coast is frequently not the province its seat stands in.
   */
  private lightSite(view: BotView): number {
    for (const province of view.provinces) {
      if (province.owner !== view.seat || province.seat < 0) continue;
      const anchor = view.buildings.find((b) => b.id === province.seat);
      if (!anchor) continue;
      const watched = withinHops(view.geography, province.index, LIGHTHOUSE_REVEAL_HOPS);
      if (!watched.some((p) => view.sea.lanesFrom(p).length > 0)) continue;
      const site = findBuildSite(
        view,
        BuildingKind.Lighthouse,
        anchor.cell,
        this.params.buildRadius,
        province.index,
      );
      if (site >= 0) return site;
    }
    return -1;
  }
}
