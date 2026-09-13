import { describe, it, expect } from 'vitest';
import { COMMAND_DELAY_TICKS, Sim, TICK_RATE, replayHash, type Scenario } from './sim';
import { FP_ONE, fpRatio, fromInt } from './fixed';

const scenario: Scenario = {
  units: [
    { owner: 1, x: fromInt(2), y: fromInt(2), speed: fpRatio(1, 4) },
    { owner: 2, x: fromInt(10), y: fromInt(5), speed: fpRatio(1, 2) },
  ],
};

describe('Sim', () => {
  it('runs at 15 ticks per second with a two-tick command delay', () => {
    expect(TICK_RATE).toBe(15);
    expect(COMMAND_DELAY_TICKS).toBe(2);
  });

  it('applies a live command exactly COMMAND_DELAY_TICKS after issue', () => {
    const sim = new Sim({ seed: 1, scenario });
    const entry = sim.issue({ type: 'move', unit: 1, x: fromInt(6), y: fromInt(2) });
    expect(entry.tick).toBe(2);
    const unit = sim.entities.get(1)!;
    sim.step(); // tick 1: command not yet due
    expect(unit.x).toBe(fromInt(2));
    expect(unit.moving).toBe(false);
    sim.step(); // tick 2: command applied, first movement step in the same tick
    expect(unit.moving).toBe(true);
    expect(unit.x).toBe(fromInt(2) + fpRatio(1, 4));
    expect(unit.y).toBe(fromInt(2));
  });

  it('arrives exactly on the goal and stops', () => {
    const sim = new Sim({ seed: 1, scenario });
    sim.issue({ type: 'move', unit: 1, x: fromInt(5), y: fromInt(6) });
    sim.run(200);
    const unit = sim.entities.get(1)!;
    expect(unit.x).toBe(fromInt(5));
    expect(unit.y).toBe(fromInt(6));
    expect(unit.moving).toBe(false);
    expect(sim.tick).toBe(200);
  });

  it('moves a diagonal at the unit speed, not faster', () => {
    const sim = new Sim({ seed: 1, scenario });
    sim.issue({ type: 'move', unit: 2, x: fromInt(20), y: fromInt(15) });
    sim.run(11); // the command lands on tick 2 and moves that tick: ticks 2..11 are ten steps
    const unit = sim.entities.get(2)!;
    const dx = unit.x - fromInt(10);
    const dy = unit.y - fromInt(5);
    // Ten ticks at 0.5 cells/tick = 5 cells; allow fixed-point floor loss.
    const dist2 = dx * dx + dy * dy;
    const expected = 5 * FP_ONE;
    expect(dist2).toBeLessThanOrEqual(expected * expected);
    expect(dist2).toBeGreaterThan((expected - 64) * (expected - 64));
  });

  it('drops commands for unknown units without touching anything else', () => {
    const sim = new Sim({ seed: 1, scenario });
    const before = sim.entities.all().map((u) => ({ ...u }));
    sim.issue({ type: 'move', unit: 99, x: 0, y: 0 });
    sim.run(5);
    expect(sim.entities.all().map((u) => ({ ...u }))).toEqual(before);
    // The dropped command is still part of the log, so a replay reproduces the same hash.
    expect(replayHash(sim.toReplay(), sim.tick)).toBe(sim.hash());
  });

  it('refuses commands scheduled at or before the current tick', () => {
    const sim = new Sim({ seed: 1, scenario });
    sim.run(3);
    expect(() => sim.scheduleAt({ type: 'move', unit: 1, x: 0, y: 0 }, 3)).toThrow(/cannot schedule/);
    expect(() => sim.scheduleAt({ type: 'move', unit: 1, x: 0, y: 0 }, 1)).toThrow(/cannot schedule/);
    expect(sim.scheduleAt({ type: 'move', unit: 1, x: 0, y: 0 }, 4).tick).toBe(4);
  });

  it('rejects floats at the boundary', () => {
    const sim = new Sim({ seed: 1, scenario });
    expect(() => sim.issue({ type: 'move', unit: 1, x: 1.5, y: 0 })).toThrow(/safe integer/);
    expect(() => new Sim({ seed: 0.5, scenario })).toThrow(/safe integer/);
    expect(() =>
      new Sim({ seed: 1, scenario: { units: [{ owner: 1, x: 0, y: 0, speed: 0.25 }] } }),
    ).toThrow(/safe integer/);
    expect(() => sim.issue({ type: 'teleport', unit: 1, x: 0, y: 0 } as never)).toThrow(/unknown command/);
  });

  it('a replay rebuilt from the log reaches the same hash as the live run', () => {
    const live = new Sim({ seed: 12345, scenario });
    live.issue({ type: 'move', unit: 1, x: fromInt(8), y: fromInt(9) });
    live.run(7);
    live.issue({ type: 'move', unit: 2, x: fromInt(0), y: fromInt(0) });
    live.issue({ type: 'move', unit: 1, x: fromInt(1), y: fromInt(1) });
    live.run(40);
    const replay = live.toReplay();
    expect(replay.commands.map((c) => c.tick)).toEqual([2, 9, 9]);
    expect(replayHash(replay, live.tick)).toBe(live.hash());
    // JSON round trip: the replay is plain integers and strings.
    const roundTripped = JSON.parse(JSON.stringify(replay));
    expect(replayHash(roundTripped, live.tick)).toBe(live.hash());
  });

  it('hash changes when state changes and is stable when it does not', () => {
    const sim = new Sim({ seed: 3, scenario });
    const h0 = sim.hash();
    expect(sim.hash()).toBe(h0);
    sim.step();
    expect(sim.hash()).not.toBe(h0);
  });
});
