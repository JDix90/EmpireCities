/**
 * Playing to the ending (ai_ending_play_enabled): closeness to winning read
 * from the public endings, a bot racing its own line, and a rival close to
 * winning pressed by Medium and up, whoever sits in that seat.
 */
import { describe, it, expect } from 'vitest';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { computeAiTurn } from './aiBot';
import { aiPressExchangeCeiling } from './aiAttackGrind';
import { CAP_WINDOW, CHASER_TRUCE, endingAttackBonus, endingPlan, LEADER_ALERT, winStandings } from './aiEnding';
import { planAiTurn } from './runAiTurn';

const AI = 'ai_0';
const LEADER = 'leader';
const OTHER = 'other';

/**
 * Twenty territories in a ring. The bot holds `a0`…, the leader `l0`…, the
 * third player `o0`…; the bot's `a0` borders one tile of each rival.
 */
function map(): GameMap {
  const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);
  return {
    map_id: 'ring',
    name: 'Ring',
    territories: ids.map((id) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: 'r' })),
    connections: ids.map((id, i) => ({ from: id, to: ids[(i + 1) % ids.length]!, type: 'land' })),
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

/** `held` maps each player to how many tiles of the ring it holds, in ring order: bot, leader, other. */
function board(held: { ai: number; leader: number; other: number }, opts: { threshold?: number; maxTurns?: number; turn?: number } = {}): GameState {
  const owners = [
    ...Array<string>(held.ai).fill(AI),
    ...Array<string>(held.leader).fill(LEADER),
    ...Array<string>(held.other).fill(OTHER),
  ];
  const players = [
    { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, ai_difficulty: 'hard', is_eliminated: false, territory_count: held.ai, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    { player_id: LEADER, player_index: 1, username: 'L', color: '#fff', is_ai: false, is_eliminated: false, territory_count: held.leader, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    { player_id: OTHER, player_index: 2, username: 'O', color: '#888', is_ai: true, ai_difficulty: 'hard', is_eliminated: false, territory_count: held.other, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
  ];
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'ring',
    phase: 'attack',
    turn_number: opts.turn ?? 10,
    current_player_index: 0,
    players,
    territories: Object.fromEntries(owners.map((owner, i) => [`t${i}`, { territory_id: `t${i}`, owner_id: owner, unit_count: 3 }])),
    settings: {
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: opts.threshold ?? 65,
      max_turns: opts.maxTurns ?? 60,
    },
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 0,
  } as unknown as GameState;
}

const closeness = (s: GameState, id: string) => winStandings(s).find((x) => x.playerId === id)!.closeness;

describe('closeness to winning', () => {
  it('is territory held against the threshold', () => {
    // 65% of 20 is 13 territories.
    const s = board({ ai: 4, leader: 10, other: 6 });
    expect(closeness(s, LEADER)).toBeCloseTo(10 / 13);
    expect(closeness(s, AI)).toBeCloseTo(4 / 13);
  });

  it('is the whole board in a domination game', () => {
    const s = board({ ai: 4, leader: 10, other: 6 });
    s.settings.allowed_victory_conditions = ['domination'];
    expect(closeness(s, LEADER)).toBeCloseTo(10 / 20);
  });

  it('counts rival capitals held in a capital game', () => {
    const s = board({ ai: 4, leader: 10, other: 6 });
    s.settings.allowed_victory_conditions = ['capital'];
    s.players[0]!.capital_territory_id = 't0';
    s.players[1]!.capital_territory_id = 't4';
    s.players[2]!.capital_territory_id = 't14';
    // The leader holds its own capital and one of its two rivals'.
    s.territories.t0!.owner_id = LEADER;
    expect(closeness(s, LEADER)).toBeCloseTo(0.5);
  });

  it('is the tiebreak lead in the last rounds before the cap', () => {
    // Far from any line, but the cap is next round: the territory leader is about to win.
    const s = board({ ai: 6, leader: 7, other: 7 }, { maxTurns: 10, turn: 10 });
    s.territories.t19!.unit_count = 30;
    expect(closeness(s, OTHER)).toBeCloseTo(1);
    expect(closeness(s, LEADER)).toBeLessThan(1);
  });
});

describe('pressing the leader', () => {
  it('presses a rival past the alert line, harder at hard than at medium, never at easy', () => {
    const s = board({ ai: 4, leader: 12, other: 4 });
    expect(closeness(s, LEADER)).toBeGreaterThan(LEADER_ALERT);
    const at = (d: AiDifficulty) => endingPlan(s, AI, d);
    expect(at('hard').leaderId).toBe(LEADER);
    expect(at('hard').leaderBonus).toBeGreaterThan(at('medium').leaderBonus);
    expect(at('medium').leaderBonus).toBeGreaterThan(0);
    expect(at('easy').leaderId).toBeNull();
    expect(at('tutorial').leaderId).toBeNull();
  });

  it('leaves alone a rival short of the line, or not clearly ahead', () => {
    // 6 of 13 is short of the line; 8 of 13 against the bot's 7 is no clear lead.
    expect(endingPlan(board({ ai: 7, leader: 6, other: 7 }), AI, 'hard').leaderId).toBeNull();
    expect(endingPlan(board({ ai: 7, leader: 8, other: 5 }), AI, 'hard').leaderId).toBeNull();
  });

  it('presses a clear leader well before it nears the line', () => {
    // 8 of 13 is past the alert line and two clear of everyone else.
    expect(endingPlan(board({ ai: 6, leader: 8, other: 6 }), AI, 'hard').leaderId).toBe(LEADER);
  });

  it('never presses itself', () => {
    expect(endingPlan(board({ ai: 12, leader: 4, other: 4 }), AI, 'hard').leaderId).toBeNull();
  });

  it('is seat-blind: a human leader and a bot leader are pressed alike', () => {
    const human = board({ ai: 4, leader: 12, other: 4 });
    const bot = board({ ai: 4, leader: 12, other: 4 });
    bot.players[1]!.is_ai = true;
    bot.players[1]!.ai_difficulty = 'easy';
    expect(endingPlan(bot, AI, 'hard')).toEqual(endingPlan(human, AI, 'hard'));
  });

  it('ranks the leader\'s territories up and the other chasers\' down, without making any attack worth starting', () => {
    const s = board({ ai: 4, leader: 12, other: 4 });
    const plan = endingPlan(s, AI, 'hard');
    expect(endingAttackBonus(s, plan, 't4')).toEqual({ value: 0, rank: plan.leaderBonus });
    expect(endingAttackBonus(s, plan, 't19')).toEqual({ value: 0, rank: -CHASER_TRUCE * plan.leaderBonus });
  });

  it('never makes a hopeless attack on the leader worth starting', () => {
    // The leader's tile beside the bot holds twenty: no press lists it.
    const s = board({ ai: 4, leader: 12, other: 4 });
    s.territories.t4!.unit_count = 20;
    const attacks = computeAiTurn(structuredClone(s), map(), 'hard', { rng: () => 0.5, endingPlay: true, oddsPress: true })
      .filter((a) => a.type === 'attack' && a.from !== '__influence__');
    expect(attacks.map((a) => a.to)).not.toContain('t4');
  });

  it('turns the planner toward the leader', () => {
    // `t0`'s two rival neighbours hold the same three units: the leader's `t4`
    // side and the other's `t19` side. Make them the bot's only fronts.
    const s = board({ ai: 4, leader: 12, other: 4 });
    s.territories.t3!.unit_count = 12;
    s.territories.t0!.unit_count = 12;
    const first = (endingPlay: boolean) => computeAiTurn(structuredClone(s), map(), 'hard', { rng: () => 0.5, endingPlay })
      .find((a) => a.type === 'attack' && a.from !== '__influence__')!;
    expect(first(false).to).toBe('t19');
    expect(first(true).to).toBe('t4');
  });
});

describe('racing the ending', () => {
  it('races a few territories from its own line, from medium up', () => {
    const s = board({ ai: 11, leader: 5, other: 4 });
    expect(endingPlan(s, AI, 'medium').racing).toBe(true);
    expect(endingPlan(s, AI, 'medium').raceBonus).toBeGreaterThan(0);
    expect(endingPlan(s, AI, 'easy').racing).toBe(false);
  });

  it('does not race far from it', () => {
    expect(endingPlan(board({ ai: 5, leader: 8, other: 7 }), AI, 'hard').racing).toBe(false);
  });

  it(`races in the last ${CAP_WINDOW} rounds before the cap`, () => {
    const s = board({ ai: 6, leader: 7, other: 7 }, { maxTurns: 10, turn: 9 });
    expect(endingPlan(s, AI, 'hard').racing).toBe(true);
  });

  it('presses as in a decided game while racing', async () => {
    const s = board({ ai: 11, leader: 5, other: 4 });
    const flags = { captureOddsScoring: true, attackGrind: true, decidedGamePress: false, oddsPress: true };
    const hooks = { planningState: () => s, plan: async (st: GameState, m: GameMap, d: AiDifficulty) => computeAiTurn(st, m, d) };
    const racing = await planAiTurn(s, map(), s.players[0]!, 'hard', { ...flags, endingPlay: true }, hooks);
    const off = await planAiTurn(s, map(), s.players[0]!, 'hard', flags, hooks);
    expect(racing.attackBudget.left).toBe(aiPressExchangeCeiling('hard', true));
    expect(off.attackBudget.left).toBe(aiPressExchangeCeiling('hard', false));
  });

  it('never in a daily challenge or a campaign stage', async () => {
    const daily = board({ ai: 11, leader: 5, other: 4 });
    daily.settings.daily_challenge_date = '2026-10-04';
    const campaign = board({ ai: 11, leader: 5, other: 4 });
    campaign.settings.is_campaign = true;
    const flags = { captureOddsScoring: true, attackGrind: true, decidedGamePress: false, endingPlay: true };
    for (const s of [daily, campaign]) {
      const hooks = { planningState: () => s, plan: async (st: GameState, m: GameMap, d: AiDifficulty) => computeAiTurn(st, m, d) };
      const plan = await planAiTurn(s, map(), s.players[0]!, 'hard', flags, hooks);
      expect(plan.attackBudget.left).toBe(8);
    }
  });
});

describe('with the flag off', () => {
  it('plans exactly as before', () => {
    const s = board({ ai: 11, leader: 5, other: 4 });
    expect(computeAiTurn(structuredClone(s), map(), 'hard', { rng: () => 0.5 }))
      .toEqual(computeAiTurn(structuredClone(s), map(), 'hard', { rng: () => 0.5, endingPlay: false }));
  });
});
