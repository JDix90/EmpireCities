/**
 * Phase 0 fixes in the bot turn: influence planned by the rules the turn
 * spends it by, and Unification Drive aimed rather than taken in key order.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { computeAiTurn, rankAiUnificationTargets } from './aiBot';
import { INFLUENCE_MAX_TARGET_UNITS, influencePayers } from './aiInfluence';
import { headlessAiTurnHooks, playAiTurn } from './runAiTurn';
import { eraModifiersFor } from '../state/eraModifiers';

const AI = 'ai_0';
const RIVAL = 'rival';

function map(territories: Array<[string, string]>, connections: Array<[string, string]>, regions: Array<[string, number]>): GameMap {
  return {
    map_id: 'fixture',
    name: 'Fixture',
    territories: territories.map(([id, region]) => ({
      territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: region,
    })),
    connections: connections.map(([from, to]) => ({ from, to, type: 'land' })),
    regions: regions.map(([region_id, bonus]) => ({ region_id, name: region_id, bonus })),
  } as unknown as GameMap;
}

function state(
  era: string,
  territories: Record<string, [string | null, number]>,
  extra: { settings?: Record<string, unknown>; faction?: string } = {},
): GameState {
  const owned = (pid: string) => Object.values(territories).filter(([o]) => o === pid).length;
  return {
    game_id: 'g',
    era,
    map_id: 'fixture',
    phase: 'attack',
    turn_number: 5,
    current_player_index: 0,
    players: [
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, ai_difficulty: 'hard', is_eliminated: false, territory_count: owned(AI), cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000, ...(extra.faction ? { faction_id: extra.faction } : {}) },
      { player_id: RIVAL, player_index: 1, username: 'R', color: '#fff', is_ai: true, ai_difficulty: 'hard', is_eliminated: false, territory_count: owned(RIVAL), cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: Object.fromEntries(Object.entries(territories).map(([id, [owner, units]]) => [
      id, { territory_id: id, owner_id: owner, unit_count: units },
    ])),
    settings: extra.settings ?? {},
    era_modifiers: eraModifiersFor(era as GameState['era']),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 0,
  } as unknown as GameState;
}

const influenceTarget = (s: GameState, m: GameMap): string | undefined =>
  computeAiTurn(s, m, 'hard', { rng: () => 0.5 }).find((a) => a.from === '__influence__')?.to;

describe('influence: the planner only picks what the turn can take', () => {
  // `a` (6 units) and `b` (1) are the bot's. `weak` is neutral but only `b`
  // touches it, and `b` has nothing to spare; `big` is neutral but holds four.
  // `x` is a rival's two-unit territory next to `a`; `y`, behind it, keeps the
  // rival in the game when `x` falls. The old planner chose a
  // neutral every time (neutral scored -10) and the turn refused both.
  const m = map(
    [['a', 'r'], ['b', 'r'], ['weak', 'r'], ['big', 'r'], ['x', 'r'], ['y', 'r']],
    [['a', 'b'], ['b', 'weak'], ['a', 'big'], ['a', 'x'], ['x', 'y']],
    [['r', 0]],
  );
  const board = () => state('coldwar', {
    a: [AI, 6], b: [AI, 1], weak: [null, 2], big: [null, INFLUENCE_MAX_TARGET_UNITS + 1], x: [RIVAL, 2], y: [RIVAL, 8],
  });

  it('skips a neutral its neighbours cannot pay for, and one with too many defenders', () => {
    const s = board();
    expect(influencePayers(s, m, AI, 'weak')).toBeNull();
    expect(influencePayers(s, m, AI, 'big')).toBeNull();
    expect(influencePayers(s, m, AI, 'x')).toEqual(['a']);
    expect(influenceTarget(s, m)).toBe('x');
  });

  it('still prefers a takeable neutral to a rival', () => {
    const s = board();
    s.territories.b!.unit_count = 5;
    expect(influenceTarget(s, m)).toBe('weak');
  });

  it('and the turn spends it on that target, paid by the neighbours', async () => {
    const s = board();
    const to = influenceTarget(s, m)!;
    const outcome = await playAiTurn(s, m, s.players[0]!, 'hard', {
      actions: [{ type: 'attack', from: '__influence__', to, units: 0 }],
      attackBudget: { left: 0 },
      attackGrind: true,
    }, 'attack', headlessAiTurnHooks(s, m));
    expect(outcome).toBe('done');
    expect(s.territories.x).toMatchObject({ owner_id: AI, unit_count: 1 });
    expect(s.territories.a!.unit_count).toBe(3);
    expect(s.influence_cooldown_remaining).toBe(3);
  });

  it('refuses a planned target it cannot take, without starting the cooldown', async () => {
    const s = board();
    await playAiTurn(s, m, s.players[0]!, 'hard', {
      actions: [{ type: 'attack', from: '__influence__', to: 'weak', units: 0 }],
      attackBudget: { left: 0 },
      attackGrind: true,
    }, 'attack', headlessAiTurnHooks(s, m));
    expect(s.territories.weak).toMatchObject({ owner_id: null, unit_count: 2 });
    expect(s.influence_cooldown_remaining ?? 0).toBe(0);
  });
});

describe('Unification Drive: the bot aims it', () => {
  // `n0` comes first in the board's key order: a lone tile in a big region,
  // next to six rival units. `n1` completes the bot's region.
  const m = map(
    [['n0', 'wide'], ['a', 'home'], ['n1', 'home'], ['w1', 'wide'], ['w2', 'wide'], ['x', 'wide']],
    [['a', 'n0'], ['a', 'n1'], ['n0', 'x'], ['w1', 'w2'], ['w2', 'x']],
    [['home', 2], ['wide', 5]],
  );
  const board = () => state('risorgimento', {
    n0: [null, 1], a: [AI, 5], n1: [null, 1], w1: [RIVAL, 1], w2: [RIVAL, 1], x: [RIVAL, 6],
  }, { settings: { factions_enabled: true }, faction: 'sardinia_piedmont' });

  it('ranks the tile that completes a region over the first one in key order', () => {
    expect(rankAiUnificationTargets(board(), m, AI)).toEqual(['n1', 'n0']);
  });

  it('and the turn unifies it', async () => {
    const s = board();
    await playAiTurn(s, m, s.players[0]!, 'hard', {
      actions: [],
      attackBudget: { left: 0 },
      attackGrind: true,
    }, 'attack', headlessAiTurnHooks(s, m));
    expect(s.territories.n1!.owner_id).toBe(AI);
    expect(s.territories.n0!.owner_id).toBeNull();
    expect(s.players[0]!.ability_uses).toMatchObject({ unification_drive: 1 });
  });
});
