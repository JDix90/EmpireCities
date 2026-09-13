/**
 * The alert queue behind the jump key.
 *
 * Slice A's design gives alerts a key that jumps the camera to what they are about, so
 * a player never has to hunt for the thing demanding attention — it is the brief's own
 * answer to the attention problem, alongside self-defending seats:
 *
 *   no-route  an order was given somewhere no land route can reach
 *   blocked   a unit stopped short of its goal, because terrain cut it off
 *   raid      raiders have crossed into a province you hold (rule VI)
 *   loss      a villager of yours was killed
 *   seat      a province of yours fell, or one is being claimed off you (rule III)
 *   hunger    your food ran out and your people have started to bleed
 *
 * Pure and tick-driven: nothing here reads a clock.
 */

import type { Sim } from '@borderfall/warfront-sim';

export type AlertKind = 'no-route' | 'blocked' | 'raid' | 'loss' | 'seat' | 'hunger';

/** Alerts that deserve to shout. The rest are informational. */
export const URGENT_ALERTS: ReadonlySet<AlertKind> = new Set<AlertKind>(['raid', 'loss', 'seat', 'hunger']);

export interface Alert {
  id: number;
  kind: AlertKind;
  message: string;
  /** Cell the jump key centres on. */
  cell: number;
  tick: number;
}

/** Beyond this the oldest are dropped; an alert list nobody can read is not an alert. */
export const MAX_ALERTS = 8;
/**
 * The same alert about the same place inside this many ticks is a repeat, not news. A
 * blocked unit re-reports every tick it stays blocked without this.
 */
export const DEDUPE_TICKS = 45;

export class AlertQueue {
  private items: Alert[] = [];
  private nextId = 1;

  /** Adds an alert unless an identical one is already recent. Returns it, or null. */
  push(kind: AlertKind, message: string, cell: number, tick: number): Alert | null {
    const recent = this.items.find((a) => a.kind === kind && a.cell === cell && tick - a.tick < DEDUPE_TICKS);
    if (recent) return null;
    const alert: Alert = { id: this.nextId++, kind, message, cell, tick };
    this.items = [alert, ...this.items].slice(0, MAX_ALERTS);
    return alert;
  }

  /** Newest first. */
  list(): readonly Alert[] {
    return this.items;
  }

  latest(): Alert | null {
    return this.items[0] ?? null;
  }

  dismiss(id: number): void {
    this.items = this.items.filter((a) => a.id !== id);
  }

  clear(): void {
    this.items = [];
  }
}

/**
 * Units that have stopped without reaching their goal — the simulation's way of saying
 * "there is no land route from here to there". A unit that has never been ordered has
 * its goal at its own position, so it is not blocked.
 */
export function blockedUnitIds(sim: Sim): number[] {
  const out: number[] = [];
  for (const unit of sim.entities.all()) {
    if (unit.moving) continue;
    if (unit.x !== unit.goalX || unit.y !== unit.goalY) out.push(unit.id);
  }
  return out;
}
