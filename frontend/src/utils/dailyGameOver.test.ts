import { describe, it, expect } from 'vitest';
import { isClassicDaily, resolveGameOverResult } from './dailyGameOver';

const ME = 'user-1';
const AI = 'ai_1';
const GOAL = 'Research “Star Forts”.';

describe('resolveGameOverResult', () => {
  it('shows a conquest that beat the objective as a loss, not a victory', () => {
    // The reported run: the only rival eliminated on turn 1, the tech not yet
    // researched. The game's winner is the player; the challenge's is not.
    expect(resolveGameOverResult({ won: false, outcome: 'unmet' }, ME, [ME], GOAL)).toEqual({
      isWinner: false,
      daily_challenge: { outcome: 'unmet', goal: GOAL },
    });
  });

  it('carries a solved or failed day through with its goal', () => {
    expect(resolveGameOverResult({ won: true, outcome: 'solved' }, ME, [ME], GOAL)).toEqual({
      isWinner: true,
      daily_challenge: { outcome: 'solved', goal: GOAL },
    });
    expect(resolveGameOverResult({ won: false, outcome: 'failed' }, ME, [AI], GOAL)).toEqual({
      isWinner: false,
      daily_challenge: { outcome: 'failed', goal: GOAL },
    });
  });

  it('falls back to the winner ids on a domination day and on ordinary games', () => {
    expect(resolveGameOverResult({ won: true, outcome: null }, ME, [ME], GOAL)).toEqual({
      isWinner: true,
      daily_challenge: undefined,
    });
    expect(resolveGameOverResult(undefined, ME, [AI], undefined)).toEqual({
      isWinner: false,
      daily_challenge: undefined,
    });
    expect(resolveGameOverResult(undefined, undefined, [ME], undefined).isWinner).toBe(false);
  });

  it('drops a missing or blank goal rather than printing it', () => {
    expect(resolveGameOverResult({ won: false, outcome: 'unmet' }, ME, [ME], '').daily_challenge)
      .toEqual({ outcome: 'unmet', goal: undefined });
    expect(resolveGameOverResult({ won: false, outcome: 'unmet' }, ME, [ME], 42).daily_challenge)
      .toEqual({ outcome: 'unmet', goal: undefined });
  });
});

describe('isClassicDaily', () => {
  const v2 = { version: 2 };

  it('is a daily without a v2 reading while grading is on', () => {
    expect(isClassicDaily({ daily_challenge_date: '2026-10-09', daily_challenge_spec: {} }, true)).toBe(true);
  });

  it('is not a graded day, an ordinary game, or any day with grading off', () => {
    expect(isClassicDaily({ daily_challenge_date: '2026-10-07', daily_challenge_spec: { v2 } }, true)).toBe(false);
    expect(isClassicDaily({}, true)).toBe(false);
    expect(isClassicDaily(undefined, true)).toBe(false);
    expect(isClassicDaily({ daily_challenge_date: '2026-10-09', daily_challenge_spec: {} }, false)).toBe(false);
  });
});
