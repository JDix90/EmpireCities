/**
 * Turning simulation state into the things a player needs telling about.
 *
 * The simulation has no event bus and should not grow one: it is a pure function of a
 * seed and a command log, and anything it emitted would be one more thing to keep
 * deterministic. So the UI watches instead — it holds what it saw last time and reports
 * the differences. That keeps every event derivable from state alone, which means a
 * replay produces exactly the same alerts as the live match did.
 *
 * Pure apart from the instance's own memory: nothing here reads a clock or the DOM.
 */

import { UnitKind, toIntFloor, type Sim } from '@borderfall/warfront-sim';
import type { AlertKind } from './alerts';

export interface PendingAlert {
  kind: AlertKind;
  message: string;
  /** Cell the jump key centres on — where the thing actually happened. */
  cell: number;
}

/** The tribes' own seat index: raiders belong to nobody. */
const NEUTRAL = 0;

export class MatchWatch {
  /** Raiders already reported, so one raid is one alert rather than one per frame. */
  private reportedRaiders = new Set<number>();
  /** Where each of your villagers was last seen, so a death has a place to jump to. */
  private villagerCells = new Map<number, number>();
  /** Provinces you held, and the cell of the seat that held each. */
  private seatCells = new Map<number, number>();
  private starving = false;
  private primed = false;

  /**
   * Differences since the last call, as alerts. The FIRST call only primes: the opening
   * position is not news, and reporting it would greet every player with an alert about
   * the seat they just started with.
   */
  poll(sim: Sim, owner: number): PendingAlert[] {
    const grid = sim.terrain;
    if (!grid) return [];
    const out: PendingAlert[] = [];

    const cellOf = (x: number, y: number): number => {
      const col = toIntFloor(x);
      const row = toIntFloor(y);
      return grid.inBounds(col, row) ? grid.index(col, row) : -1;
    };

    // Raiders that have crossed into your land. Rule VI says raiders inside your borders
    // are always visible; being told they arrived is the other half of that.
    const aliveRaiders = new Set<number>();
    for (const unit of sim.entities.all()) {
      if (unit.owner !== NEUTRAL) continue;
      aliveRaiders.add(unit.id);
      if (this.reportedRaiders.has(unit.id)) continue;
      const cell = cellOf(unit.x, unit.y);
      if (cell < 0) continue;
      const province = sim.provinces.get(grid.owner(cell));
      if (!province || province.owner !== owner) continue;
      this.reportedRaiders.add(unit.id);
      if (this.primed) {
        out.push({ kind: 'raid', message: `Raiders in ${provinceName(sim, province.index)}.`, cell });
      }
    }
    // Forget the dead, so the set cannot grow for the whole match.
    for (const id of this.reportedRaiders) if (!aliveRaiders.has(id)) this.reportedRaiders.delete(id);

    // Villagers lost. The cell is where the villager last stood, which is where the
    // player wants to be looking.
    const villagers = new Map<number, number>();
    for (const unit of sim.entities.all()) {
      if (unit.owner !== owner || unit.kind !== UnitKind.Villager) continue;
      villagers.set(unit.id, cellOf(unit.x, unit.y));
    }
    let lost = 0;
    let lostCell = -1;
    for (const [id, cell] of this.villagerCells) {
      if (villagers.has(id)) continue;
      lost += 1;
      if (lostCell < 0) lostCell = cell;
    }
    if (this.primed && lost > 0 && lostCell >= 0) {
      out.push({
        kind: 'loss',
        message: lost === 1 ? 'A villager was killed.' : `${lost} villagers were killed.`,
        cell: lostCell,
      });
    }
    this.villagerCells = villagers;

    // Provinces. A seat that falls takes its province with it — rule III — and the claim
    // that follows is visible to everyone nearby, so it is worth shouting about.
    const held = new Map<number, number>();
    for (const province of sim.provinces.all()) {
      if (province.owner !== owner || province.seat < 0) continue;
      const seat = sim.buildings.get(province.seat);
      if (seat) held.set(province.index, seat.cell);
    }
    for (const [index, cell] of this.seatCells) {
      if (held.has(index)) continue;
      if (!this.primed) continue;
      const province = sim.provinces.get(index);
      const message =
        province && province.claimant !== 0 && province.claimant !== owner
          ? `${provinceName(sim, index)} is being claimed off you.`
          : `${provinceName(sim, index)} has fallen — its seat is gone.`;
      out.push({ kind: 'seat', message, cell });
    }
    this.seatCells = held;

    // Hunger, on the edge only: starvation bleeds every ten seconds and an alert a tick
    // would bury everything else.
    const player = sim.players.get(owner);
    const starving = !!player?.starving;
    if (this.primed && starving && !this.starving) {
      const seat = [...held.values()][0] ?? -1;
      out.push({ kind: 'hunger', message: 'Your people are starving — food has run out.', cell: seat });
    }
    this.starving = starving;

    this.primed = true;
    return out;
  }
}

function provinceName(sim: Sim, index: number): string {
  return sim.terrain?.provinces.find((p) => p.index === index)?.name ?? `province ${index}`;
}
