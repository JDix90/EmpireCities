/**
 * Team play's shared rules (state/teams.ts), read off a bare state:
 *   • allies are two different players on one side; a free-for-all game has
 *     none, so every helper answers as the engine always has;
 *   • a region a side holds whole pays once, to the member holding most of it;
 *   • the opening ceasefire lasts until every seat has had a turn, counted
 *     from the starting seat, and shields enemies but never neutral ground.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { GameState, GameTeam } from '../../types';
import {
  allyIdsOf,
  areAllies,
  inOpeningCeasefire,
  isFriendlyOwner,
  isShieldedFrom,
  isTeamGame,
  regionBonusHolder,
  shieldedTargetError,
  sideOf,
  teamOf,
  TEAM_TUNING,
} from './teams';

const TEAMS: GameTeam[] = [
  { team_id: 'team_1', name: 'Stellar Mandate & Forge Syndicate', player_ids: ['a1', 'a2'] },
  { team_id: 'team_2', name: 'Helion Navigators & Void Custodians', player_ids: ['b1', 'b2'] },
];

function teamState(over: Partial<GameState> = {}): GameState {
  return { teams: TEAMS, turn_number: 5, current_player_index: 0, starting_player_index: 0, ...over } as GameState;
}

afterEach(() => { TEAM_TUNING.openingCeasefire = true; });

describe('allies', () => {
  it('are two different players on one side', () => {
    const state = teamState();
    expect(areAllies(state, 'a1', 'a2')).toBe(true);
    expect(areAllies(state, 'a1', 'b1')).toBe(false);
    expect(areAllies(state, 'a1', 'a1')).toBe(false);
    expect(areAllies(state, 'a1', null)).toBe(false);
    expect(teamOf(state, 'b2')?.team_id).toBe('team_2');
    expect(allyIdsOf(state, 'a1')).toEqual(['a2']);
    expect(sideOf(state, 'b1')).toEqual(['b1', 'b2']);
  });

  it('do not exist in a free-for-all game', () => {
    const ffa = { turn_number: 1, current_player_index: 0 } as GameState;
    expect(isTeamGame(ffa)).toBe(false);
    expect(areAllies(ffa, 'a1', 'a2')).toBe(false);
    expect(teamOf(ffa, 'a1')).toBeNull();
    expect(sideOf(ffa, 'a1')).toEqual(['a1']);
    expect(allyIdsOf(ffa, 'a1')).toEqual([]);
    expect(inOpeningCeasefire(ffa)).toBe(false);
    expect(isShieldedFrom(ffa, 'a1', 'a2')).toBe(false);
  });

  it("make an ally's ground friendly, and neutral ground never", () => {
    const state = teamState();
    expect(isFriendlyOwner(state, 'a1', 'a1')).toBe(true);
    expect(isFriendlyOwner(state, 'a1', 'a2')).toBe(true);
    expect(isFriendlyOwner(state, 'a1', 'b1')).toBe(false);
    expect(isFriendlyOwner(state, 'a1', null)).toBe(false);
  });
});

describe('a region held by a side', () => {
  const state = teamState();

  it('pays its one owner, as in a free-for-all game', () => {
    expect(regionBonusHolder(state, ['a1', 'a1', 'a1'])).toBe('a1');
    expect(regionBonusHolder({}, ['x', 'x'])).toBe('x');
  });

  it('pays the member holding most of it when allies share it', () => {
    expect(regionBonusHolder(state, ['a1', 'a2', 'a2'])).toBe('a2');
    expect(regionBonusHolder(state, ['a2', 'a1', 'a1'])).toBe('a1');
  });

  it('breaks a tie toward the earlier seat of the side', () => {
    expect(regionBonusHolder(state, ['a2', 'a1'])).toBe('a1');
  });

  it('pays nobody while an enemy, a neutral tile or nothing is in it', () => {
    expect(regionBonusHolder(state, ['a1', 'b1'])).toBeNull();
    expect(regionBonusHolder(state, ['a1', null])).toBeNull();
    expect(regionBonusHolder(state, [null, null])).toBeNull();
    expect(regionBonusHolder(state, [])).toBeNull();
    expect(regionBonusHolder({}, ['a1', 'a2'])).toBeNull();
  });
});

describe('the opening ceasefire', () => {
  it('holds through the first round when seat 0 starts', () => {
    expect(inOpeningCeasefire(teamState({ turn_number: 1, current_player_index: 3 }))).toBe(true);
    expect(inOpeningCeasefire(teamState({ turn_number: 2, current_player_index: 0 }))).toBe(false);
  });

  it('lasts exactly the first round whichever seat starts', () => {
    // Seats 2, 3, 0 and 1 all play in turn 1 — the counter advances when play
    // returns to the starting seat, not when the seat index wraps — so seat
    // 2's second turn, which opens turn 2, ends it.
    const at = (turn_number: number, current_player_index: number) =>
      inOpeningCeasefire(teamState({ turn_number, current_player_index, starting_player_index: 2 }));
    expect(at(1, 2)).toBe(true);
    expect(at(1, 3)).toBe(true);
    expect(at(1, 0)).toBe(true);
    expect(at(1, 1)).toBe(true);
    expect(at(2, 2)).toBe(false);
    expect(at(2, 0)).toBe(false);
  });

  it('shields enemies, and never neutral ground or your own', () => {
    const state = teamState({ turn_number: 1 });
    expect(isShieldedFrom(state, 'a1', 'b1')).toBe(true);
    expect(isShieldedFrom(state, 'a1', null)).toBe(false);
    expect(isShieldedFrom(state, 'a1', 'a1')).toBe(false);
    expect(shieldedTargetError(state, 'a1', 'b1')).toMatch(/ceasefire/);
  });

  it('is gone after it, while an ally stays shielded', () => {
    const state = teamState({ turn_number: 4 });
    expect(isShieldedFrom(state, 'a1', 'b1')).toBe(false);
    expect(isShieldedFrom(state, 'a1', 'a2')).toBe(true);
    expect(shieldedTargetError(state, 'a1', 'a2')).toBe('You cannot attack an ally');
  });

  it('can be switched off for measurement', () => {
    TEAM_TUNING.openingCeasefire = false;
    expect(isShieldedFrom(teamState({ turn_number: 1 }), 'a1', 'b1')).toBe(false);
  });
});
