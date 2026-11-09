import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OWED_FRAMES_MAX_MS, createRenderWake, type RenderWakeDeps } from './renderWake';

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

  describe('owed frames (M-14)', () => {
    function framed(over: Partial<RenderWakeDeps> = {}) {
      const counter = { frames: 0 as number | null };
      const h = harness({ framesDrawn: () => counter.frames, ...over });
      return { ...h, counter };
    }

    it('holds the loop past its deadline until the frames it asked for are drawn', () => {
      const h = framed();
      h.wake.wake(100, 3);
      vi.advanceTimersByTime(101); // one slow frame used up the whole wake
      expect(h.running()).toBe(true);
      h.counter.frames = 2;
      vi.advanceTimersByTime(50);
      expect(h.running()).toBe(true);
      h.counter.frames = 3;
      vi.advanceTimersByTime(50);
      expect(h.running()).toBe(false);
    });

    it('changes nothing when the frames are drawn within the deadline', () => {
      const h = framed();
      h.wake.wake(100, 3);
      h.counter.frames = 3;
      vi.advanceTimersByTime(101);
      expect(h.running()).toBe(false);
    });

    it('stops waiting for frames that never come', () => {
      const h = framed();
      h.wake.wake(100, 3);
      vi.advanceTimersByTime(100 + OWED_FRAMES_MAX_MS - 60);
      expect(h.running()).toBe(true);
      vi.advanceTimersByTime(120);
      expect(h.running()).toBe(false);
    });

    it('is time only where the renderer cannot count frames', () => {
      const h = framed();
      h.counter.frames = null;
      h.wake.wake(100, 3);
      vi.advanceTimersByTime(101);
      expect(h.running()).toBe(false);
    });

    it('forgets owed frames when the page is hidden', () => {
      const h = framed();
      h.wake.wake(100, 3);
      h.state.hidden = true;
      h.wake.check();
      expect(h.running()).toBe(false);
      h.state.hidden = false;
      h.wake.check();
      expect(h.running()).toBe(false);
    });
  });

  it('pauses on a check with nothing to do, and resumes on the next wake', () => {
    const h = harness();
    h.wake.check();
    expect(h.running()).toBe(false);
    h.wake.wake(300);
    expect(h.log).toEqual(['resume']);
  });
});

describe('createRenderWake under a hold', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it('neither a time wake nor something moving starts the loop while a modal covers the canvas', () => {
    let held = true;
    const { wake, log, state } = harness({ held: () => held });
    state.busy = true;
    wake.wake(4000);
    expect(log).toEqual([]);
    // The modal lifts: the same wake and the same spin now run the loop.
    held = false;
    wake.check();
    expect(log).toEqual(['resume']);
  });

  it('frames a wake asked for are still drawn under the hold, then the loop pauses again', () => {
    let drawn = 0;
    const { wake, log, running } = harness({ held: () => true, framesDrawn: () => drawn });
    wake.wake(0, 2);
    expect(log).toEqual(['resume']);
    vi.advanceTimersByTime(50);
    expect(running()).toBe(true);
    drawn = 2;
    vi.advanceTimersByTime(50);
    expect(log).toEqual(['resume', 'pause']);
  });

  it('a hidden page still wins: no frames while hidden, whatever is owed', () => {
    const { wake, log, state } = harness({ held: () => true, framesDrawn: () => 0 });
    state.hidden = true;
    wake.wake(0, 2);
    expect(log).toEqual([]);
  });
});
