import { describe, it, expect } from 'vitest';
import { decideTurnTimerRearm } from './turnTimerRearm';

const NOW = 1_750_000_000_000;

function base(overrides: Partial<Parameters<typeof decideTurnTimerRearm>[0]> = {}) {
  return decideTurnTimerRearm({
    hasScheduledJob: false,
    phase: 'draft',
    asyncMode: false,
    turnTimerSeconds: 300,
    currentPlayerIsAi: false,
    deadlineAt: null,
    now: NOW,
    ...overrides,
  });
}

describe('decideTurnTimerRearm', () => {
  it('does nothing when the BullMQ job is still scheduled', () => {
    expect(base({ hasScheduledJob: true })).toEqual({ kind: 'none' });
  });

  it('does nothing for async games, timerless games, AI turns, or finished games', () => {
    expect(base({ asyncMode: true })).toEqual({ kind: 'none' });
    expect(base({ turnTimerSeconds: 0 })).toEqual({ kind: 'none' });
    expect(base({ turnTimerSeconds: undefined })).toEqual({ kind: 'none' });
    expect(base({ currentPlayerIsAi: true })).toEqual({ kind: 'none' });
    expect(base({ phase: 'game_over' })).toEqual({ kind: 'none' });
  });

  it('keeps an unexpired deadline — reconnecting must not grant extra clock', () => {
    expect(base({ deadlineAt: NOW + 90_000 })).toEqual({ kind: 'remaining', delayMs: 90_000 });
  });

  it('starts fresh when the deadline is missing — the dead-0:00-clock case', () => {
    expect(base({ deadlineAt: null })).toEqual({ kind: 'fresh' });
    expect(base({ deadlineAt: undefined })).toEqual({ kind: 'fresh' });
  });

  it('starts fresh when the deadline already expired (timeout job was lost)', () => {
    expect(base({ deadlineAt: NOW - 5_000 })).toEqual({ kind: 'fresh' });
  });

  it('treats a nearly-expired deadline as expired rather than racing the broadcast', () => {
    expect(base({ deadlineAt: NOW + 500 })).toEqual({ kind: 'fresh' });
  });
});
