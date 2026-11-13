import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { normalizeGameSettings } from '../state/gameSettings';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import { getMaxEraIndex } from '../eraAdvancement/spines';
import { winStandings } from '../ai/aiEnding';
import {
  conquestOpenFor,
  conquestSharePct,
  conquestTerritoriesNeeded,
  erasConquestActive,
  hasConquestVictory,
  noteEraReached,
} from './conquestRules';
import { buildConquestClientStatus, roundOfNextTurn } from './conquestStatus';

const MAP = JSON.parse(readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8')) as GameMap;

/** The lobby's Full Game with the era-tied ending, as the create boundary bakes it. */
const AGES: Partial<GameSettings> = {
  allowed_victory_conditions: ['domination', 'threshold'],
  victory_threshold: 65,
  economy_enabled: true,
  tech_trees_enabled: true,
  era_advancement_enabled: true,
  era_advancement_preset: 'standard',
  conquest_final_era_only: true,
  conquest_decay_points_per_round: 3,
  conquest_decay_delay_rounds: 5,
  conquest_claim_at_turn_start: true,
};

function game(settings: Partial<GameSettings>, seats = 3): GameState {
  const players = Array.from({ length: seats }, (_, i) => ({
    player_id: `p${i}`,
    player_index: i,
    username: `P${i}`,
    color: '#000000',
    is_ai: true,
    ai_difficulty: 'medium' as const,
    is_eliminated: false,
    mmr: 1000,
  }));
  const state = initializeGameState('conquest-rules', 'ancient', structuredClone(MAP), players, normalizeGameSettings(settings), {
    forceStartingPlayerIndex: 0,
  });
  state.turn_number = 10;
  return state;
}

/** Hand `count` territories to `playerId` and the rest to the other seats in turn, and settle the counts. */
function deal(state: GameState, playerId: string, count: number): void {
  const others = state.players.filter((p) => p.player_id !== playerId);
  Object.values(state.territories).forEach((t, i) => {
    t.owner_id = i < count ? playerId : others[i % others.length]!.player_id;
    t.unit_count = 3;
  });
  for (const p of state.players) {
    p.territory_count = Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length;
  }
}

const total = (state: GameState): number => Object.keys(state.territories).length;
const share = (state: GameState, pct: number): number => Math.ceil((total(state) * pct) / 100);
const inLastEra = (state: GameState, playerId: string): void => {
  state.players.find((p) => p.player_id === playerId)!.current_era_index = getMaxEraIndex(state);
};

describe('the plain threshold, with no era-tied conquest setting', () => {
  const plain: Partial<GameSettings> = { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 65 };

  it('asks the same share of everyone in every round, and wins at once', () => {
    const state = game(plain);
    expect(erasConquestActive(state)).toBe(false);
    expect(conquestSharePct(state)).toBe(65);
    expect(conquestSharePct(state, 500)).toBe(65);
    expect(conquestTerritoriesNeeded(state)).toBe(share(state, 65));
    expect(conquestOpenFor(state, state.players[0]!)).toBe(true);

    deal(state, 'p0', share(state, 65) - 1);
    expect(checkVictory(state, MAP)).toBeNull();
    deal(state, 'p0', share(state, 65));
    expect(checkVictory(state, MAP)).toEqual({ winnerIds: ['p0'], condition: 'threshold' });
    expect(buildConquestClientStatus(state, 'p0')).toBeNull();
  });

  it('is not a way to win when the threshold is not among the endings', () => {
    const state = game({ allowed_victory_conditions: ['domination'], victory_threshold: 65 });
    expect(conquestSharePct(state)).toBeNull();
    deal(state, 'p0', total(state) - 1);
    expect(hasConquestVictory(state, state.players[0]!)).toBe(false);
  });

  it('ignores the era-tied settings in a game without era advancement', () => {
    const state = game({ ...plain, conquest_final_era_only: true, conquest_decay_points_per_round: 3, conquest_claim_at_turn_start: true });
    expect(state.settings.conquest_final_era_only).toBeUndefined();
    expect(state.settings.conquest_decay_points_per_round).toBeUndefined();
    expect(state.settings.conquest_claim_at_turn_start).toBeUndefined();
    deal(state, 'p0', share(state, 65));
    expect(checkVictory(state, MAP)).toEqual({ winnerIds: ['p0'], condition: 'threshold' });
  });
});

describe('conquest counts only from the last era (conquest_final_era_only)', () => {
  it('a player short of the last era does not win on the share; one in it does', () => {
    const state = game({ ...AGES, conquest_decay_points_per_round: undefined, conquest_claim_at_turn_start: undefined });
    deal(state, 'p0', share(state, 65));
    expect(conquestOpenFor(state, state.players[0]!)).toBe(false);
    expect(checkVictory(state, MAP)).toBeNull();

    inLastEra(state, 'p0');
    expect(checkVictory(state, MAP)).toEqual({ winnerIds: ['p0'], condition: 'threshold' });
  });

  it('still lets the whole board win in any era', () => {
    const state = game({ ...AGES, conquest_claim_at_turn_start: undefined });
    deal(state, 'p0', total(state));
    expect(checkVictory(state, MAP)).toEqual({ winnerIds: ['p0'], condition: 'domination' });
  });
});

describe('the share falls once the last era is reached (conquest_decay_*)', () => {
  it('holds at the full share until a player reaches the last era, however long that takes', () => {
    const state = game(AGES);
    state.turn_number = 120;
    expect(conquestSharePct(state)).toBe(65);
  });

  it('holds for the delay, then falls by the points each round, never below one percent', () => {
    const state = game(AGES);
    state.final_era_reached_turn = 40;
    expect(conquestSharePct(state, 40)).toBe(65);
    expect(conquestSharePct(state, 45)).toBe(65);
    expect(conquestSharePct(state, 46)).toBe(62);
    expect(conquestSharePct(state, 50)).toBe(50);
    expect(conquestSharePct(state, 200)).toBe(1);
    state.turn_number = 50;
    expect(conquestTerritoriesNeeded(state)).toBe(share(state, 50));
  });

  it('starts the fall at the first arrival in the last era, and only then', () => {
    const state = game(AGES);
    const last = getMaxEraIndex(state);
    noteEraReached(state, last - 1);
    expect(state.final_era_reached_turn).toBeUndefined();
    state.turn_number = 38;
    noteEraReached(state, last);
    expect(state.final_era_reached_turn).toBe(38);
    state.turn_number = 44;
    noteEraReached(state, last);
    expect(state.final_era_reached_turn).toBe(38);
  });

  it('records nothing in a game whose share does not fall', () => {
    const state = game({ ...AGES, conquest_decay_points_per_round: undefined });
    noteEraReached(state, getMaxEraIndex(state));
    expect(state.final_era_reached_turn).toBeUndefined();
  });
});

describe('a win is claimed as the holder\'s own turn opens (conquest_claim_at_turn_start)', () => {
  it('a player who takes the share mid-turn has not won yet', () => {
    const state = game(AGES);
    inLastEra(state, 'p0');
    deal(state, 'p0', share(state, 65));
    expect(checkVictory(state, MAP)).toBeNull();
  });

  it('wins when the turn comes round and the share is still in hand', () => {
    const state = game(AGES);
    inLastEra(state, 'p0');
    deal(state, 'p0', share(state, 65));
    advanceToNextPlayer(state, MAP);
    expect(checkVictory(state, MAP)).toBeNull();
    advanceToNextPlayer(state, MAP);
    expect(checkVictory(state, MAP)).toBeNull();
    advanceToNextPlayer(state, MAP);
    expect(state.players[state.current_player_index]!.player_id).toBe('p0');
    expect(state.conquest_claimant_id).toBe('p0');
    expect(checkVictory(state, MAP)).toEqual({ winnerIds: ['p0'], condition: 'threshold' });
  });

  it('does not win when a rival takes it back below the line first', () => {
    const state = game(AGES);
    inLastEra(state, 'p0');
    deal(state, 'p0', share(state, 65));
    advanceToNextPlayer(state, MAP);
    deal(state, 'p0', share(state, 65) - 1);
    advanceToNextPlayer(state, MAP);
    advanceToNextPlayer(state, MAP);
    expect(state.conquest_claimant_id).toBeUndefined();
    expect(checkVictory(state, MAP)).toBeNull();
  });

  it('a claim does not outlive the turn it was made for', () => {
    const state = game(AGES);
    inLastEra(state, 'p1');
    state.conquest_claimant_id = 'p1';
    advanceToNextPlayer(state, MAP);
    expect(state.players[state.current_player_index]!.player_id).toBe('p1');
    expect(state.conquest_claimant_id).toBeUndefined();
  });

  it('the falling share can meet a holder who never gained a territory', () => {
    const state = game(AGES);
    inLastEra(state, 'p0');
    state.final_era_reached_turn = 30;
    state.turn_number = 44; // share 65 - 3 * (44 - 30 - 5) = 38
    deal(state, 'p0', share(state, 37));
    expect(conquestSharePct(state)).toBe(38);
    advanceToNextPlayer(state, MAP);
    advanceToNextPlayer(state, MAP);
    advanceToNextPlayer(state, MAP); // the round turns: 35%
    expect(state.turn_number).toBe(45);
    expect(checkVictory(state, MAP)).toEqual({ winnerIds: ['p0'], condition: 'threshold' });
  });
});

describe('the bots and the surrender offer read the same rule (ai/aiEnding.ts winStandings)', () => {
  it('measures a player short of the last era against the whole board, and one in it against the share', () => {
    const state = game(AGES);
    deal(state, 'p0', share(state, 65));
    const before = winStandings(state).find((s) => s.playerId === 'p0')!.closeness;
    expect(before).toBeCloseTo(share(state, 65) / total(state), 5);
    inLastEra(state, 'p0');
    expect(winStandings(state).find((s) => s.playerId === 'p0')!.closeness).toBe(1);
  });

  it('follows the share as it falls', () => {
    const state = game(AGES);
    inLastEra(state, 'p0');
    deal(state, 'p0', share(state, 40));
    state.final_era_reached_turn = 30;
    state.turn_number = 40; // share 65 - 3 * 5 = 50
    expect(winStandings(state).find((s) => s.playerId === 'p0')!.closeness).toBeCloseTo(share(state, 40) / share(state, 50), 5);
  });
});

describe('what a client is told (victory/conquestStatus.ts)', () => {
  it('gives the share now and next, the era that opens it, and who is on course to win', () => {
    const state = game(AGES);
    inLastEra(state, 'p1');
    state.final_era_reached_turn = 30;
    state.turn_number = 40;
    deal(state, 'p1', share(state, 50));
    const status = buildConquestClientStatus(state, 'p0')!;
    expect(status).toMatchObject({
      share_pct: 50,
      needed: share(state, 50),
      base_share_pct: 65,
      next_share_pct: 47,
      required_era_id: 'modern',
      open_for_viewer: false,
      claim_at_turn_start: true,
      on_course_ids: ['p1'],
    });
    expect(buildConquestClientStatus(state, 'p1')!.open_for_viewer).toBe(true);
    expect(buildConquestClientStatus(state, null)!.open_for_viewer).toBe(true);
  });

  it('counts a holder on course at the share their own next turn will ask', () => {
    const state = game(AGES);
    inLastEra(state, 'p0');
    state.final_era_reached_turn = 30;
    state.turn_number = 40;
    // p0 is moving now; its next turn opens in round 41, at 47%.
    deal(state, 'p0', share(state, 47));
    expect(roundOfNextTurn(state, 0)).toBe(41);
    expect(roundOfNextTurn(state, 1)).toBe(40);
    expect(buildConquestClientStatus(state, 'p0')!.on_course_ids).toEqual(['p0']);
  });

  it('says when the fall begins while it is still ahead', () => {
    const state = game(AGES);
    state.final_era_reached_turn = 38;
    state.turn_number = 40;
    const status = buildConquestClientStatus(state, 'p0')!;
    expect(status.share_pct).toBe(65);
    expect(status.falls_from_round).toBe(44);
    expect(status.next_share_pct).toBeUndefined();
  });
});
