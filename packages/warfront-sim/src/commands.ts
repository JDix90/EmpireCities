import { assertFixed, assertInt } from './fixed';
import type { StateHasher } from './hash';

/**
 * Player commands. Step 1 has exactly one: `move`. Coordinates are 16.16 fixed cell
 * units. Anything that reaches the sim from outside (a socket, a replay file, a bot)
 * goes through `validateCommand`, which rejects floats and out-of-range values.
 */
export type Command = { type: 'move'; unit: number; x: number; y: number };

/** A command stamped with the tick it executes on and its issue order within that tick. */
export interface ScheduledCommand {
  tick: number;
  seq: number;
  command: Command;
}

export function validateCommand(raw: unknown): Command {
  if (!raw || typeof raw !== 'object') throw new Error('warfront-sim: command must be an object');
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'move': {
      const unit = assertInt(c.unit as number, 'move.unit');
      const x = assertFixed(c.x as number, 'move.x');
      const y = assertFixed(c.y as number, 'move.y');
      return { type: 'move', unit, x, y };
    }
    default:
      throw new Error(`warfront-sim: unknown command type ${String(c.type)}`);
  }
}

/**
 * Commands keyed by execution tick, applied in issue order. The sim stamps live
 * commands `COMMAND_DELAY_TICKS` ahead of the current tick so every host applies them
 * on the same tick; a replay schedules them at their recorded ticks.
 */
export class CommandQueue {
  private readonly byTick = new Map<number, ScheduledCommand[]>();
  private seq = 0;
  private count = 0;

  schedule(command: Command, tick: number): ScheduledCommand {
    const entry: ScheduledCommand = { tick, seq: this.seq++, command };
    const list = this.byTick.get(tick);
    if (list) list.push(entry);
    else this.byTick.set(tick, [entry]);
    this.count += 1;
    return entry;
  }

  /** Removes and returns every command due on `tick`, in issue order. */
  take(tick: number): ScheduledCommand[] {
    const list = this.byTick.get(tick);
    if (!list) return [];
    this.byTick.delete(tick);
    this.count -= list.length;
    return list;
  }

  get pendingCount(): number {
    return this.count;
  }

  /** Every pending command ordered by (tick, seq). */
  pending(): ScheduledCommand[] {
    const out: ScheduledCommand[] = [];
    for (const list of this.byTick.values()) out.push(...list);
    out.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    return out;
  }

  hashInto(h: StateHasher): void {
    const pending = this.pending();
    h.int(this.seq).int(pending.length);
    for (const p of pending) {
      h.int(p.tick).int(p.seq).ascii(p.command.type);
      h.int(p.command.unit).int(p.command.x).int(p.command.y);
    }
  }
}
