import { describe, it, expect } from 'vitest';
import { FP_ONE, Sim, TICK_RATE, fpRatio, fromInt, type Scenario } from '@borderfall/warfront-sim';
import { MAX_STEPS_PER_FRAME, SimRunner, TICK_MS } from './simRunner';

const scenario: Scenario = {
  units: [{ owner: 1, x: fromInt(10), y: fromInt(10), speed: fpRatio(1, 2) }],
};

function runner(): SimRunner {
  return new SimRunner(new Sim({ seed: 1, scenario }));
}

describe('SimRunner', () => {
  it('converts elapsed milliseconds into whole ticks at the simulation rate', () => {
    const r = runner();
    expect(TICK_MS).toBeCloseTo(1000 / TICK_RATE, 10);
    expect(r.advance(TICK_MS - 1)).toBe(0);
    expect(r.sim.tick).toBe(0);
    expect(r.advance(2)).toBe(1);
    expect(r.sim.tick).toBe(1);
    expect(r.ticks).toBe(1);
  });

  it('runs several ticks in one long frame', () => {
    const r = runner();
    // Deliberately not an exact multiple of TICK_MS: 1000/15 is not representable, so
    // `TICK_MS * 3` can land a fraction of an ulp short and yield two ticks plus a
    // remainder. That is correct accumulator behaviour, and real frames never arrive on
    // exact tick boundaries anyway.
    expect(r.advance(TICK_MS * 3 + 1)).toBe(3);
    expect(r.sim.tick).toBe(3);
  });

  it('loses no time across many small frames', () => {
    // The property that actually matters: 60 frames of a 60 Hz display advance the
    // simulation by one second's worth of ticks, whatever the rounding does per frame.
    const r = runner();
    for (let i = 0; i < 60; i++) r.advance(1000 / 60);
    expect(r.sim.tick).toBe(TICK_RATE);
  });

  it('drops the backlog after a stall instead of simulating minutes in one frame', () => {
    const r = runner();
    // A tab left in the background for a minute: without the cap this would try to run
    // 900 ticks inside a single frame and lock the page.
    const steps = r.advance(60_000);
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.sim.tick).toBe(MAX_STEPS_PER_FRAME);
    // The remainder is kept sub-tick so interpolation stays smooth next frame.
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });

  it('ignores nonsense frame times rather than corrupting the accumulator', () => {
    const r = runner();
    expect(r.advance(0)).toBe(0);
    expect(r.advance(-5)).toBe(0);
    expect(r.advance(Number.NaN)).toBe(0);
    expect(r.sim.tick).toBe(0);
    expect(r.alpha).toBe(0);
  });

  it('interpolates between the previous tick and the current one', () => {
    const r = runner();
    r.sim.issue({ type: 'move', unit: 1, x: fromInt(300), y: fromInt(10) });
    // Advance in sub-tick slices so the runner is left partway between two ticks.
    for (let i = 0; i < 47; i++) r.advance(TICK_MS / 4);
    const unit = r.sim.entities.get(1)!;
    const view = r.positions()[0];
    expect(unit.moving).toBe(true);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
    // The drawn position lies within the last tick's step: never ahead of where the
    // simulation actually is, never further back than one tick of movement.
    const current = unit.x / FP_ONE;
    const oneStep = unit.speed / FP_ONE;
    expect(view.x).toBeLessThanOrEqual(current + 1e-9);
    expect(view.x).toBeGreaterThanOrEqual(current - oneStep - 1e-9);
  });

  it('reports positions in float cells while the simulation stays integral', () => {
    const r = runner();
    const view = r.positions()[0];
    expect(view).toMatchObject({ id: 1, owner: 1, moving: false });
    expect(view.x).toBe(10);
    expect(Number.isInteger(r.sim.entities.get(1)!.x)).toBe(true);
  });

  it('maps a unit to its cell index', () => {
    const r = runner();
    expect(r.cellOf(1, 100)).toBe(10 * 100 + 10);
    expect(r.cellOf(999, 100)).toBe(-1);
  });
});
