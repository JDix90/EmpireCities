/**
 * Accepting the bots' surrender (surrender_offers_enabled): when the bots
 * offer it, the games where they never do, and the ending it gives.
 */
import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { acceptSurrender, surrenderAllowed, surrenderOffered } from './surrender';

const ME = 'me';
const BOT_A = 'ai_1';
const BOT_B = 'ai_2';

/**
 * Twenty territories: `held` gives each seat its tiles and the units on each.
 * The line is 65%, 13 territories.
 */
function board(
  held: { me: [number, number]; a: [number, number]; b: [number, number] },
  opts: { turn?: number; phase?: GameState['phase']; current?: number } = {},
): GameState {
  const tiles: Array<[string, number]> = [
    ...Array.from({ length: held.me[0] }, (): [string, number] => [ME, held.me[1]]),
    ...Array.from({ length: held.a[0] }, (): [string, number] => [BOT_A, held.a[1]]),
    ...Array.from({ length: held.b[0] }, (): [string, number] => [BOT_B, held.b[1]]),
  ];
  const seat = (player_id: string, player_index: number, is_ai: boolean, territory_count: number) => ({
    player_id, player_index, username: player_id, color: '#000', is_ai,
    ...(is_ai ? { ai_difficulty: 'medium' } : {}),
    is_eliminated: false, territory_count, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000,
  });
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'm',
    phase: opts.phase ?? 'attack',
    turn_number: opts.turn ?? 20,
    current_player_index: opts.current ?? 0,
    players: [seat(ME, 0, false, held.me[0]), seat(BOT_A, 1, true, held.a[0]), seat(BOT_B, 2, true, held.b[0])],
    territories: Object.fromEntries(tiles.map(([owner, units], i) => [`t${i}`, { territory_id: `t${i}`, owner_id: owner, unit_count: units }])),
    settings: { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 65, max_turns: 60 },
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 0,
  } as unknown as GameState;
}

/** Twelve of the 13 territories the line needs, and ten times the bots' armies. */
const winning = (opts: Parameters<typeof board>[1] = {}) => board({ me: [12, 10], a: [4, 3], b: [4, 3] }, opts);

describe('when the bots offer their surrender', () => {
  it('offers it to a player close to winning who holds most of the armies', () => {
    expect(surrenderOffered(winning(), ME)).toBe(true);
  });

  it('offers it in every phase of the player\'s own turn, and only then', () => {
    for (const phase of ['draft', 'attack', 'fortify'] as const) {
      expect(surrenderOffered(winning({ phase }), ME), phase).toBe(true);
    }
    expect(surrenderOffered(winning({ current: 1 }), ME)).toBe(false);
    expect(surrenderOffered(winning({ phase: 'game_over' }), ME)).toBe(false);
  });

  it('never in the opening rounds', () => {
    expect(surrenderOffered(winning({ turn: 9 }), ME)).toBe(false);
  });

  it('not while the player is short of the way to winning', () => {
    // 8 of the 13 territories is 62%.
    expect(surrenderOffered(board({ me: [8, 30], a: [6, 1], b: [6, 1] }), ME)).toBe(false);
  });

  it('not while the bots still hold a third of the armies', () => {
    expect(surrenderOffered(board({ me: [12, 4], a: [4, 6], b: [4, 6] }), ME)).toBe(false);
  });

  it('not while a bot is halfway to winning', () => {
    // 7 of 13 is past halfway, whatever its armies.
    expect(surrenderOffered(board({ me: [12, 20], a: [7, 1], b: [1, 1] }), ME)).toBe(false);
  });

  it('never to a bot, or to a player who is away', () => {
    const bot = winning();
    bot.players[0]!.is_ai = true;
    expect(surrenderOffered(bot, ME)).toBe(false);
    const away = winning();
    away.players[0]!.is_away = true;
    expect(surrenderOffered(away, ME)).toBe(false);
  });
});

describe('games that never end by surrender', () => {
  it('daily challenges, campaign stages, tutorials and secret-mission games', () => {
    const daily = winning();
    daily.settings.daily_challenge_date = '2026-10-04';
    const campaign = winning();
    campaign.settings.is_campaign = true;
    const tutorial = winning();
    tutorial.settings.tutorial = true;
    const missions = winning();
    missions.settings.allowed_victory_conditions = ['secret_mission', 'domination'];
    for (const s of [daily, campaign, tutorial, missions]) {
      expect(surrenderAllowed(s)).toBe(false);
      expect(surrenderOffered(s, ME)).toBe(false);
    }
    expect(surrenderAllowed(winning())).toBe(true);
  });

  it('team games', () => {
    const s = winning();
    (s as unknown as { teams: unknown }).teams = [
      { team_id: 'a', player_ids: [ME] },
      { team_id: 'b', player_ids: [BOT_A, BOT_B] },
    ];
    expect(surrenderOffered(s, ME)).toBe(false);
  });

  it('a game with another player in it, even one already out', () => {
    const s = winning();
    s.players[2]!.is_ai = false;
    s.players[2]!.is_eliminated = true;
    expect(surrenderOffered(s, ME)).toBe(false);
  });
});

describe('accepting', () => {
  it('ends the game as a surrender, with the player as its winner', () => {
    const s = winning();
    expect(acceptSurrender(s, ME)).toBe(true);
    expect({ phase: s.phase, winner: s.winner_id, winners: s.winner_ids, condition: s.victory_condition })
      .toEqual({ phase: 'game_over', winner: ME, winners: [ME], condition: 'surrender' });
  });

  it('changes nothing when no surrender is on offer', () => {
    const s = winning({ turn: 5 });
    const before = structuredClone(s);
    expect(acceptSurrender(s, ME)).toBe(false);
    expect(s).toEqual(before);
  });
});
