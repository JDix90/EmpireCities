import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FRAME_BUDGET_ATTR,
  PHONE_FRAME_CAP_FPS,
  REDUCED_FRAME_CAP_FPS,
  applyFrameBudget,
  frameCapFor,
  createFrameCap,
  dampingFactorForFrameRate,
  installFrameCap,
  type FrameCapNatives,
} from './frameBudget';

/**
 * A fake display: vsyncs every `hz`, timers on the same clock. `advance`
 * steps time one millisecond at a time, firing timers and vsyncs in order.
 */
function fakeDisplay(hz: number) {
  let now = 0;
  let nextRafId = 1;
  let nextTimerId = 1;
  const rafs = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { at: number; fn: () => void }>();
  const vsync = 1000 / hz;
  let nextVsync = vsync;
  const natives: FrameCapNatives = {
    requestAnimationFrame: (cb) => { const id = nextRafId++; rafs.set(id, cb); return id; },
    cancelAnimationFrame: (id) => { rafs.delete(id); },
    setTimeout: (fn, ms) => { const id = nextTimerId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  let nativeFrames = 0;
  function advance(ms: number) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 0.25);
      for (const [id, t] of Array.from(timers)) {
        if (t.at <= now) { timers.delete(id); t.fn(); }
      }
      if (now >= nextVsync) {
        const t = nextVsync;
        nextVsync += vsync;
        if (rafs.size > 0) nativeFrames += 1;
        const batch = Array.from(rafs);
        rafs.clear();
        for (const [, cb] of batch) cb(t);
      }
    }
  }
  return { natives, advance, nativeFrames: () => nativeFrames, now: () => now };
}

/** A render loop in the style of globe.gl's: re-requests itself every frame. */
function loop(cap: { requestAnimationFrame: (cb: FrameRequestCallback) => number }) {
  const frames: number[] = [];
  let handle = 0;
  const tick = (t: number) => { frames.push(t); handle = cap.requestAnimationFrame(tick); };
  handle = cap.requestAnimationFrame(tick);
  return { frames, handle: () => handle };
}

describe('createFrameCap', () => {
  it.each([60, 90, 120])('holds a %i Hz display to 30 frames a second', (hz) => {
    const d = fakeDisplay(hz);
    const cap = createFrameCap(30, d.natives);
    const l = loop(cap);
    d.advance(2000);
    // 60 frames in two seconds, give or take the first.
    expect(l.frames.length).toBeGreaterThanOrEqual(58);
    expect(l.frames.length).toBeLessThanOrEqual(61);
    const gaps = l.frames.slice(1).map((t, i) => t - l.frames[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / 30 - 4);
  });

  it('does not wake on every vsync between frames', () => {
    const d = fakeDisplay(120);
    const cap = createFrameCap(30, d.natives);
    loop(cap);
    d.advance(1000);
    // A capped frame costs one native frame, plus at most one more to find out
    // it was early; never the display's 120.
    expect(d.nativeFrames()).toBeLessThanOrEqual(62);
  });

  it('runs every callback due in a frame together, with one timestamp', () => {
    const d = fakeDisplay(60);
    const cap = createFrameCap(30, d.natives);
    const globe = loop(cap);
    const rings = loop(cap);
    d.advance(500);
    expect(globe.frames).toEqual(rings.frames);
  });

  it('cancels a queued callback, and stops scheduling once nothing is queued', () => {
    const d = fakeDisplay(60);
    const cap = createFrameCap(30, d.natives);
    const l = loop(cap);
    d.advance(200);
    const before = l.frames.length;
    const nativeBefore = d.nativeFrames();
    cap.cancelAnimationFrame(l.handle());
    expect(cap.pending()).toBe(0);
    d.advance(500);
    expect(l.frames.length).toBe(before);
    // Nothing queued: no native frame is asked for at all.
    expect(d.nativeFrames()).toBe(nativeBefore);
  });

  it('hands out ids that cannot collide with native ones, and passes native ids through', () => {
    const d = fakeDisplay(60);
    const cancel = vi.spyOn(d.natives, 'cancelAnimationFrame');
    const cap = createFrameCap(30, d.natives);
    const id = cap.requestAnimationFrame(() => {});
    expect(id).toBeGreaterThanOrEqual(1_000_000_000);
    cap.cancelAnimationFrame(7); // a native id from before the cap
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('keeps the rest of a frame running when one callback throws, and reports the error after', () => {
    const d = fakeDisplay(60);
    const cap = createFrameCap(30, d.natives);
    const ran: string[] = [];
    cap.requestAnimationFrame(() => { throw new Error('boom'); });
    cap.requestAnimationFrame(() => { ran.push('second'); });
    expect(() => d.advance(40)).toThrow('boom');
    expect(ran).toEqual(['second']);
  });

  it('on release, runs what is queued at the next native frame and reports drained', () => {
    const d = fakeDisplay(60);
    const cap = createFrameCap(30, d.natives);
    const drained = vi.fn();
    cap.onDrained = drained;
    const ran = vi.fn();
    cap.requestAnimationFrame(() => {});
    d.advance(20); // first frame consumed
    cap.requestAnimationFrame(ran);
    d.advance(2); // now sleeping until the next capped frame
    cap.release();
    d.advance(17);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(drained).toHaveBeenCalledTimes(1);
  });
});

describe('installFrameCap', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function fakeWindow(hz = 60) {
    const d = fakeDisplay(hz);
    const win = {
      requestAnimationFrame: d.natives.requestAnimationFrame,
      cancelAnimationFrame: d.natives.cancelAnimationFrame,
      setTimeout: d.natives.setTimeout,
      clearTimeout: d.natives.clearTimeout,
      document: { documentElement: document.createElement('html') },
    } as unknown as Window & typeof globalThis;
    return { d, win, nativeRaf: d.natives.requestAnimationFrame, nativeCaf: d.natives.cancelAnimationFrame };
  }

  it('caps the window and restores it on release', () => {
    const { d, win, nativeRaf, nativeCaf } = fakeWindow(120);
    const release = installFrameCap(30, win);
    expect(win.requestAnimationFrame).not.toBe(nativeRaf);
    const l = loop(win);
    d.advance(1000);
    expect(l.frames.length).toBeLessThanOrEqual(31);
    win.cancelAnimationFrame(l.handle());
    release();
    expect(win.requestAnimationFrame).toBe(nativeRaf);
    expect(win.cancelAnimationFrame).toBe(nativeCaf);
  });

  it('keeps routing its own ids through cancel until its queue drains', () => {
    const { d, win, nativeCaf } = fakeWindow();
    const release = installFrameCap(30, win);
    const ran = vi.fn();
    const id = win.requestAnimationFrame(ran);
    release();
    // A component unmounting after the release cancels with the id it was given.
    expect(win.cancelAnimationFrame).not.toBe(nativeCaf);
    win.cancelAnimationFrame(id);
    d.advance(100);
    expect(ran).not.toHaveBeenCalled();
    expect(win.cancelAnimationFrame).toBe(nativeCaf);
  });

  it('keeps two overlapping caps apart: each cancels only its own callbacks', () => {
    const { d, win } = fakeWindow();
    const releaseFirst = installFrameCap(30, win);
    const first = vi.fn();
    const firstId = win.requestAnimationFrame(first);
    releaseFirst(); // queue not drained yet: cancel still routes through the first cap
    const releaseSecond = installFrameCap(30, win);
    const second = vi.fn();
    const secondId = win.requestAnimationFrame(second);
    expect(secondId).not.toBe(firstId);
    win.cancelAnimationFrame(firstId);
    d.advance(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    releaseSecond();
  });

  it('is a no-op when a cap is already installed', () => {
    const { win } = fakeWindow();
    const release = installFrameCap(30, win);
    const capped = win.requestAnimationFrame;
    const second = installFrameCap(15, win);
    expect(win.requestAnimationFrame).toBe(capped);
    second();
    expect(win.requestAnimationFrame).toBe(capped);
    release();
  });

  it('marks the document with its tier for the stylesheet and clears it again', () => {
    const { win } = fakeWindow();
    const off = applyFrameBudget('standard', win);
    expect(win.document.documentElement.getAttribute(FRAME_BUDGET_ATTR)).toBe('standard');
    off();
    expect(win.document.documentElement.hasAttribute(FRAME_BUDGET_ATTR)).toBe(false);
  });

  it('holds the reduced tier to 20 frames a second, and steps between tiers cleanly', () => {
    expect(frameCapFor('standard')).toBe(PHONE_FRAME_CAP_FPS);
    expect(frameCapFor('reduced')).toBe(REDUCED_FRAME_CAP_FPS);
    const { d, win, nativeRaf } = fakeWindow(60);
    const offStandard = applyFrameBudget('standard', win);
    offStandard();
    const offReduced = applyFrameBudget('reduced', win);
    expect(win.document.documentElement.getAttribute(FRAME_BUDGET_ATTR)).toBe('reduced');
    const l = loop(win);
    d.advance(2000);
    expect(l.frames.length).toBeGreaterThanOrEqual(38);
    expect(l.frames.length).toBeLessThanOrEqual(41);
    win.cancelAnimationFrame(l.handle());
    offReduced();
    expect(win.requestAnimationFrame).toBe(nativeRaf);
  });
});

describe('dampingFactorForFrameRate', () => {
  it('keeps the per-second decay the controls were tuned for at 60 Hz', () => {
    const base = 0.1;
    const f = dampingFactorForFrameRate(base, PHONE_FRAME_CAP_FPS);
    expect(f).toBeCloseTo(0.19, 5);
    expect(Math.pow(1 - f, PHONE_FRAME_CAP_FPS)).toBeCloseTo(Math.pow(1 - base, 60), 10);
    expect(dampingFactorForFrameRate(base, 60)).toBeCloseTo(base, 10);
  });
});
