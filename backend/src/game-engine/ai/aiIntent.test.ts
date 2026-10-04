/**
 * A bot's goal across turns (ai_intents_enabled): which goal it picks, how
 * it keeps one, what it may read, and how the goal weighs its turn.
 */
import { describe, it, expect } from 'vitest';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { computeAiTurn } from './aiBot';
import { advancesIntent, chooseIntent, HIDDEN_UNITS, intentAttackBonus, type AiIntent } from './aiIntent';
import { AI_PROFILES } from './aiProfiles';
import { planAiTurn, type AiTurnFlags } from './runAiTurn';
import { redactPlayersForViewer, redactReplaySnapshot } from '../../sockets/clientStateRedaction';

const AI = 'ai_0';
const R1 = 'r1';
const R2 = 'r2';

/**
 *   w1 ─ w2 ─ w3 ─ e1 ─ e2      west (w1–w3, bonus 6), east (e1–e2, bonus 4),
 *        │                      south (s1–s3, bonus 4). With three seats a
 *        s1 ─ s2 ─ s3           region pays half its bonus: 3, 2 and 2.
 */
function map(): GameMap {
  const regions: Record<string, string> = {
    w1: 'west', w2: 'west', w3: 'west', e1: 'east', e2: 'east', s1: 'south', s2: 'south', s3: 'south',
  };
  return {
    map_id: 'intent',
    name: 'Intent',
    territories: Object.entries(regions).map(([id, region_id]) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id })),
    connections: [
      { from: 'w1', to: 'w2', type: 'land' },
      { from: 'w2', to: 'w3', type: 'land' },
      { from: 'w3', to: 'e1', type: 'land' },
      { from: 'e1', to: 'e2', type: 'land' },
      { from: 'w2', to: 's1', type: 'land' },
      { from: 's1', to: 's2', type: 'land' },
      { from: 's2', to: 's3', type: 'land' },
    ],
    regions: [
      { region_id: 'west', name: 'West', bonus: 6 },
      { region_id: 'east', name: 'East', bonus: 4 },
      { region_id: 'south', name: 'South', bonus: 4 },
    ],
  } as unknown as GameMap;
}

type Tile = 'w1' | 'w2' | 'w3' | 'e1' | 'e2' | 's1' | 's2' | 's3';

/**
 * Each tile's owner and units. By default the bot holds two of the west, and
 * each rival three tiles, so neither is nearly out.
 */
function board(
  tiles: Partial<Record<Tile, [string | null, number]>> = {},
  difficulty: AiDifficulty = 'hard',
): GameState {
  const all: Record<Tile, [string | null, number]> = {
    w1: [AI, 5], w2: [AI, 5], w3: [R1, 2], e1: [R1, 6], e2: [R1, 6], s1: [R2, 6], s2: [R2, 6], s3: [R2, 6],
    ...tiles,
  };
  const count = (id: string) => Object.values(all).filter(([o]) => o === id).length;
  const seat = (player_id: string, player_index: number, is_ai: boolean) => ({
    player_id, player_index, username: player_id, color: '#000', is_ai,
    ...(is_ai ? { ai_difficulty: difficulty } : {}),
    is_eliminated: count(player_id) === 0, territory_count: count(player_id),
    cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000,
  });
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'intent',
    phase: 'draft',
    turn_number: 7,
    current_player_index: 0,
    players: [seat(AI, 0, true), seat(R1, 1, true), seat(R2, 2, false)],
    territories: Object.fromEntries(Object.entries(all).map(([id, [owner_id, unit_count]]) => [
      id, { territory_id: id, owner_id, unit_count, region_id: map().territories.find((t) => t.territory_id === id)!.region_id },
    ])),
    settings: { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 65, max_turns: 60 },
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 3,
  } as unknown as GameState;
}

const pick = (s: GameState, difficulty: AiDifficulty = 'hard', previous?: AiIntent) =>
  chooseIntent(s, map(), AI, difficulty, previous);

describe('choosing a goal', () => {
  it('takes a region it has a foothold in, when what is left is cheap', () => {
    expect(pick(board())).toEqual({ kind: 'take_region', target: 'west', since: 7 });
  });

  it('breaks a rival\'s whole region in reach', () => {
    // The west is the bot's; the east is wholly the first rival's, one thin tile in reach.
    const s = board({ w3: [AI, 4], e1: [R1, 2] });
    expect(pick(s)).toMatchObject({ kind: 'break_region', target: 'east' });
  });

  it('hunts a rival down to its last tiles', () => {
    // The second rival holds only s2 and s3; knocking it out pays best.
    const s = board({ w3: [AI, 4], e1: [R1, 9], s1: [AI, 6], s2: [R2, 2], s3: [R2, 1] });
    expect(pick(s)).toMatchObject({ kind: 'hunt', target: R2 });
  });

  it('weighs a goal by what it pays against what it costs', () => {
    // The west's last tile is now a fortress; the south's whole garrison is thin.
    const s = board({ w3: [R1, 20], s1: [R2, 1], s2: [R2, 1] });
    expect(pick(s)).toMatchObject({ kind: 'break_region', target: 'south' });
  });

  it('counts a garrison it cannot see as a few units, not none', () => {
    // Under fog of war the west's last tile is hidden. Counted as a few units
    // the west costs 2 + 4 = 6 for 9 (1.5), less than breaking the south (2.25);
    // read as no units at all it would cost 2 and win.
    expect(HIDDEN_UNITS).toBe(3);
    const s = board({ w1: [R1, 1], w3: [R1, -1], s1: [R2, 1], s2: [R2, 1] });
    expect(pick(s)).toMatchObject({ kind: 'break_region', target: 'south' });
  });

  it('never reads a rival\'s hand', () => {
    const s = board({ w3: [AI, 4], e1: [R1, 9], s1: [AI, 6], s2: [R2, 2], s3: [R2, 1] });
    const before = pick(s);
    s.players[2]!.cards = Array.from({ length: 5 }, (_, i) => ({ card_id: `c${i}`, symbol: 'infantry' })) as never;
    expect(pick(s)).toEqual(before);
  });

  it('leaves a truce partner\'s ground alone', () => {
    const s = board();
    s.diplomacy = [{ player_index_a: 0, player_index_b: 1, status: 'truce', truce_turns_remaining: 2 }] as never;
    // The west's last tile is the partner's, so the west cannot be taken; the
    // south is the only goal left.
    expect(pick(s)).toMatchObject({ kind: 'break_region', target: 'south' });
  });

  it('has none at easy or in the tutorial, in a team game, or with nothing in reach', () => {
    expect(pick(board(), 'easy')).toBeNull();
    expect(pick(board(), 'tutorial')).toBeNull();
    const teams = board();
    (teams as unknown as { teams: unknown }).teams = [
      { team_id: 'a', player_ids: [AI] },
      { team_id: 'b', player_ids: [R1, R2] },
    ];
    expect(pick(teams)).toBeNull();
    // The bot holds every tile it could take, and borders no one.
    const alone = board({ w3: [AI, 3], e1: [AI, 3], e2: [AI, 3], s1: [AI, 3], s2: [AI, 3], s3: [AI, 3] });
    expect(pick(alone)).toBeNull();
  });
});

describe('keeping a goal', () => {
  it('keeps the goal it holds in a near tie, with the round it was chosen', () => {
    // Breaking the south scores 4.5 / 3 = 1.5; taking the west 9 / 7 = 1.29,
    // within the quarter the goal already held is lifted by.
    expect(AI_PROFILES.hard.intentStickiness).toBe(0.25);
    const s = board({ w3: [R1, 6], s1: [R2, 2], s2: [R2, 1] });
    expect(pick(s)).toMatchObject({ kind: 'break_region', target: 'south' });
    const held: AiIntent = { kind: 'take_region', target: 'west', since: 3 };
    expect(pick(s, 'hard', held)).toEqual(held);
  });

  it('drops it for a far better one: a tie-breaker, never a contract', () => {
    const s = board({ w3: [R1, 30] });
    const held: AiIntent = { kind: 'take_region', target: 'west', since: 2 };
    expect(pick(s, 'hard', held)).toEqual({ kind: 'break_region', target: 'south', since: 7 });
  });

  it('drops a goal met or out of reach', () => {
    const s = board({ w3: [AI, 4] });
    const held: AiIntent = { kind: 'take_region', target: 'west', since: 2 };
    expect(pick(s, 'hard', held)?.target).not.toBe('west');
  });
});

describe('what a goal weighs', () => {
  it('lifts captures that advance it, by the level\'s weight', () => {
    const s = board();
    const goal: AiIntent = { kind: 'take_region', target: 'west', since: 7 };
    expect(advancesIntent(s, map(), goal, 'w3')).toBe(true);
    expect(advancesIntent(s, map(), goal, 's1')).toBe(false);
    expect(intentAttackBonus(s, map(), goal, 'w3', 'hard')).toBe(AI_PROFILES.hard.intentBonus);
    expect(intentAttackBonus(s, map(), goal, 's1', 'hard')).toBe(0);
    expect(intentAttackBonus(s, map(), null, 'w3', 'hard')).toBe(0);
    const hunt: AiIntent = { kind: 'hunt', target: R2, since: 7 };
    expect(advancesIntent(s, map(), hunt, 's1')).toBe(true);
    expect(advancesIntent(s, map(), hunt, 'w3')).toBe(false);
  });

  it('turns the planner\'s first attack toward it', () => {
    // Without a goal the bot opens on the south's thinner tile; with the west
    // as its goal, on the west's last tile.
    const s = board({ w2: [AI, 9], w3: [R1, 3], s1: [R2, 2] });
    const first = (o: { intent?: AiIntent }) =>
      computeAiTurn(s, map(), 'hard', { rng: () => 0.5, ...o }).find((a) => a.type === 'attack')?.to;
    expect(first({})).toBe('s1');
    expect(first({ intent: { kind: 'take_region', target: 'west', since: 7 } })).toBe('w3');
  });

  it('stages the draft beside a region to take, not one to break', () => {
    // w2 faces the west's last tile and the south; w1 is behind it. Give the
    // bot a second front: the south's tile s1 is its own and faces s2.
    const s = board({ w2: [AI, 4], w3: [R1, 2], s1: [AI, 4], s2: [R2, 5] });
    const draft = (o: { intent?: AiIntent }) =>
      computeAiTurn(s, map(), 'hard', { rng: () => 0.5, ...o }).find((a) => a.type === 'draft')?.to;
    expect(draft({})).toBe('s1');
    expect(draft({ intent: { kind: 'take_region', target: 'west', since: 7 } })).toBe('w2');
    // Breaking a region weighs the attack on it, and nothing else.
    expect(draft({ intent: { kind: 'break_region', target: 'west', since: 7 } })).toBe('s1');
  });

  it('heads its fortify move for a goal to take or hunt', () => {
    // w2 is interior: w1, w3 and s1 are all the bot's. w3 faces the east and
    // is the nearest border; s1 faces the south.
    const s = board({ w1: [AI, 1], w2: [AI, 12], w3: [AI, 1], s1: [AI, 1], e1: [R1, 6], s2: [R2, 6] });
    const fortify = (o: { intent?: AiIntent }) =>
      computeAiTurn(s, map(), 'hard', { rng: () => 0.5, ...o }).find((a) => a.type === 'fortify');
    expect(fortify({})).toMatchObject({ from: 'w2', to: 'w3' });
    expect(fortify({ intent: { kind: 'hunt', target: R2, since: 7 } })).toMatchObject({ from: 'w2', to: 's1' });
    expect(fortify({ intent: { kind: 'take_region', target: 'south', since: 7 } })).toMatchObject({ from: 'w2', to: 's1' });
    expect(fortify({ intent: { kind: 'break_region', target: 'south', since: 7 } })).toMatchObject({ from: 'w2', to: 'w3' });
  });
});

describe('the turn', () => {
  const flags: AiTurnFlags = { captureOddsScoring: true, attackGrind: true, decidedGamePress: false };
  const hooksFor = (s: GameState, seen: Array<AiIntent | undefined>) => ({
    planningState: () => s,
    plan: async (st: GameState, m: GameMap, d: AiDifficulty, o: { intent?: AiIntent }) => {
      seen.push(o.intent);
      return computeAiTurn(st, m, d, { ...o, rng: () => 0.5 });
    },
  });

  it('chooses a goal as the turn opens, keeps it on the seat and plans with it', async () => {
    const s = board();
    const seen: Array<AiIntent | undefined> = [];
    await planAiTurn(s, map(), s.players[0]!, 'hard', { ...flags, intents: true }, hooksFor(s, seen));
    expect(s.players[0]!.ai_intent).toEqual({ kind: 'take_region', target: 'west', since: 7 });
    expect(seen).toEqual([s.players[0]!.ai_intent]);
  });

  it('writes nothing with the flag off', async () => {
    const s = board();
    const before = structuredClone(s);
    const seen: Array<AiIntent | undefined> = [];
    await planAiTurn(s, map(), s.players[0]!, 'hard', flags, hooksFor(s, seen));
    expect(s).toEqual(before);
    expect(seen).toEqual([undefined]);
  });

  it('never for a seat the AI covers while its player is away, a daily or a campaign stage', async () => {
    const away = board();
    away.players[0]!.is_ai = false;
    away.players[0]!.is_away = true;
    away.players[0]!.ai_intent = { kind: 'hunt', target: R2, since: 1 };
    await planAiTurn(away, map(), away.players[0]!, 'hard', { ...flags, intents: true }, hooksFor(away, []));
    expect(away.players[0]!.ai_intent).toBeUndefined();
    for (const setting of [{ daily_challenge_date: '2026-10-04' }, { is_campaign: true }]) {
      const s = board();
      Object.assign(s.settings, setting);
      await planAiTurn(s, map(), s.players[0]!, 'hard', { ...flags, intents: true }, hooksFor(s, []));
      expect(s.players[0]!.ai_intent).toBeUndefined();
    }
  });

  it('is never sent to a client, live or in a replay', () => {
    const s = board();
    s.players[0]!.ai_intent = { kind: 'take_region', target: 'west', since: 7 };
    for (const viewer of [R2, null]) {
      expect(redactPlayersForViewer(s.players, viewer, 'attack')[0]!.ai_intent).toBeUndefined();
    }
    expect(redactReplaySnapshot(s).players[0]!.ai_intent).toBeUndefined();
    expect(s.players[0]!.ai_intent).toBeDefined();
  });
});
