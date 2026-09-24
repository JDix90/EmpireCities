import { describe, it, expect } from 'vitest';
import { resolveGameOverResult } from './dailyGameOver';

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
