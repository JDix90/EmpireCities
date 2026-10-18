import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FrameTickerModule from 'frame-ticker';
import { pauseUnheardFrameTickers } from './idleFrameTickers';

/**
 * The globe libraries build components at import to read their props, and
 * the arcs and paths layers start a FrameTicker in the constructor. Nothing
 * ever listens to those tickers or pauses them, so they asked for a frame
 * every frame for the life of the tab.
 */
type Ticker = {
  onTick: { add(fn: () => void): boolean; numItems: number };
  isRunning: boolean;
  resume(): void;
  pause(): void;
};
const FrameTicker = ((FrameTickerModule as unknown as { default?: unknown }).default ?? FrameTickerModule) as new (
  maxFPS?: number,
  minFPS?: number,
  paused?: boolean,
) => Ticker;

let frames: FrameRequestCallback[] = [];
function runFrame() {
  const due = frames;
  frames = [];
  for (const cb of due) cb(performance.now());
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('pauseUnheardFrameTickers', () => {
  it('patches the FrameTicker class three-globe uses', () => {
    expect(pauseUnheardFrameTickers()).toBe(true);
    // Idempotent: the module patches on import and callers may ask again.
    expect(pauseUnheardFrameTickers()).toBe(true);
  });

  it('stops a ticker nobody listens to on its first frame', () => {
    const ticker = new FrameTicker();
    expect(ticker.isRunning).toBe(true);
    expect(frames).toHaveLength(1);
    runFrame();
    expect(ticker.isRunning).toBe(false);
    expect(frames).toHaveLength(0);
    runFrame();
    expect(frames).toHaveLength(0);
  });

  it('keeps a ticker with a listener running, frame after frame', () => {
    const ticker = new FrameTicker();
    const tick = vi.fn();
    ticker.onTick.add(tick);
    for (let i = 0; i < 3; i++) runFrame();
    expect(ticker.isRunning).toBe(true);
    expect(frames).toHaveLength(1);
    ticker.pause();
  });

  it('keeps a ticker that gets its listener before its first frame', () => {
    // A mounted layer: built in one task, its listener attached in the same one.
    const ticker = new FrameTicker();
    ticker.onTick.add(vi.fn());
    runFrame();
    expect(ticker.isRunning).toBe(true);
    ticker.pause();
  });

  it('runs again once a listener arrives and the globe resumes it', () => {
    // A layer that paused before it attached its listener: the globe's next
    // resumeAnimation starts it, now with something to tick.
    const ticker = new FrameTicker();
    runFrame();
    expect(ticker.isRunning).toBe(false);
    const tick = vi.fn();
    ticker.onTick.add(tick);
    ticker.resume();
    expect(ticker.isRunning).toBe(true);
    runFrame();
    runFrame();
    expect(frames).toHaveLength(1);
    ticker.pause();
  });

  it('declines a module without a FrameTicker class', () => {
    expect(pauseUnheardFrameTickers({})).toBe(false);
  });
});
