/**
 * The odds a player sees on each attack target (combat_explain_enabled):
 * the bots' exact edge odds, for legal pairs only, and none for a target fog
 * hides.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { edgeCaptureOdds } from '../ai/aiEdgeOdds';
import { attackOddsFor, sanitizeOddsPairs, MAX_ODDS_PAIRS } from './attackOdds';

const ME = 'me';
const RIVAL = 'rival';

/** `a` borders the rival's `b` and `c`; `far` borders nothing of mine. */
function map(): GameMap {
  const ids = ['a', 'b', 'c', 'mine', 'far'];
  return {
    map_id: 'odds',
    name: 'Odds',
    territories: ids.map((id) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: 'r' })),
    connections: [
      { from: 'a', to: 'b', type: 'land' },
      { from: 'a', to: 'c', type: 'land' },
      { from: 'a', to: 'mine', type: 'land' },
      { from: 'c', to: 'far', type: 'land' },
    ],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function board(a = 6): GameState {
  const territories: Record<string, [string | null, number]> = {
    a: [ME, a],
    b: [RIVAL, 2],
    c: [RIVAL, 9],
    mine: [ME, 3],
    far: [RIVAL, 1],
  };
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'odds',
    phase: 'attack',
    turn_number: 3,
    current_player_index: 0,
    players: [
      { player_id: ME, player_index: 0, username: 'Me', color: '#3498db', is_ai: false, is_eliminated: false, territory_count: 2, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: RIVAL, player_index: 1, username: 'R', color: '#e74c3c', is_ai: true, is_eliminated: false, territory_count: 3, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: Object.fromEntries(Object.entries(territories).map(([id, [owner, n]]) => [
      id, { territory_id: id, owner_id: owner, unit_count: n },
    ])),
    settings: {},
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 0,
  } as unknown as GameState;
}

describe('attack odds for the player choosing a target', () => {
  it('prices each legal target with the exact edge odds, the weak garrison above the strong one', () => {
    const state = board();
    const odds = attackOddsFor(state, map(), ME, [{ fromId: 'a', toId: 'b' }, { fromId: 'a', toId: 'c' }], null);
    expect(odds.map((o) => o.toId)).toEqual(['b', 'c']);
    const [b, c] = odds;
    expect(b.p).toBeCloseTo(edgeCaptureOdds(state, map(), ME, 'a', 'b'), 3);
    expect(c.p).toBeCloseTo(edgeCaptureOdds(state, map(), ME, 'a', 'c'), 3);
    expect(b.p).toBeGreaterThan(0.8);
    expect(c.p).toBeLessThan(0.2);
  });

  it('drops pairs that are not an attack: not my source, my own target, not adjacent, a thin stack', () => {
    const odds = attackOddsFor(board(), map(), ME, [
      { fromId: 'b', toId: 'a' }, // the rival's source
      { fromId: 'a', toId: 'mine' }, // my own ground
      { fromId: 'a', toId: 'far' }, // not a neighbour
      { fromId: 'nowhere', toId: 'b' },
    ], null);
    expect(odds).toEqual([]);
    expect(attackOddsFor(board(1), map(), ME, [{ fromId: 'a', toId: 'b' }], null)).toEqual([]);
  });

  it('gives no odds for a target fog hides, which would leak its garrison', () => {
    const odds = attackOddsFor(board(), map(), ME, [{ fromId: 'a', toId: 'b' }, { fromId: 'a', toId: 'c' }], new Set(['a', 'mine', 'b']));
    expect(odds.map((o) => o.toId)).toEqual(['b']);
  });
});

describe('the pairs a client asks about', () => {
  it('keeps well-formed, distinct pairs and drops the rest', () => {
    expect(sanitizeOddsPairs(undefined)).toEqual([]);
    expect(sanitizeOddsPairs('a>b')).toEqual([]);
    expect(sanitizeOddsPairs([
      { fromId: 'a', toId: 'b' },
      { fromId: 'a', toId: 'b' },
      { fromId: 'a' },
      { fromId: 1, toId: 'b' },
      null,
      { fromId: 'a', toId: 'x'.repeat(200) },
      { fromId: 'a', toId: 'c' },
    ])).toEqual([{ fromId: 'a', toId: 'b' }, { fromId: 'a', toId: 'c' }]);
  });

  it('caps how many it will price at once', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ fromId: 'a', toId: `t${i}` }));
    expect(sanitizeOddsPairs(many)).toHaveLength(MAX_ODDS_PAIRS);
  });
});
