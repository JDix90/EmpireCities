import { describe, it, expect } from 'vitest';
import type { GameState } from '../store/gameStore';
import { mapControlProgress, mapControlThreshold } from './mapControl';

/** A board of `total` territories where `me` holds `held` of them. */
function mkState(opts: {
  total: number;
  held: number;
  settings?: Record<string, unknown>;
  eliminated?: boolean;
}): GameState {
  const territories: Record<string, { owner_id: string | null }> = {};
  for (let i = 0; i < opts.total; i++) {
    territories[`t${i}`] = { owner_id: i < opts.held ? 'me' : i % 2 ? 'rival' : null };
  }
  return {
    settings: {
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
      ...opts.settings,
    },
    territories,
    players: [
      { player_id: 'me', territory_count: opts.held, is_eliminated: !!opts.eliminated },
      { player_id: 'rival', territory_count: Math.floor((opts.total - opts.held) / 2), is_eliminated: false },
    ],
  } as unknown as GameState;
}

describe('mapControlProgress', () => {
  it('measures a Quick Match Conquest (65%) game on the WW2 board as dealt', () => {
    // 35 territories in play: the map document has 42, but its seven frontier
    // tiles only enter the game with Era Advancement, and the server divides by
    // the territories in the game state.
    expect(mapControlProgress(mkState({ total: 35, held: 9 }), 'me')).toEqual({
      held: 9,
      total: 35,
      heldPct: 25,
      thresholdPct: 65,
      needed: 23,
      remaining: 14,
    });
  });

  it('measures Blitz (50%) the way the server does: 29 of 57, not 28', () => {
    const p = mapControlProgress(mkState({ total: 57, held: 28, settings: { victory_threshold: 50 } }), 'me');
    expect(p).toMatchObject({ heldPct: 49, needed: 29, remaining: 1 });
  });

  it('divides by every territory in the game, unowned ones included', () => {
    // Half of this board is neutral; holding 10 of 20 is 50% of the MAP, not
    // 100% of the owned ground.
    const state = mkState({ total: 20, held: 10 });
    for (let i = 10; i < 20; i++) state.territories[`t${i}`] = { owner_id: null } as never;
    expect(mapControlProgress(state, 'me')).toMatchObject({ total: 20, heldPct: 50 });
  });

  it('rounds the share down, so it never shows a win the server has not given', () => {
    // 27/42 is 64.3%: one short of 65%, and it must read 64, not 65.
    expect(mapControlProgress(mkState({ total: 42, held: 27 }), 'me')).toMatchObject({ heldPct: 64, remaining: 1 });
    expect(mapControlProgress(mkState({ total: 42, held: 28 }), 'me')).toMatchObject({ heldPct: 66, remaining: 0 });
  });

  it('is absent when the game cannot be won by holding a share of the map', () => {
    expect(mapControlProgress(mkState({ total: 42, held: 18, settings: { allowed_victory_conditions: ['domination'] } }), 'me')).toBeNull();
    // Threshold ticked with no percentage: the server never fires it either.
    expect(mapControlProgress(mkState({ total: 42, held: 18, settings: { victory_threshold: undefined } }), 'me')).toBeNull();
    // A deliberately empty list means no condition at all, as on the server.
    expect(mapControlProgress(mkState({ total: 42, held: 18, settings: { allowed_victory_conditions: [] } }), 'me')).toBeNull();
  });

  it('reads a legacy single victory_type the way the server does', () => {
    const state = mkState({
      total: 42,
      held: 18,
      settings: { allowed_victory_conditions: undefined, victory_type: 'threshold', victory_threshold: 60 },
    });
    expect(mapControlProgress(state, 'me')).toMatchObject({ thresholdPct: 60, needed: 26 });
  });

  it('is absent for spectators and eliminated players', () => {
    expect(mapControlProgress(mkState({ total: 42, held: 18 }), null)).toBeNull();
    expect(mapControlProgress(mkState({ total: 42, held: 18 }), 'someone-else')).toBeNull();
    expect(mapControlProgress(mkState({ total: 42, held: 0, eliminated: true }), 'me')).toBeNull();
    expect(mapControlProgress(null, 'me')).toBeNull();
  });
});

describe('mapControlThreshold', () => {
  it('normalizes the percentage as normalizeGameSettings does', () => {
    const settings = (victory_threshold: unknown) =>
      ({ allowed_victory_conditions: ['threshold'], victory_threshold }) as unknown as GameState['settings'];
    expect(mapControlThreshold(settings(65))).toBe(65);
    expect(mapControlThreshold(settings(65.9))).toBe(65);
    expect(mapControlThreshold(settings(150))).toBe(99);
    expect(mapControlThreshold(settings(0))).toBe(1);
    expect(mapControlThreshold(settings('65'))).toBeNull();
  });
});

describe('mapControlProgress rounding', () => {
  it('needs exactly the stated share, matching the server (55% of 100 is 55)', () => {
    expect(mapControlProgress(mkState({ total: 100, held: 55, settings: { victory_threshold: 55 } }), 'me'))
      .toMatchObject({ needed: 55, remaining: 0 });
  });
});
