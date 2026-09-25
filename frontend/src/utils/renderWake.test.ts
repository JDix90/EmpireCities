import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRenderWake, type RenderWakeDeps } from './renderWake';

function harness(over: Partial<RenderWakeDeps> = {}) {
  const log: string[] = [];
  let running = false;
  const state = { busy: false, hidden: false, poll: 500 };
  const wake = createRenderWake({
    resume: () => { if (!running) log.push('resume'); running = true; },
    pause: () => { if (running) log.push('pause'); running = false; },
    busy: () => state.busy,
    hidden: () => state.hidden,
    pollMs: () => state.poll,
    ...over,
  });
  return { wake, log, state, running: () => running };
}

describe('createRenderWake', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs for the wake and pauses when it runs out', () => {
    const h = harness();
    h.wake.wake(300);
    expect(h.running()).toBe(true);
    vi.advanceTimersByTime(299);
    expect(h.running()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(h.running()).toBe(false);
  });

  it('never lets a short wake cut a longer one short', () => {
    const h = harness();
    h.wake.wake(4000); // a finger on the globe
    vi.advanceTimersByTime(1000);
    h.wake.wake(300); // a board change
    vi.advanceTimersByTime(2000);
    expect(h.running()).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(h.running()).toBe(false);
  });

  it('extends when a later wake reaches further', () => {
    const h = harness();
    h.wake.wake(300);
    vi.advanceTimersByTime(200);
    h.wake.wake(1200); // a camera tween
    vi.advanceTimersByTime(1100);
    expect(h.running()).toBe(true);
    vi.advanceTimersByTime(150);
    expect(h.running()).toBe(false);
  });

  it('keeps running while something moves, re-checking on the poll', () => {
    const h = harness();
    h.state.busy = true;
    h.wake.wake(300);
    vi.advanceTimersByTime(2000);
    expect(h.running()).toBe(true);
    h.state.busy = false;
    // Stops at the next poll, whenever in its cycle the motion ended.
    vi.advanceTimersByTime(501);
    expect(h.running()).toBe(false);
  });

  it('pauses at once while the page is hidden, and forgets the wake', () => {
    const h = harness();
    h.wake.wake(4000);
    h.state.hidden = true;
    h.wake.check();
    expect(h.running()).toBe(false);
    h.state.hidden = false;
    h.wake.check();
    expect(h.running()).toBe(false);
  });

  it('pauses on a check with nothing to do, and resumes on the next wake', () => {
    const h = harness();
    h.wake.check();
    expect(h.running()).toBe(false);
    h.wake.wake(300);
    expect(h.log).toEqual(['resume']);
  });
});
