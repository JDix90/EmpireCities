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

describe('mapControlProgress in a team game', () => {
  it("counts the side's territories together, as the server reads the threshold", () => {
    const state = {
      settings: { allowed_victory_conditions: ['threshold'], victory_threshold: 75 },
      territories: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}`, { owner_id: null }])),
      players: [
        { player_id: 'me', territory_count: 8, is_eliminated: false },
        { player_id: 'x', territory_count: 3, is_eliminated: false },
        { player_id: 'pal', territory_count: 6, is_eliminated: false },
        { player_id: 'y', territory_count: 3, is_eliminated: false },
      ],
      teams: [
        { team_id: 'team_1', name: 'Us', player_ids: ['me', 'pal'] },
        { team_id: 'team_2', name: 'Them', player_ids: ['x', 'y'] },
      ],
    } as unknown as GameState;
    // 75% of 20 is 15; 8 + 6 is one short.
    expect(mapControlProgress(state, 'me')).toEqual({
      held: 14, total: 20, heldPct: 70, thresholdPct: 75, needed: 15, remaining: 1, side: true,
    });
    expect(mapControlProgress({ ...state, teams: undefined }, 'me')).toEqual({
      held: 8, total: 20, heldPct: 40, thresholdPct: 75, needed: 15, remaining: 7,
    });
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

describe('mapControlProgress with era-tied conquest (the server\'s conquest_status)', () => {
  const status = {
    share_pct: 50,
    needed: 29,
    base_share_pct: 65,
    next_share_pct: 47,
    required_era_id: 'modern',
    open_for_viewer: false,
    claim_at_turn_start: true,
    on_course_ids: ['rival'],
  };
  const withStatus = (held: number, over: Partial<typeof status> = {}): GameState => {
    const state = mkState({ total: 57, held });
    (state.players as unknown as Array<{ player_id: string; username: string }>).forEach((p) => { p.username = p.player_id === 'me' ? 'Me' : 'Rome'; });
    return { ...state, conquest_status: { ...status, ...over } } as GameState;
  };

  it('takes the share and the territories it comes to from the server, not from the settings', () => {
    expect(mapControlProgress(withStatus(20), 'me')).toMatchObject({ thresholdPct: 50, needed: 29, remaining: 9 });
  });

  it('says the share is not open to the player yet, and names a rival on course to win', () => {
    expect(mapControlProgress(withStatus(20), 'me')!.conquest).toEqual({
      basePct: 65,
      lockedUntilEraId: 'modern',
      nextPct: 47,
      claimAtTurnStart: true,
      onCourse: false,
      rivalsOnCourse: ['Rome'],
    });
  });

  it('says when the player is the one on course, once the share is open to them', () => {
    const conquest = mapControlProgress(withStatus(29, { open_for_viewer: true, on_course_ids: ['me'] }), 'me')!.conquest!;
    expect(conquest.lockedUntilEraId).toBeUndefined();
    expect(conquest.onCourse).toBe(true);
    expect(conquest.rivalsOnCourse).toEqual([]);
  });

  it('is absent in a game without era-tied conquest', () => {
    expect(mapControlProgress(mkState({ total: 57, held: 20 }), 'me')!.conquest).toBeUndefined();
  });
});
