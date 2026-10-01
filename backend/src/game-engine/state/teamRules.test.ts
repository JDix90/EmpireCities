/**
 * No friendly fire, enforced where the engine resolves each hostile act, so a
 * socket, the AI and the balance sim all obey one rule (state/teams.ts):
 *   • a land attack on an ally's ground, or on another side's during the
 *     opening ceasefire, resolves nothing;
 *   • a strike or the atom bomb cannot be aimed at an ally;
 *   • a Drop Assault cannot be declared on an ally, nor during the ceasefire;
 *   • an ally crosses the sealer's lane seal, and an ally's gateway makes a
 *     lane the side's corridor;
 *   • an event card that picks an opponent never picks an ally.
 * Each case holds nothing back in a free-for-all game.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, GameTeam, PlayerState, TerritoryState } from '../../types';
import { executeLandAttack } from '../combat/executeLandAttack';
import { executeTechAbility } from '../abilities/executeTechAbility';
import { isDropAssaultTarget } from '../abilities/dropAssault';
import { isLaneSealedForPlayer, laneStateFor, orbitLaneId } from './moonAccess';
import { applyEventEffect } from '../events/eventCardManager';

const TEAMS: GameTeam[] = [
  { team_id: 'team_1', name: 'Us', player_ids: ['p1', 'p2'] },
  { team_id: 'team_2', name: 'Them', player_ids: ['p3'] },
];

function terr(id: string, owner: string | null, units: number, extra: Partial<TerritoryState> = {}): TerritoryState {
  return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', world_id: 'earth', ...extra } as TerritoryState;
}

function player(id: string, index: number): PlayerState {
  return {
    player_id: id, player_index: index, username: id, cards: [], is_eliminated: false, territory_count: 1,
    unlocked_techs: [], ability_uses: {}, used_game_abilities: [],
  } as unknown as PlayerState;
}

function state(opts: { teams?: boolean; turn?: number } = {}): GameState {
  return {
    phase: 'attack',
    turn_number: opts.turn ?? 5,
    current_player_index: 0,
    starting_player_index: 0,
    players: [player('p1', 0), player('p2', 1), player('p3', 2)],
    territories: {
      home: terr('home', 'p1', 10),
      friend: terr('friend', 'p2', 2),
      foe: terr('foe', 'p3', 2),
    },
    settings: {},
    diplomacy: [],
    ...(opts.teams === false ? {} : { teams: TEAMS }),
  } as unknown as GameState;
}

const MAP = {
  territories: [],
  connections: [
    { from: 'home', to: 'friend', type: 'land' },
    { from: 'home', to: 'foe', type: 'land' },
  ],
  regions: [],
} as unknown as GameMap;

const sixes = () => 6;

describe('a land attack', () => {
  it("on an ally's ground resolves nothing", () => {
    const s = state();
    expect(executeLandAttack(s, 'p1', 'home', 'friend', { dieRoll: sixes })).toBeNull();
    expect(s.territories.friend!.unit_count).toBe(2);
    expect(s.territories.home!.unit_count).toBe(10);
  });

  it("on another side's ground waits out the opening ceasefire", () => {
    expect(executeLandAttack(state({ turn: 1 }), 'p1', 'home', 'foe', { dieRoll: sixes })).toBeNull();
    expect(executeLandAttack(state({ turn: 2 }), 'p1', 'home', 'foe', { dieRoll: sixes })).not.toBeNull();
  });

  it('resolves as ever in a free-for-all game', () => {
    expect(executeLandAttack(state({ teams: false }), 'p1', 'home', 'friend', { dieRoll: sixes })).not.toBeNull();
    expect(executeLandAttack(state({ teams: false, turn: 1 }), 'p1', 'home', 'foe', { dieRoll: sixes })).not.toBeNull();
  });
});

describe('a strike or the bomb', () => {
  const strike = (s: GameState, target: string) =>
    executeTechAbility({ state: s, map: MAP, playerId: 'p1', abilityId: 'cyber_attack', territoryId: target });
  const bomb = (s: GameState, target: string) =>
    executeTechAbility({ state: s, map: MAP, playerId: 'p1', abilityId: 'atom_bomb', territoryId: target });

  it("is refused on an ally's ground, and changes nothing", () => {
    const s = state();
    expect(strike(s, 'friend')).toMatchObject({ success: false, error: 'You cannot attack an ally' });
    expect(bomb(s, 'friend')).toMatchObject({ success: false, error: 'You cannot attack an ally' });
    expect(s.territories.friend).toMatchObject({ owner_id: 'p2', unit_count: 2 });
    expect(s.players[0]!.used_game_abilities).toEqual([]);
  });

  it('is refused on another side during the ceasefire, and lands after it', () => {
    expect(strike(state({ turn: 1 }), 'foe')).toMatchObject({ success: false, error: expect.stringMatching(/ceasefire/) });
    expect(strike(state(), 'foe')).toMatchObject({ success: true });
  });

  it('lands on anyone in a free-for-all game', () => {
    expect(strike(state({ teams: false }), 'friend')).toMatchObject({ success: true });
  });
});

describe('a Drop Assault', () => {
  it("is never declared on an ally, nor on another side during the ceasefire", () => {
    expect(isDropAssaultTarget(state(), 'p1', 'friend')).toBe(false);
    expect(isDropAssaultTarget(state({ turn: 1 }), 'p1', 'foe')).toBe(false);
    expect(isDropAssaultTarget(state(), 'p1', 'foe')).toBe(true);
    expect(isDropAssaultTarget(state({ teams: false }), 'p1', 'friend')).toBe(true);
  });
});

describe('lanes', () => {
  it("let the sealer's allies through its seal, and nobody else", () => {
    const s = state();
    s.lane_blockades = { [orbitLaneId('home', 'foe')]: { owner_id: 'p2', turns_remaining: 1, tick: 'owner_turn' } };
    expect(isLaneSealedForPlayer(s, 'home', 'foe', 'p1')).toBe(false);
    expect(isLaneSealedForPlayer(s, 'home', 'foe', 'p3')).toBe(true);
    expect(isLaneSealedForPlayer(state({ teams: false }), 'home', 'foe', 'p1')).toBe(false);
    const ffa = state({ teams: false });
    ffa.lane_blockades = s.lane_blockades;
    expect(isLaneSealedForPlayer(ffa, 'home', 'foe', 'p1')).toBe(true);
  });

  it("are the side's corridor when an ally holds the far end", () => {
    expect(laneStateFor(state(), 'home', 'friend', 'p1')).toBe('corridor');
    expect(laneStateFor(state(), 'home', 'foe', 'p1')).toBe('open');
    expect(laneStateFor(state({ teams: false }), 'home', 'friend', 'p1')).toBe('open');
  });
});

describe('an event card that picks an opponent', () => {
  it('picks an enemy, never an ally', () => {
    for (let i = 0; i < 20; i++) {
      const s = state();
      applyEventEffect(s, { type: 'enemy_units_removed', value: 1 } as never);
      expect(s.territories.friend!.unit_count).toBe(2);
      expect(s.territories.foe!.unit_count).toBe(1);
    }
  });

  it('forces a truce with an enemy, never an ally', () => {
    for (let i = 0; i < 20; i++) {
      const s = state();
      // Truces are the Diplomacy system; the card does nothing with it off.
      s.settings = { ...s.settings, diplomacy_enabled: true };
      s.diplomacy = [
        { player_index_a: 0, player_index_b: 1, status: 'neutral', truce_turns_remaining: 0 },
        { player_index_a: 0, player_index_b: 2, status: 'neutral', truce_turns_remaining: 0 },
      ];
      applyEventEffect(s, { type: 'truce', value: 2 } as never);
      expect(s.diplomacy[0]!.status).toBe('neutral');
      expect(s.diplomacy[1]!.status).toBe('truce');
    }
  });
});
