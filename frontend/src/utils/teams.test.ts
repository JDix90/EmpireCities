import { describe, it, expect } from 'vitest';
import type { GameState, GameTeam } from '../store/gameStore';
import {
  allyIdsOf,
  areAllies,
  describeTeams,
  inOpeningCeasefire,
  isFriendlyOwner,
  isShieldedFrom,
  playerGroups,
  regionBonusHolder,
  teamOf,
} from './teams';

const TEAMS: GameTeam[] = [
  { team_id: 'team_1', name: 'Stellar Mandate & Forge Syndicate', player_ids: ['me', 'pal'] },
  { team_id: 'team_2', name: 'Helion Navigators & Void Custodians', player_ids: ['x', 'y'] },
];

function state(over: Partial<GameState> = {}): GameState {
  return {
    teams: TEAMS,
    turn_number: 4,
    current_player_index: 0,
    starting_player_index: 0,
    players: ['me', 'x', 'pal', 'y'].map((id, i) => ({ player_id: id, username: id.toUpperCase(), player_index: i })),
    settings: { fog_of_war: false },
    ...over,
  } as unknown as GameState;
}

describe('team helpers mirror the server', () => {
  it('know who is allied', () => {
    const s = state();
    expect(areAllies(s, 'me', 'pal')).toBe(true);
    expect(areAllies(s, 'me', 'x')).toBe(false);
    expect(areAllies(s, 'me', 'me')).toBe(false);
    expect(teamOf(s, 'y')?.team_id).toBe('team_2');
    expect(allyIdsOf(s, 'me')).toEqual(['pal']);
    expect(isFriendlyOwner(s, 'me', 'pal')).toBe(true);
    expect(isFriendlyOwner(s, 'me', null)).toBe(false);
    expect(areAllies(state({ teams: undefined }), 'me', 'pal')).toBe(false);
  });

  it('hold the opening ceasefire until the starting seat is up again', () => {
    expect(inOpeningCeasefire(state({ turn_number: 1 }))).toBe(true);
    expect(inOpeningCeasefire(state({ turn_number: 2, current_player_index: 1, starting_player_index: 2 }))).toBe(true);
    expect(inOpeningCeasefire(state({ turn_number: 2, current_player_index: 2, starting_player_index: 2 }))).toBe(false);
    expect(inOpeningCeasefire(state({ teams: undefined, turn_number: 1 }))).toBe(false);
    expect(isShieldedFrom(state({ turn_number: 1 }), 'me', 'x')).toBe(true);
    expect(isShieldedFrom(state({ turn_number: 1 }), 'me', null)).toBe(false);
    expect(isShieldedFrom(state(), 'me', 'x')).toBe(false);
    expect(isShieldedFrom(state(), 'me', 'pal')).toBe(true);
  });

  it('pay a region the side holds to the member holding most of it', () => {
    expect(regionBonusHolder(state(), ['me', 'pal', 'pal'])).toBe('pal');
    expect(regionBonusHolder(state(), ['pal', 'me'])).toBe('me');
    expect(regionBonusHolder(state(), ['me', 'x'])).toBeNull();
    expect(regionBonusHolder({}, ['me', 'me'])).toBe('me');
  });
});

describe('describeTeams', () => {
  it("names the viewer's side and the one it faces", () => {
    const lines = describeTeams(state(), 'me');
    expect(lines[0]).toBe('Your side, the Stellar Mandate & Forge Syndicate: you and PAL.');
    expect(lines[1]).toBe('Against the Helion Navigators & Void Custodians: X and Y.');
    expect(lines.some((l) => /wins together/.test(l))).toBe(true);
    expect(lines.some((l) => /under fog/i.test(l))).toBe(false);
  });

  it('mentions shared vision only with fog on, and lists every side to a spectator', () => {
    expect(describeTeams(state({ settings: { fog_of_war: true } } as Partial<GameState>), 'me').some((l) => /see whatever your allies see/.test(l))).toBe(true);
    expect(describeTeams(state(), null)[0]).toMatch(/^2 sides: the Stellar Mandate & Forge Syndicate: ME and PAL; /);
  });

  it('is empty in a free-for-all game', () => {
    expect(describeTeams(state({ teams: undefined }), 'me')).toEqual([]);
  });
});

describe('playerGroups', () => {
  it('lists each side under its name, members in seat order', () => {
    const groups = playerGroups(state(), 'me');
    expect(groups.map((g) => [g.team?.team_id, g.mine, g.players.map((p) => p.player_id)])).toEqual([
      ['team_1', true, ['me', 'pal']],
      ['team_2', false, ['x', 'y']],
    ]);
  });

  it('is one ungrouped list in a free-for-all game', () => {
    const s = state({ teams: undefined });
    expect(playerGroups(s, 'me')).toEqual([{ team: null, mine: false, players: s.players }]);
  });
});
