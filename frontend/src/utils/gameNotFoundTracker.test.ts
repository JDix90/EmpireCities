import { describe, it, expect } from 'vitest';
import { GameNotFoundTracker, RESYNC_GRACE_MS, REPEAT_WINDOW_MS } from './gameNotFoundTracker';

describe('GameNotFoundTracker', () => {
  it('resyncs on the first miss', () => {
    const t = new GameNotFoundTracker();
    expect(t.decide(1_000)).toBe('resync');
  });

  it('swallows buffered duplicate misses while the resync is pending', () => {
    const t = new GameNotFoundTracker();
    expect(t.decide(1_000)).toBe('resync');
    // socket.io flushing a queued action right behind the first miss
    expect(t.decide(1_050)).toBe('swallow');
    expect(t.decide(2_000)).toBe('swallow');
  });

  it('ejects when a miss lands after a completed repair', () => {
    const t = new GameNotFoundTracker();
    expect(t.decide(1_000)).toBe('resync');
    t.onRejoined();
    // The room was repaired, yet another action missed shortly after —
    // the game is unrecoverable for this client.
    expect(t.decide(5_000)).toBe('eject');
  });

  it('ejects when the resync never completes and the outage persists', () => {
    const t = new GameNotFoundTracker();
    expect(t.decide(1_000)).toBe('resync');
    // Still failing after the grace window with no game:joined in between.
    expect(t.decide(1_000 + RESYNC_GRACE_MS + 1)).toBe('eject');
  });

  it('treats a miss after the repeat window as a fresh outage', () => {
    const t = new GameNotFoundTracker();
    expect(t.decide(1_000)).toBe('resync');
    t.onRejoined();
    expect(t.decide(1_000 + REPEAT_WINDOW_MS + 1)).toBe('resync');
  });

  it('ejects immediately on fatal errors regardless of state', () => {
    const t = new GameNotFoundTracker();
    expect(t.decide(1_000, { fatal: true })).toBe('eject');
    const t2 = new GameNotFoundTracker();
    expect(t2.decide(1_000)).toBe('resync');
    expect(t2.decide(1_001, { fatal: true })).toBe('eject');
  });

  it('reset clears all history', () => {
    const t = new GameNotFoundTracker();
    expect(t.decide(1_000)).toBe('resync');
    t.reset();
    expect(t.decide(1_001)).toBe('resync');
  });
});
