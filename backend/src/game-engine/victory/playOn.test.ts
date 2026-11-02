/**
 * Play on after a win (play_on_enabled): which finished games offer it, how
 * the vote is carried or lost, and the continuation's opening state.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { checkVictory } from '../state/gameStateManager';
import {
  PLAY_ON_OFFER_MS,
  PLAY_ON_VOTE_MS,
  castPlayOnVote,
  openPlayOnVote,
  playOnOffer,
  playOnState,
  playOnVoteOutcome,
  type PlayOnOffer,
} from './playOn';

const ME = 'me';
const FRIEND = 'friend';
const BOT = 'ai_2';
const NOW = 1_700_000_000_000;

/**
 * Twenty territories, the line at 65% (13). I have just taken my thirteenth;
 * a friend and a bot hold the rest.
 */
function wonGame(opts: {
  ending?: GameState['victory_condition'];
  settings?: Partial<GameState['settings']>;
  friendOut?: boolean;
  friendIsBot?: boolean;
  draftLeft?: number;
  current?: number;
  teams?: GameState['teams'];
} = {}): GameState {
  const owners = [
    ...Array.from({ length: 13 }, () => ME),
    ...Array.from({ length: 4 }, () => (opts.friendOut ? BOT : FRIEND)),
    ...Array.from({ length: 3 }, () => BOT),
  ];
  const seat = (player_id: string, player_index: number, is_ai: boolean, territory_count: number, is_eliminated = false) => ({
    player_id, player_index, username: player_id, color: '#000', is_ai, is_eliminated, territory_count,
    cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000,
  });
  return {
    game_id: 'won',
    era: 'ww2',
    map_id: 'm',
    phase: 'game_over',
    turn_number: 31,
    current_player_index: opts.current ?? 0,
    players: [
      seat(ME, 0, false, 13),
      seat(FRIEND, 1, opts.friendIsBot ?? false, opts.friendOut ? 0 : 4, opts.friendOut),
      seat(BOT, 2, true, opts.friendOut ? 7 : 3),
    ],
    territories: Object.fromEntries(owners.map((owner, i) => [`t${i}`, { territory_id: `t${i}`, owner_id: owner, unit_count: 3 }])),
    settings: {
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_type: 'domination',
      victory_threshold: 65,
      max_turns: 150,
      turn_timer_seconds: 90,
      ...opts.settings,
    },
    winner_id: ME,
    winner_ids: [ME],
    victory_condition: opts.ending ?? 'threshold',
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    card_set_redemption_count: 0,
    draft_units_remaining: opts.draftLeft ?? 0,
    turn_started_at: NOW - 60_000,
    phase_deadline_at: NOW + 30_000,
    game_started_at: NOW - 3_600_000,
    ...(opts.teams ? { teams: opts.teams } : {}),
  } as unknown as GameState;
}

const offerFor = (state: GameState, isRanked = false) => playOnOffer(state, state.winner_ids ?? [], { isRanked, now: NOW });

describe('which finished games offer to play on', () => {
  it('a casual win short of domination with opponents still standing', () => {
    expect(offerFor(wonGame())).toEqual({
      proposer_ids: [ME],
      human_ids: [ME, FRIEND],
      bot_ids: [BOT],
      expires_at: NOW + PLAY_ON_OFFER_MS,
    });
  });

  it('any win short of domination: a capital, a mission, Lane Sovereignty, the round cap', () => {
    for (const ending of ['capital', 'secret_mission', 'lane_sovereignty', 'lunar_hegemony', 'transcendence', 'turn_limit'] as const) {
      expect(offerFor(wonGame({ ending })), ending).not.toBeNull();
    }
  });

  it('not when the board is taken, nobody is left, or the game was given up', () => {
    for (const ending of ['domination', 'last_standing', 'humans_eliminated', 'abandoned', 'resignation', 'surrender'] as const) {
      expect(offerFor(wonGame({ ending })), ending).toBeNull();
    }
  });

  it('not in ranked, daily, campaign, tutorial or turn-a-day games', () => {
    expect(offerFor(wonGame(), true)).toBeNull();
    expect(offerFor(wonGame({ settings: { daily_challenge_date: '2026-11-02' } }))).toBeNull();
    expect(offerFor(wonGame({ settings: { is_campaign: true } }))).toBeNull();
    expect(offerFor(wonGame({ settings: { tutorial: true } }))).toBeNull();
    expect(offerFor(wonGame({ settings: { async_mode: true } }))).toBeNull();
  });

  it('not in a team game, whose sides win together', () => {
    expect(offerFor(wonGame({ teams: [{ team_id: 'a', player_ids: [ME, BOT] }, { team_id: 'b', player_ids: [FRIEND] }] as GameState['teams'] }))).toBeNull();
  });

  it('not from a continuation: it is played to its end', () => {
    const continued = playOnState(wonGame(), 'next', NOW);
    continued.phase = 'game_over';
    continued.victory_condition = 'threshold';
    continued.winner_ids = [ME];
    expect(offerFor(continued)).toBeNull();
  });

  it('not when every opponent is out, and never to a bot that won', () => {
    const allOut = wonGame();
    allOut.players[1].is_eliminated = true;
    allOut.players[2].is_eliminated = true;
    expect(offerFor(allOut)).toBeNull();
    const botWon = wonGame();
    expect(playOnOffer(botWon, [BOT], { isRanked: false, now: NOW })).toBeNull();
  });

  it('leaves out players already eliminated: they are not playing on', () => {
    expect(offerFor(wonGame({ friendOut: true }))).toMatchObject({ human_ids: [ME], bot_ids: [BOT] });
  });

  it('lets either ally of an alliance win ask, and the other vote', () => {
    const allied = wonGame({ ending: 'alliance_victory' });
    allied.winner_ids = [ME, FRIEND];
    const offer = playOnOffer(allied, [ME, FRIEND], { isRanked: false, now: NOW })!;
    expect(offer.proposer_ids).toEqual([ME, FRIEND]);
    const opened = openPlayOnVote(offer, FRIEND, NOW);
    expect(opened.ok && opened.vote.votes).toEqual({ [ME]: null });
  });
});

describe('the vote', () => {
  const offer: PlayOnOffer = { proposer_ids: [ME], human_ids: [ME, FRIEND, 'third'], bot_ids: [BOT], expires_at: NOW + PLAY_ON_OFFER_MS };

  it('asks everyone still in but the asker, and only a winner can ask, in time', () => {
    const opened = openPlayOnVote(offer, ME, NOW);
    expect(opened).toEqual({
      ok: true,
      vote: { proposer_id: ME, votes: { [FRIEND]: null, third: null }, bot_ids: [BOT], expires_at: NOW + PLAY_ON_VOTE_MS },
    });
    expect(openPlayOnVote(offer, FRIEND, NOW)).toEqual({ ok: false, reason: 'not_winner' });
    expect(openPlayOnVote(offer, ME, offer.expires_at + 1)).toEqual({ ok: false, reason: 'too_late' });
  });

  it('carries only when every human says yes', () => {
    const opened = openPlayOnVote(offer, ME, NOW);
    if (!opened.ok) throw new Error('vote did not open');
    const { vote } = opened;
    expect(castPlayOnVote(vote, FRIEND, true, NOW)).toBe(true);
    expect(playOnVoteOutcome(vote, NOW)).toBe('pending');
    expect(castPlayOnVote(vote, 'third', true, NOW)).toBe(true);
    expect(playOnVoteOutcome(vote, NOW)).toBe('accepted');
  });

  it('ends at the first no', () => {
    const opened = openPlayOnVote(offer, ME, NOW);
    if (!opened.ok) throw new Error('vote did not open');
    castPlayOnVote(opened.vote, 'third', false, NOW);
    expect(playOnVoteOutcome(opened.vote, NOW)).toBe('declined');
  });

  it('fails when the time runs out, and takes no answer after it', () => {
    const opened = openPlayOnVote(offer, ME, NOW);
    if (!opened.ok) throw new Error('vote did not open');
    castPlayOnVote(opened.vote, FRIEND, true, NOW);
    const late = opened.vote.expires_at + 1;
    expect(playOnVoteOutcome(opened.vote, late)).toBe('expired');
    expect(castPlayOnVote(opened.vote, 'third', true, late)).toBe(false);
  });

  it('counts a voter once, and nobody else', () => {
    const opened = openPlayOnVote(offer, ME, NOW);
    if (!opened.ok) throw new Error('vote did not open');
    expect(castPlayOnVote(opened.vote, FRIEND, true, NOW)).toBe(true);
    expect(castPlayOnVote(opened.vote, FRIEND, false, NOW)).toBe(false);
    expect(castPlayOnVote(opened.vote, ME, false, NOW)).toBe(false);
    expect(castPlayOnVote(opened.vote, 'stranger', false, NOW)).toBe(false);
    expect(opened.vote.votes[FRIEND]).toBe(true);
  });

  it('against bots alone there is nobody to ask, and it carries at once', () => {
    const solo = offerFor(wonGame({ friendIsBot: true }))!;
    const opened = openPlayOnVote(solo, ME, NOW);
    expect(opened.ok && playOnVoteOutcome(opened.vote, NOW)).toBe('accepted');
  });
});

describe('the continuation', () => {
  it('is the final board under a new id, for domination alone with no round cap', () => {
    const final = wonGame();
    const next = playOnState(final, 'next', NOW);
    expect(next.game_id).toBe('next');
    expect(next.territories).toEqual(final.territories);
    expect(next.players.map((p) => p.territory_count)).toEqual([13, 4, 3]);
    expect(next.turn_number).toBe(31);
    expect(next.settings).toMatchObject({
      allowed_victory_conditions: ['domination'],
      victory_type: 'domination',
      victory_threshold: undefined,
      max_turns: null,
      turn_timer_seconds: 90,
    });
    expect(next.winner_id).toBeUndefined();
    expect(next.winner_ids).toBeUndefined();
    expect(next.victory_condition).toBeUndefined();
    expect(next.play_on).toEqual({
      of: 'won',
      won_by: [ME],
      won_with: 'threshold',
      won_turn: 31,
      rematch_settings: {
        victory_type: 'domination',
        allowed_victory_conditions: ['domination', 'threshold'],
        victory_threshold: 65,
        max_turns: 150,
      },
    });
    expect(next.game_started_at).toBe(NOW);
    expect(next.turn_started_at).toBe(NOW);
    expect(next.phase_deadline_at).toBeNull();
  });

  it('leaves the finished game as it was', () => {
    const final = wonGame();
    const before = structuredClone(final);
    playOnState(final, 'next', NOW);
    expect(final).toEqual(before);
  });

  it('goes on with the turn the win ended: its attack, or its draft while units are left', () => {
    expect(playOnState(wonGame(), 'next', NOW).phase).toBe('attack');
    expect(playOnState(wonGame({ draftLeft: 5 }), 'next', NOW).phase).toBe('draft');
    expect(playOnState(wonGame({ current: 2 }), 'next', NOW).phase).toBe('draft');
  });

  it('is not won by the threshold that ended the first game, and is won by taking everything', () => {
    const map = {} as GameMap;
    const next = playOnState(wonGame(), 'next', NOW);
    expect(checkVictory(next, map)).toBeNull();
    for (const t of Object.values(next.territories)) t.owner_id = ME;
    next.players[0].territory_count = 20;
    next.players[1].territory_count = 0;
    next.players[2].territory_count = 0;
    next.players[1].is_eliminated = true;
    next.players[2].is_eliminated = true;
    expect(checkVictory(next, map)).toEqual({ winnerIds: [ME], condition: 'last_standing' });
    next.players[2].is_eliminated = false;
    expect(checkVictory(next, map)).toEqual({ winnerIds: [ME], condition: 'domination' });
  });

  it('never ends on the round cap', () => {
    const next = playOnState(wonGame(), 'next', NOW);
    next.turn_number = 500;
    expect(checkVictory(next, {} as GameMap)).toBeNull();
  });
});
