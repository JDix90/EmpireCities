import { describe, it, expect } from 'vitest';
import { decideTurnTimerRearm, isTurnTimerJobCurrent, isAsyncDeadlineJobCurrent } from './turnTimerRearm';

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

describe('isTurnTimerJobCurrent', () => {
  it('acts on the job for the deadline the game is still running', () => {
    expect(isTurnTimerJobCurrent({ jobDeadlineAt: NOW, armedDeadlineAt: NOW, now: NOW + 50 })).toBe(true);
  });

  it('ignores a job whose clock was re-armed since (the player ended the phase first)', () => {
    expect(isTurnTimerJobCurrent({ jobDeadlineAt: NOW, armedDeadlineAt: NOW + 60_000, now: NOW + 50 })).toBe(false);
  });

  it('ignores a job whose clock was cleared since (AI turn, choice card, game over)', () => {
    expect(isTurnTimerJobCurrent({ jobDeadlineAt: NOW, armedDeadlineAt: null, now: NOW + 50 })).toBe(false);
    expect(isTurnTimerJobCurrent({ jobDeadlineAt: NOW, armedDeadlineAt: undefined, now: NOW + 50 })).toBe(false);
  });

  it('lets a job queued without a deadline act only once the armed deadline has passed', () => {
    expect(isTurnTimerJobCurrent({ jobDeadlineAt: undefined, armedDeadlineAt: NOW, now: NOW + 50 })).toBe(true);
    expect(isTurnTimerJobCurrent({ jobDeadlineAt: undefined, armedDeadlineAt: NOW + 60_000, now: NOW })).toBe(false);
    expect(isTurnTimerJobCurrent({ jobDeadlineAt: undefined, armedDeadlineAt: null, now: NOW })).toBe(false);
  });
});

describe('isAsyncDeadlineJobCurrent', () => {
  /** The game: seat 1 to move on turn 3, its deadline armed for NOW. */
  function current(
    job: Parameters<typeof isAsyncDeadlineJobCurrent>[0]['job'],
    game: { turnNumber?: number; playerIndex?: number; armedDeadlineAt?: number | null; now?: number } = {},
  ): boolean {
    return isAsyncDeadlineJobCurrent({
      job,
      turnNumber: game.turnNumber ?? 3,
      playerIndex: game.playerIndex ?? 1,
      armedDeadlineAt: game.armedDeadlineAt === undefined ? NOW : game.armedDeadlineAt,
      now: game.now ?? NOW + 50,
    });
  }

  it('lapses the deadline the seat to move still has', () => {
    expect(current({ turnNumber: 3, playerIndex: 1, deadlineAt: NOW })).toBe(true);
  });

  it('ignores a job for another turn or seat', () => {
    expect(current({ turnNumber: 2, playerIndex: 1, deadlineAt: NOW })).toBe(false);
    expect(current({ turnNumber: 3, playerIndex: 0, deadlineAt: NOW })).toBe(false);
  });

  it('ignores a job for a deadline the seat no longer has, though turn and seat match', () => {
    // A Territory Draft's picks and turn one all run as turn 1: the seat's
    // earlier deadline must not cut its next one short.
    expect(current({ turnNumber: 3, playerIndex: 1, deadlineAt: NOW - 3_600_000 })).toBe(false);
  });

  it('leaves it to turn and seat when the game has no deadline on record', () => {
    expect(current({ turnNumber: 3, playerIndex: 1, deadlineAt: NOW }, { armedDeadlineAt: null })).toBe(true);
    expect(current({ turnNumber: 3, playerIndex: 0, deadlineAt: NOW }, { armedDeadlineAt: null })).toBe(false);
  });

  it('lets a job queued without a deadline act only once the armed deadline has passed', () => {
    expect(current({ turnNumber: 3, playerIndex: 1 })).toBe(true);
    expect(current({ turnNumber: 3, playerIndex: 1 }, { armedDeadlineAt: NOW + 3_600_000 })).toBe(false);
  });
});
