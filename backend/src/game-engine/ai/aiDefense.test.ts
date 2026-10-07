/**
 * A bot defends its ground (ai_defense_enabled): the chance each tile is lost
 * before its next turn (ai/aiThreat.ts), and the fortify moves that cut it
 * most (ai/aiFortify.ts), chosen at the fortify step on the board its attacks
 * left (ai/runAiTurn.ts).
 */
import { describe, it, expect } from 'vitest';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { computeAiTurn } from './aiBot';
import { planFortify } from './aiFortify';
import { ATTACK_LIKELIHOOD, buildThreatMap, lossChance } from './aiThreat';
import { headlessAiTurnHooks, planAiTurn, playAiTurn } from './runAiTurn';

const AI = 'ai_0';
const RIVAL = 'rival';
const THIRD = 'third';

type Tiles = Record<string, [owner: string, units: number]>;

function setup(tiles: Tiles, links: Array<[string, string]>, extra: Partial<GameState> = {}): { state: GameState; map: GameMap } {
  const ids = Object.keys(tiles);
  const map = {
    map_id: 'defence',
    name: 'Defence',
    territories: ids.map((id) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: 'r' })),
    connections: links.map(([from, to]) => ({ from, to, type: 'land' })),
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
  const player = (id: string, i: number) => ({
    player_id: id, player_index: i, username: id, color: '#000', is_ai: true, ai_difficulty: 'medium',
    is_eliminated: false, territory_count: ids.filter((t) => tiles[t]![0] === id).length,
    cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000,
  });
  const state = {
    game_id: 'g',
    era: 'ww2',
    map_id: 'defence',
    phase: 'fortify',
    turn_number: 5,
    current_player_index: 0,
    players: [player(AI, 0), player(RIVAL, 1), player(THIRD, 2)],
    territories: Object.fromEntries(ids.map((id) => [id, { territory_id: id, owner_id: tiles[id]![0], unit_count: tiles[id]![1] }])),
    settings: {},
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 0,
    ...extra,
  } as unknown as GameState;
  return { state, map };
}

describe('the chance a tile is lost before the bot\'s next turn', () => {
  it('is high for one unit beside a big stack, and nothing beside stacks that cannot attack', () => {
    const { state, map } = setup(
      { t: [AI, 1], big: [RIVAL, 10], q: [AI, 1], lone: [RIVAL, 1] },
      [['t', 'big'], ['q', 'lone'], ['t', 'q']],
    );
    const threats = buildThreatMap(state, map, AI, 'full');
    expect(lossChance(threats, 't', 1)).toBeGreaterThan(0.9 * ATTACK_LIKELIHOOD);
    expect(lossChance(threats, 'q', 1)).toBe(0);
    // More defenders, less risk.
    expect(lossChance(threats, 't', 10)).toBeLessThan(lossChance(threats, 't', 1));
  });

  it('counts every stack beside a tile in the full model, the strongest alone in the adjacent one', () => {
    const { state, map } = setup(
      { t: [AI, 4], r1: [RIVAL, 5], r2: [THIRD, 5] },
      [['t', 'r1'], ['t', 'r2']],
    );
    const adjacent = lossChance(buildThreatMap(state, map, AI, 'adjacent'), 't', 4);
    const full = lossChance(buildThreatMap(state, map, AI, 'full'), 't', 4);
    expect(full).toBeGreaterThan(adjacent);
  });

  it('adds a rival\'s reinforcements in the drafts model, even beside one unit of theirs', () => {
    const { state, map } = setup(
      { t: [AI, 3], lone: [RIVAL, 1], r2: [RIVAL, 1], r3: [RIVAL, 1], r4: [RIVAL, 1], r5: [RIVAL, 1], r6: [RIVAL, 1] },
      [['t', 'lone'], ['lone', 'r2'], ['r2', 'r3'], ['r3', 'r4'], ['r4', 'r5'], ['r5', 'r6']],
    );
    expect(lossChance(buildThreatMap(state, map, AI, 'full'), 't', 3)).toBe(0);
    expect(lossChance(buildThreatMap(state, map, AI, 'full_drafts'), 't', 3)).toBeGreaterThan(0.1);
  });

  it('leaves out an ally\'s stack and a truce partner\'s', () => {
    const allied = setup({ t: [AI, 1], big: [RIVAL, 10] }, [['t', 'big']], { teams: [{ team_id: 'side', player_ids: [AI, RIVAL] }] } as unknown as Partial<GameState>);
    expect(lossChance(buildThreatMap(allied.state, allied.map, AI, 'full'), 't', 1)).toBe(0);
    const truce = setup({ t: [AI, 1], big: [RIVAL, 10] }, [['t', 'big']], {
      diplomacy: [{ player_index_a: 0, player_index_b: 1, status: 'truce', truce_turns_remaining: 3 }],
      settings: { diplomacy_enabled: true },
    } as unknown as Partial<GameState>);
    expect(lossChance(buildThreatMap(truce.state, truce.map, AI, 'full'), 't', 1)).toBe(0);
  });

  it('counts a garrison fog hides as three, as the bot\'s targets do', () => {
    const { state, map } = setup({ t: [AI, 2], hidden: [RIVAL, -1] }, [['t', 'hidden']]);
    const seen = setup({ t: [AI, 2], hidden: [RIVAL, 3] }, [['t', 'hidden']]);
    expect(lossChance(buildThreatMap(state, map, AI, 'full'), 't', 2))
      .toBeCloseTo(lossChance(buildThreatMap(seen.state, seen.map, AI, 'full'), 't', 2));
  });
});

describe('planned fortify', () => {
  it('moves troops from a quiet tile to a threatened one', () => {
    const { state, map } = setup(
      { quiet: [AI, 9], threatened: [AI, 1], big: [RIVAL, 8], calm: [RIVAL, 1] },
      [['quiet', 'threatened'], ['threatened', 'big'], ['quiet', 'calm']],
    );
    const moves = planFortify(state, map, AI, 'medium', { moves: 1 });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: 'quiet', to: 'threatened' });
    expect(moves[0]!.units).toBeGreaterThan(1);
  });

  it('uses every move it has, one per threatened tile', () => {
    const { state, map } = setup(
      { home: [AI, 60], t1: [AI, 1], t2: [AI, 1], t3: [AI, 1], r1: [RIVAL, 5], r2: [RIVAL, 5], r3: [RIVAL, 5] },
      [['home', 't1'], ['home', 't2'], ['home', 't3'], ['t1', 'r1'], ['t2', 'r2'], ['t3', 'r3']],
    );
    const moves = planFortify(state, map, AI, 'medium', { moves: 3 });
    expect(moves.map((m) => m.to).sort()).toEqual(['t1', 't2', 't3']);
    expect(moves.every((m) => m.from === 'home')).toBe(true);
    expect(planFortify(state, map, AI, 'medium', { moves: 1 })).toHaveLength(1);
  });

  it('counts what a move costs its source: every move lowers the tiles it expects to lose', () => {
    const { state, map } = setup(
      { front: [AI, 6], other: [AI, 1], back: [AI, 3], big: [RIVAL, 7], small: [RIVAL, 2] },
      [['front', 'other'], ['front', 'big'], ['other', 'small'], ['back', 'front']],
    );
    const threats = buildThreatMap(state, map, AI, 'adjacent');
    const units = { front: 6, other: 1, back: 3 } as Record<string, number>;
    const expected = () => Object.entries(units).reduce((sum, [tid, n]) => sum + lossChance(threats, tid, n), 0);
    for (const m of planFortify(state, map, AI, 'medium', { moves: 3 })) {
      const before = expected();
      units[m.from]! -= m.units;
      units[m.to]! += m.units;
      expect(expected()).toBeLessThan(before);
    }
  });

  it('moves only where a player could, never across another\'s ground', () => {
    const { state, map } = setup(
      { home: [AI, 9], between: [RIVAL, 1], cut: [AI, 1], big: [RIVAL, 8] },
      [['home', 'between'], ['between', 'cut'], ['cut', 'big']],
    );
    expect(planFortify(state, map, AI, 'medium', { moves: 1 })).toEqual([]);
  });

  it('makes no move when nothing is at risk and it stages no attack', () => {
    const { state, map } = setup({ a: [AI, 5], b: [AI, 5], lone: [RIVAL, 1] }, [['a', 'b'], ['b', 'lone']]);
    expect(planFortify(state, map, AI, 'medium', { moves: 2 })).toEqual([]);
  });

  it('stages next turn\'s attack at Hard, which Medium does not', () => {
    const { state, map } = setup(
      { home: [AI, 10], front: [AI, 1], target: [RIVAL, 1], far: [RIVAL, 1] },
      [['home', 'front'], ['front', 'target'], ['target', 'far']],
    );
    expect(planFortify(state, map, AI, 'medium', { moves: 1 })).toEqual([]);
    const hard = planFortify(state, map, AI, 'hard', { moves: 1 });
    expect(hard).toEqual([{ from: 'home', to: 'front', units: 9 }]);
  });
});

describe('the bot turn with planned fortify', () => {
  const FLAGS = { captureOddsScoring: true, attackGrind: true, decidedGamePress: true, oddsPress: true, defense: true };

  async function fortifyStep(difficulty: AiDifficulty, flags: typeof FLAGS | Omit<typeof FLAGS, 'defense'>, extra: Partial<GameState> = {}) {
    const { state, map } = setup(
      { quiet: [AI, 9], threatened: [AI, 1], big: [RIVAL, 8], calm: [RIVAL, 1] },
      [['quiet', 'threatened'], ['threatened', 'big'], ['quiet', 'calm']],
      extra,
    );
    const player = state.players[0]!;
    // A plan made before the draft, moving the wrong way.
    const plan = await planAiTurn(state, map, player, difficulty, flags, {
      planningState: () => state,
      plan: async () => [{ type: 'fortify' as const, from: 'quiet', to: 'threatened', units: 1 }],
    });
    await playAiTurn(state, map, player, difficulty, plan, 'fortify', headlessAiTurnHooks(state, map));
    return { quiet: state.territories.quiet!.unit_count, threatened: state.territories.threatened!.unit_count, defense: !!plan.defense };
  }

  it('chooses the move at the fortify step, in place of the one planned before the draft', async () => {
    const after = await fortifyStep('medium', FLAGS);
    expect(after.defense).toBe(true);
    expect(after.threatened).toBeGreaterThan(2);
  });

  it('plays the planned move with the flag off, and at Easy', async () => {
    const { defense: _off, ...withoutDefense } = FLAGS;
    expect(await fortifyStep('medium', withoutDefense)).toEqual({ quiet: 8, threatened: 2, defense: false });
    expect(await fortifyStep('easy', FLAGS)).toEqual({ quiet: 8, threatened: 2, defense: false });
  });

  it('fires Armored Push when its extra move is worth making', async () => {
    const { state, map } = setup(
      { home: [AI, 40], t1: [AI, 1], t2: [AI, 1], r1: [RIVAL, 5], r2: [RIVAL, 5] },
      [['home', 't1'], ['home', 't2'], ['t1', 'r1'], ['t2', 'r2']],
      { era: 'modern', era_modifiers: eraModifiersFor('modern'), settings: { factions_enabled: true } } as Partial<GameState>,
    );
    const player = state.players[0]!;
    player.faction_id = 'eastern_bloc';
    const plan = await planAiTurn(state, map, player, 'medium', FLAGS, { planningState: () => state, plan: async () => [] });
    await playAiTurn(state, map, player, 'medium', plan, 'fortify', headlessAiTurnHooks(state, map));
    expect(player.ability_uses?.armored_push).toBe(1);
    expect(state.fortify_moves_used).toBe(2);
    expect(state.territories.t1!.unit_count).toBeGreaterThan(1);
    expect(state.territories.t2!.unit_count).toBeGreaterThan(1);
  });

  it('leaves daily challenges and campaign stages to today\'s bots', async () => {
    expect((await fortifyStep('medium', FLAGS, { settings: { is_campaign: true } } as Partial<GameState>)).defense).toBe(false);
    expect((await fortifyStep('medium', FLAGS, { settings: { daily_challenge_date: '2026-10-07' } } as Partial<GameState>)).defense).toBe(false);
  });

  it('plans nothing it does not need: the planner itself is unchanged', () => {
    const { state, map } = setup({ quiet: [AI, 9], threatened: [AI, 1], big: [RIVAL, 8] }, [['quiet', 'threatened'], ['threatened', 'big']]);
    expect(() => computeAiTurn(state, map, 'medium')).not.toThrow();
  });
});
