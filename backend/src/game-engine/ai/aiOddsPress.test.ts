/**
 * Pressing on the odds (ai_odds_press_enabled): a bot starts an attack at its
 * level's start odds, counting what the capture is worth, rolls again while
 * its continue odds hold, and stops at the turn's ceiling. Each run of
 * exchanges reaches the table as one result, as a player's Blitz does.
 */
import { describe, it, expect } from 'vitest';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { computeAiTurn } from './aiBot';
import {
  aiAttackExchangeBudget,
  aiPressExchangeCeiling,
  shouldContinuePress,
  shouldStartPress,
} from './aiAttackGrind';
import { AI_PROFILES } from './aiProfiles';
import { edgeCaptureOdds } from './aiEdgeOdds';
import { headlessAiTurnHooks, planAiTurn, playAiTurn, type AiTurnHooks, type AiTurnPlan } from './runAiTurn';

const AI = 'ai_0';
const RIVAL = 'rival';

/** `a` touches the target `b`, the rival's second stack `c`, and the neutral `n`. */
function map(): GameMap {
  const ids = ['a', 'b', 'c', 'n', 'home'];
  return {
    map_id: 'press',
    name: 'Press',
    territories: ids.map((id) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: 'r' })),
    connections: [
      { from: 'a', to: 'b', type: 'land' },
      { from: 'a', to: 'c', type: 'land' },
      { from: 'a', to: 'n', type: 'land' },
      { from: 'c', to: 'home', type: 'land' },
    ],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function board(units: { a: number; b: number; c?: number; home?: number }, difficulty: AiDifficulty = 'medium'): GameState {
  const territories: Record<string, [string | null, number]> = {
    a: [AI, units.a],
    b: [RIVAL, units.b],
    c: [RIVAL, units.c ?? 1],
    n: [null, 1],
    home: [RIVAL, units.home ?? 1],
  };
  const owned = (pid: string) => Object.values(territories).filter(([o]) => o === pid).length;
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'press',
    phase: 'attack',
    turn_number: 5,
    current_player_index: 0,
    players: [
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, ai_difficulty: difficulty, is_eliminated: false, territory_count: owned(AI), cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: RIVAL, player_index: 1, username: 'R', color: '#fff', is_ai: false, is_eliminated: false, territory_count: owned(RIVAL), cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
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

const LEVELS: AiDifficulty[] = ['easy', 'medium', 'hard', 'expert'];

describe('when a bot starts an attack', () => {
  it('takes on a 20-against-3 fight at every level', () => {
    for (const d of LEVELS) expect(shouldStartPress(board({ a: 20, b: 3 }), map(), AI, 'a', 'b', d), d).toBe(true);
  });

  it('declines a 4-against-10 fight at every level', () => {
    for (const d of LEVELS) expect(shouldStartPress(board({ a: 4, b: 10 }), map(), AI, 'a', 'b', d), d).toBe(false);
  });

  it('asks more of easy than of expert', () => {
    // A fight between the two start odds: expert takes it, easy does not.
    const s = board({ a: 6, b: 4 });
    const odds = edgeCaptureOdds(s, map(), AI, 'a', 'b');
    expect(odds).toBeGreaterThanOrEqual(AI_PROFILES.expert.pressStartOdds);
    expect(odds).toBeLessThan(AI_PROFILES.easy.pressStartOdds);
    expect(shouldStartPress(s, map(), AI, 'a', 'b', 'expert')).toBe(true);
    expect(shouldStartPress(s, map(), AI, 'a', 'b', 'easy')).toBe(false);
  });

  it('counts what the capture is worth, a third of its planned value', () => {
    const s = board({ a: 6, b: 4 });
    const odds = edgeCaptureOdds(s, map(), AI, 'a', 'b');
    const short = 3 * (AI_PROFILES.easy.pressStartOdds - odds);
    expect(shouldStartPress(s, map(), AI, 'a', 'b', 'easy', short + 0.01)).toBe(true);
    expect(shouldStartPress(s, map(), AI, 'a', 'b', 'easy', short - 0.01)).toBe(false);
  });

  it('never starts from a stack that cannot attack, whatever the prize', () => {
    expect(shouldStartPress(board({ a: 1, b: 1 }), map(), AI, 'a', 'b', 'expert', 10)).toBe(false);
  });
});

describe('when a bot rolls again', () => {
  it('stops once the target has fallen', () => {
    const s = board({ a: 10, b: 1 });
    s.territories.b!.owner_id = AI;
    expect(shouldContinuePress(s, map(), AI, 'a', 'b', 5, 'medium')).toBe('captured');
  });

  it('stops at the ceiling', () => {
    expect(shouldContinuePress(board({ a: 20, b: 3 }), map(), AI, 'a', 'b', 0, 'medium')).toBe('budget_spent');
  });

  it('stops when the odds have turned', () => {
    expect(shouldContinuePress(board({ a: 4, b: 6 }), map(), AI, 'a', 'b', 5, 'medium')).toBe('odds_turned');
  });

  it('rolls on its odds alone', () => {
    // Medium continues at 0.5: 9 against 5 is past it, 5 against 5 is not.
    expect(shouldContinuePress(board({ a: 9, b: 5 }), map(), AI, 'a', 'b', 5, 'medium')).toBe('ok');
    expect(shouldContinuePress(board({ a: 5, b: 5 }), map(), AI, 'a', 'b', 5, 'medium')).toBe('odds_turned');
  });

  it('keeps going where the material-edge floor gave up', () => {
    // 6 against 5 is still a fight hard expects to win; the grind's floor
    // (attackers must outnumber defenders) would roll on, and at 5 against 5
    // it would stop where the odds still favour hard.
    const s = board({ a: 7, b: 5 });
    expect(shouldContinuePress(s, map(), AI, 'a', 'b', 5, 'hard')).toBe('ok');
  });
});

describe('the turn ceiling', () => {
  it('is the profile value, doubled by the decided-game press', () => {
    expect(LEVELS.map((d) => aiPressExchangeCeiling(d, false))).toEqual([3, 12, 40, 40]);
    expect(aiPressExchangeCeiling('medium', true)).toBe(24);
  });
});

/** Hooks that record the events, pauses and combat records a turn produces. */
function recordingHooks(state: GameState, m: GameMap) {
  const base = headlessAiTurnHooks(state, m);
  const events: Array<{ event: string; payload: unknown }> = [];
  const records: unknown[] = [];
  let delays = 0;
  const hooks: AiTurnHooks = {
    ...base,
    delay: async () => { delays += 1; },
    emit: (event, payload) => { events.push({ event, payload }); },
    recordCombat: (_defender, result) => { records.push(result); },
  };
  return { hooks, events, records, delays: () => delays };
}

function attackPlan(difficulty: AiDifficulty, oddsPress: boolean, to = 'b'): AiTurnPlan {
  return {
    actions: [{ type: 'attack', from: 'a', to, units: 3 }],
    attackBudget: { left: oddsPress ? aiPressExchangeCeiling(difficulty, false) : aiAttackExchangeBudget(difficulty, false) },
    attackGrind: true,
    ...(oddsPress ? { oddsPress: true } : {}),
  };
}

type CombatPayload = { result: { blitz_exchanges?: number; blitz_rolls?: unknown[]; attacker_losses: number; defender_losses: number } };

describe('a run of exchanges at the table', () => {
  it('is one combat result, one record and one pause', async () => {
    // Six defenders take at least three exchanges: one exchange kills at most two.
    const s = board({ a: 30, b: 6 });
    const m = map();
    const { hooks, events, records, delays } = recordingHooks(s, m);
    await playAiTurn(s, m, s.players[0]!, 'medium', attackPlan('medium', true), 'attack', hooks);
    const results = events.filter((e) => e.event === 'game:combat_result');
    expect(results).toHaveLength(1);
    const { result } = results[0]!.payload as CombatPayload;
    expect(result.blitz_exchanges).toBeGreaterThanOrEqual(3);
    expect(result.blitz_rolls).toHaveLength(result.blitz_exchanges!);
    expect(records).toEqual([result]);
    // The attack pauses once, not once per exchange.
    const idle = board({ a: 30, b: 6 });
    const quiet = recordingHooks(idle, m);
    await playAiTurn(idle, m, idle.players[0]!, 'medium', { ...attackPlan('medium', true), actions: [] }, 'attack', quiet.hooks);
    expect(delays() - quiet.delays()).toBe(1);
  });

  it('was one result per exchange before', async () => {
    const s = board({ a: 30, b: 6 });
    const m = map();
    const { hooks, events } = recordingHooks(s, m);
    await playAiTurn(s, m, s.players[0]!, 'medium', attackPlan('medium', false), 'attack', hooks);
    const results = events.filter((e) => e.event === 'game:combat_result');
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) expect((r.payload as CombatPayload).result.blitz_exchanges).toBeUndefined();
  });

  it('skips an attack the odds no longer favour, without a pause', async () => {
    const m = map();
    const idle = board({ a: 4, b: 10 });
    const quiet = recordingHooks(idle, m);
    await playAiTurn(idle, m, idle.players[0]!, 'medium', { ...attackPlan('medium', true), actions: [] }, 'attack', quiet.hooks);
    const s = board({ a: 4, b: 10 });
    const r = recordingHooks(s, m);
    await playAiTurn(s, m, s.players[0]!, 'medium', attackPlan('medium', true), 'attack', r.hooks);
    expect(r.events).toHaveLength(0);
    expect(r.delays()).toBe(quiet.delays());
    expect(s.territories.a!.unit_count).toBe(4);
  });

  it('announces an elimination before the result that caused it, and ends a won game', async () => {
    // `b` is the rival's last territory.
    const s = board({ a: 30, b: 2 });
    s.territories.c!.owner_id = AI;
    s.territories.home!.owner_id = AI;
    s.players[1]!.territory_count = 1;
    const m = map();
    const { hooks, events } = recordingHooks(s, m);
    const outcome = await playAiTurn(s, m, s.players[0]!, 'medium', attackPlan('medium', true), 'attack', hooks);
    expect(outcome).toBe('over');
    expect(events.map((e) => e.event)).toEqual(['game:player_eliminated', 'game:combat_result']);
    expect(s.phase).toBe('game_over');
  });
});

describe('the plan', () => {
  const FLAGS = { captureOddsScoring: true, attackGrind: true, decidedGamePress: false, oddsPress: true };
  const planHooks = (s: GameState) => ({
    planningState: () => s,
    plan: async (st: GameState, m: GameMap, d: Parameters<typeof computeAiTurn>[2], o: Parameters<typeof computeAiTurn>[3]) => computeAiTurn(st, m, d, { ...o, rng: () => 0.5 }),
  });

  it("carries the level's ceiling as its budget", async () => {
    const s = board({ a: 20, b: 3 });
    const plan = await planAiTurn(s, map(), s.players[0]!, 'hard', FLAGS, planHooks(s));
    expect(plan.oddsPress).toBe(true);
    expect(plan.attackBudget.left).toBe(40);
  });

  it('keeps the fixed budget in a daily challenge and a campaign stage', async () => {
    const daily = board({ a: 20, b: 3 });
    daily.settings.daily_challenge_date = '2026-10-04';
    const campaign = board({ a: 20, b: 3 });
    campaign.settings.is_campaign = true;
    for (const s of [daily, campaign]) {
      const plan = await planAiTurn(s, map(), s.players[0]!, 'hard', FLAGS, planHooks(s));
      expect(plan.oddsPress).toBeUndefined();
      expect(plan.attackBudget.left).toBe(aiAttackExchangeBudget('hard', false));
    }
  });

  it('is unchanged with the flag off', async () => {
    const s = board({ a: 20, b: 3 });
    const off = await planAiTurn(s, map(), s.players[0]!, 'hard', { ...FLAGS, oddsPress: false }, planHooks(s));
    expect(off.oddsPress).toBeUndefined();
    expect(off.attackBudget.left).toBe(aiAttackExchangeBudget('hard', false));
  });

  it("drops easy's long shots and anything below the start odds", () => {
    // 3 against 10 is a long shot easy plans today; pressing on the odds it does not.
    const s = board({ a: 3, b: 10, c: 10 }, 'easy');
    s.territories.n!.owner_id = RIVAL;
    s.territories.n!.unit_count = 10;
    const attacks = (oddsPress: boolean) => computeAiTurn(s, map(), 'easy', { rng: () => 0.5, oddsPress })
      .filter((a) => a.type === 'attack' && a.from !== '__influence__');
    expect(attacks(false).length).toBeGreaterThan(0);
    expect(attacks(true)).toEqual([]);
  });

  it('still plans the fights it will start', () => {
    const s = board({ a: 20, b: 3 }, 'medium');
    const attacks = computeAiTurn(s, map(), 'medium', { rng: () => 0.5, oddsPress: true })
      .filter((a) => a.type === 'attack' && a.from !== '__influence__');
    expect(attacks.map((a) => a.to)).toContain('b');
  });

  it('reads no profile value with the flag off', () => {
    // A profile whose press settings would refuse everything plans as today.
    const s = board({ a: 20, b: 3 }, 'medium');
    const strict = { ...AI_PROFILES.medium, pressStartOdds: 1.1 };
    const plan = (level: typeof strict | 'medium') => computeAiTurn(structuredClone(s), map(), level, { rng: () => 0.5 });
    expect(plan(strict)).toEqual(plan('medium'));
  });
});
