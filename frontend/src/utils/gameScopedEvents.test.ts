import { describe, it, expect } from 'vitest';
import { isForAnotherGame } from './gameScopedEvents';

describe('isForAnotherGame', () => {
  it('is true for an event from a game other than the one on screen', () => {
    // The bug: a truce offer, alert or fog visual from another game acted on this page.
    expect(isForAnotherGame('game-b', 'game-a')).toBe(true);
  });

  it("is false for the page's own game", () => {
    expect(isForAnotherGame('game-a', 'game-a')).toBe(false);
  });

  it('keeps the old reading for an event from an older server, which names no game', () => {
    expect(isForAnotherGame(undefined, 'game-a')).toBe(false);
    expect(isForAnotherGame(null, 'game-a')).toBe(false);
    expect(isForAnotherGame('', 'game-a')).toBe(false);
  });

  it('drops nothing on a page without a game id', () => {
    expect(isForAnotherGame('game-b', undefined)).toBe(false);
  });
});
