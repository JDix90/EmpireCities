import { describe, it, expect } from 'vitest';
import { replayBackTarget, type ReplayBackContext } from './replayBackTarget';

const ctx = (over: Partial<ReplayBackContext> = {}): ReplayBackContext => ({
  fromDaily: false,
  fromMatch: false,
  loadedPublic: false,
  isAuthenticated: true,
  isFirstAppEntry: false,
  ...over,
});

describe('replayBackTarget', () => {
  it('returns a daily replay to the daily page', () => {
    expect(replayBackTarget(ctx({ fromDaily: true }))).toEqual({ label: 'Back to Daily', to: '/daily' });
  });

  it('returns the player to the lobby after their own match', () => {
    // The game-over "Clip" CTA deep-links with source=match: the player who
    // just finished a game must never be sent back to /game/:id, which has no
    // board left to show them.
    expect(replayBackTarget(ctx({ fromMatch: true }))).toEqual({ label: 'Back to Lobby', to: '/lobby' });
  });

  it('keeps the lobby target for a signed-in player even on a fresh tab', () => {
    expect(replayBackTarget(ctx({ fromMatch: true, isFirstAppEntry: true })).to).toBe('/lobby');
  });

  it('sends a signed-out viewer of a public replay home', () => {
    expect(replayBackTarget(ctx({ loadedPublic: true, isAuthenticated: false }))).toEqual({
      label: 'Home',
      to: '/',
    });
  });

  it('sends a signed-out viewer home on a pasted link, public flag or not', () => {
    // Nothing in-app is behind the entry, so history.back() would walk them
    // off the site.
    expect(replayBackTarget(ctx({ isAuthenticated: false, isFirstAppEntry: true })).to).toBe('/');
  });

  it('gives a signed-in viewer a lobby to land on when there is no history', () => {
    expect(replayBackTarget(ctx({ isFirstAppEntry: true }))).toEqual({
      label: 'Back to Lobby',
      to: '/lobby',
    });
  });

  it('steps back through history only when there is in-app history to step through', () => {
    // A replay opened from the profile should return to the profile.
    expect(replayBackTarget(ctx())).toEqual({ label: 'Back', to: 'back' });
  });

  it('never labels a step-through as a destination, or a destination as a step', () => {
    const cases: Partial<ReplayBackContext>[] = [
      {}, { fromDaily: true }, { fromMatch: true }, { isFirstAppEntry: true },
      { isAuthenticated: false, isFirstAppEntry: true }, { loadedPublic: true, isAuthenticated: false },
    ];
    for (const over of cases) {
      const target = replayBackTarget(ctx(over));
      expect(target.to === 'back' ? target.label === 'Back' : target.label !== 'Back').toBe(true);
    }
  });
});
