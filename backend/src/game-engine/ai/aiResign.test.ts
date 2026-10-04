/**
 * A beaten bot resigns (ai_resignation_enabled): when it counts as beaten, the
 * games and seats that never resign, and the resignation itself, which is a
 * player's resignation step for step.
 */
import { describe, it, expect } from 'vitest';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { resignSeat } from '../state/resignation';
import { isBeaten, resignationAllowed, resignIfBeaten, victoryAfterResignation } from './aiResign';

const BOT = 'ai_1';
const LEADER = 'leader';
const OTHER = 'ai_2';

/** Twenty territories in a ring. */
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

/**
 * `held` maps each seat to its tiles in ring order (bot, leader, other) and
 * the units on each of them. The leader is a human seat unless `leaderIsBot`.
 */
function board(
  held: { bot: [number, number]; leader: [number, number]; other?: [number, number] },
  opts: { turn?: number; leaderIsBot?: boolean } = {},
): GameState {
  const other = held.other ?? [0, 0];
  const tiles: Array<[string, number]> = [
    ...Array.from({ length: held.bot[0] }, (): [string, number] => [BOT, held.bot[1]]),
    ...Array.from({ length: held.leader[0] }, (): [string, number] => [LEADER, held.leader[1]]),
    ...Array.from({ length: other[0] }, (): [string, number] => [OTHER, other[1]]),
  ];
  const seat = (player_id: string, player_index: number, is_ai: boolean, territory_count: number) => ({
    player_id, player_index, username: player_id, color: '#000', is_ai,
    ...(is_ai ? { ai_difficulty: 'medium' as AiDifficulty } : {}),
    is_eliminated: territory_count === 0, territory_count, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000,
  });
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'ring',
    phase: 'draft',
    turn_number: opts.turn ?? 20,
    current_player_index: 0,
    players: [
      seat(BOT, 0, true, held.bot[0]),
      seat(LEADER, 1, !!opts.leaderIsBot, held.leader[0]),
      ...(held.other ? [seat(OTHER, 2, true, other[0])] : []),
    ],
    territories: Object.fromEntries(tiles.map(([owner, units], i) => [`t${i}`, { territory_id: `t${i}`, owner_id: owner, unit_count: units }])),
    settings: {
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
      max_turns: 60,
    },
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 0,
  } as unknown as GameState;
}

/** The bot holds one tile of two units; the leader the other nineteen, of ten each. */
const beaten = (opts: { turn?: number; leaderIsBot?: boolean } = {}) => board({ bot: [1, 2], leader: [19, 10] }, opts);

/** Its turn opening `turns` times in a row; true once it has resigned. */
function resignsWithin(s: GameState, turns: number, d: AiDifficulty = 'medium', enabled = true): boolean {
  for (let i = 0; i < turns; i++) if (resignIfBeaten(s, s.players[0]!, d, enabled)) return true;
  return false;
}

describe('when a bot is beaten', () => {
  it('is beaten with a sliver of the board, a rival close to winning and many times its armies', () => {
    expect(isBeaten(beaten(), BOT)).toBe(true);
  });

  it('is not beaten while it holds a real share', () => {
    expect(isBeaten(board({ bot: [6, 4], leader: [14, 6] }), BOT)).toBe(false);
  });

  it('is not beaten while its armies still count, however little land it holds', () => {
    expect(isBeaten(board({ bot: [1, 60], leader: [19, 6] }), BOT)).toBe(false);
  });

  it('counts the card set in its hand and its draft as armies', () => {
    const set = beaten();
    // The eleventh set pays 40.
    set.card_set_redemption_count = 10;
    set.players[0]!.cards = [
      { card_id: 'a', territory_id: 't0', symbol: 'infantry' },
      { card_id: 'b', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'c', territory_id: 't2', symbol: 'infantry' },
    ] as never;
    expect(isBeaten(set, BOT)).toBe(false);
    const draft = beaten();
    draft.draft_units_remaining = 30;
    expect(isBeaten(draft, BOT)).toBe(false);
  });

  it('is not beaten while no rival is close to winning', () => {
    // 10 of the 13 the line needs is short of the mark.
    expect(isBeaten(board({ bot: [1, 1], leader: [10, 30], other: [9, 1] }), BOT)).toBe(false);
  });

  it('is never beaten in the opening rounds', () => {
    expect(isBeaten(beaten({ turn: 2 }), BOT)).toBe(false);
  });

  it('is seat-blind: a human leader and a bot leader count alike', () => {
    expect(isBeaten(beaten({ leaderIsBot: true }), BOT)).toBe(isBeaten(beaten(), BOT));
  });
});

describe('resigning', () => {
  it('resigns at the third turn in a row that opens with it beaten', () => {
    const s = beaten();
    expect(resignsWithin(s, 2)).toBe(false);
    expect(s.players[0]!.beaten_turns).toBe(2);
    expect(resignsWithin(s, 1)).toBe(true);
  });

  it('starts counting again after a turn it is not beaten', () => {
    const s = beaten();
    resignsWithin(s, 2);
    s.draft_units_remaining = 30;
    expect(resignsWithin(s, 1)).toBe(false);
    expect(s.players[0]!.beaten_turns).toBeUndefined();
    s.draft_units_remaining = 0;
    expect(resignsWithin(s, 2)).toBe(false);
  });

  it('resigns as a player resigns: eliminated by nobody, its land neutral at half strength', () => {
    const s = beaten();
    expect(resignsWithin(s, 3)).toBe(true);
    const bot = s.players[0]!;
    expect(bot.is_eliminated).toBe(true);
    expect(bot.has_resigned).toBe(true);
    expect(bot.eliminated_by).toBeNull();
    expect(bot.territory_count).toBe(0);
    expect(s.territories.t0).toMatchObject({ owner_id: null, unit_count: 1 });

    const player = beaten();
    resignSeat(player, BOT);
    expect(player.territories).toEqual(s.territories);
    expect({ ...player.players[0], beaten_turns: 3 }).toEqual(bot);
  });

  it('ends the game as a resignation when the last rival resigns', () => {
    const s = beaten();
    resignsWithin(s, 3);
    expect(victoryAfterResignation(s, map())).toEqual({ winnerIds: [LEADER], condition: 'resignation' });
  });

  it('leaves the game going while other rivals remain', () => {
    const s = board({ bot: [1, 2], leader: [12, 10], other: [7, 8] });
    expect(resignsWithin(s, 3)).toBe(true);
    expect(victoryAfterResignation(s, map())).toBeNull();
  });
});

describe('never', () => {
  it('with the flag off', () => {
    const s = beaten();
    expect(resignsWithin(s, 5, 'medium', false)).toBe(false);
    expect(s.players[0]!.beaten_turns).toBeUndefined();
  });

  it('at the tutorial level', () => {
    expect(resignsWithin(beaten(), 5, 'tutorial')).toBe(false);
  });

  it('for a human seat the AI covers while its player is away', () => {
    const s = beaten();
    s.players[0]!.is_ai = false;
    s.players[0]!.is_away = true;
    expect(resignsWithin(s, 5)).toBe(false);
  });

  it('in a daily challenge, a tutorial, or a secret-mission game', () => {
    const daily = beaten();
    daily.settings.daily_challenge_date = '2026-10-04';
    const tutorial = beaten();
    tutorial.settings.tutorial = true;
    const missions = beaten();
    missions.settings.allowed_victory_conditions = ['secret_mission'];
    for (const s of [daily, tutorial, missions]) {
      expect(resignationAllowed(s)).toBe(false);
      expect(resignsWithin(s, 5)).toBe(false);
    }
    expect(resignationAllowed(beaten())).toBe(true);
  });

  it('in a team game', () => {
    const s = beaten();
    (s as unknown as { teams: unknown }).teams = [
      { team_id: 'a', player_ids: [BOT] },
      { team_id: 'b', player_ids: [LEADER] },
    ];
    expect(resignationAllowed(s)).toBe(false);
    expect(resignsWithin(s, 5)).toBe(false);
  });
});
