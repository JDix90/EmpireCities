/**
 * Play on after a win (`play_on_enabled`).
 *
 * A casual live game can be won well short of taking the whole board: a
 * Conquest threshold, a capital, a secret mission, Lane Sovereignty. The
 * winner may still want the board. When such a game ends with opponents
 * standing, the winner's Victory screen offers to ask the table to keep
 * playing for total domination. Everyone still in must say yes; bots always
 * do, so a game against bots alone continues at once.
 *
 * The win stands. It was recorded as the game ended (rating, XP, gold,
 * streaks, achievements), and the continuation is a new game, started from the
 * final board, that is unranked, pays nothing, stays off every player's record
 * (game-engine/tutorial/tutorialGames.ts `notPlayOnSql`) and ends only at
 * domination, or with nobody left to fight. It is never offered again.
 *
 * Not offered in ranked, daily, campaign, tutorial or async (turn-a-day)
 * games, nor in team games, whose sides win together.
 *
 * This file is the rules; sockets/playOnSocket.ts runs the vote and starts the
 * game.
 */
import type { GameState, PlayOnMarker, VictoryConditionKey } from '../../types';
import { isTeamGame } from '../state/teams';

/** How long after the game ends the winner can ask. */
export const PLAY_ON_OFFER_MS = 5 * 60_000;

/** How long the table has to answer. */
export const PLAY_ON_VOTE_MS = 60_000;

/**
 * Endings that leave nothing to play on for: the board is already taken,
 * nobody is left to fight, or the game was given up or abandoned.
 */
const SETTLED_ENDINGS: ReadonlySet<VictoryConditionKey> = new Set<VictoryConditionKey>([
  'domination',
  'last_standing',
  'humans_eliminated',
  'abandoned',
  'resignation',
  'surrender',
]);

/** Who may ask, and who would play on, as the game ended. */
export interface PlayOnOffer {
  /** Human winners: each may ask, once, for the table. */
  proposer_ids: string[];
  /** Humans still in, winners included: every one but the asker votes. */
  human_ids: string[];
  /** Bots still in. They always vote yes. */
  bot_ids: string[];
  /** Unix ms after which nobody can ask. */
  expires_at: number;
}

/**
 * The offer a finished game makes, or null when it makes none. `creditedIds`
 * are the players the result credited with the win; `isRanked` is the games
 * row's.
 */
export function playOnOffer(
  state: GameState,
  creditedIds: readonly string[],
  opts: { isRanked: boolean; now: number },
): PlayOnOffer | null {
  if (state.play_on) return null;
  const ending = state.victory_condition;
  if (!ending || SETTLED_ENDINGS.has(ending)) return null;
  if (opts.isRanked) return null;
  const s = state.settings;
  if (s.tutorial || s.is_campaign || s.daily_challenge_date || s.async_mode) return null;
  if (isTeamGame(state)) return null;

  const standing = state.players.filter((p) => !p.is_eliminated);
  const credited = new Set(creditedIds);
  if (!standing.some((p) => !credited.has(p.player_id))) return null;
  const proposerIds = standing.filter((p) => !p.is_ai && credited.has(p.player_id)).map((p) => p.player_id);
  if (proposerIds.length === 0) return null;

  return {
    proposer_ids: proposerIds,
    human_ids: standing.filter((p) => !p.is_ai).map((p) => p.player_id),
    bot_ids: standing.filter((p) => p.is_ai).map((p) => p.player_id),
    expires_at: opts.now + PLAY_ON_OFFER_MS,
  };
}

/** A vote in progress. */
export interface PlayOnVote {
  proposer_id: string;
  /** Each human voter (everyone still in but the asker): yes, no, or not yet. */
  votes: Record<string, boolean | null>;
  bot_ids: string[];
  /** Unix ms after which a vote still open has failed. */
  expires_at: number;
}

export type PlayOnOutcome = 'accepted' | 'declined' | 'expired';

/** Open the vote, or say why it cannot be opened. */
export function openPlayOnVote(
  offer: PlayOnOffer,
  proposerId: string,
  now: number,
): { ok: true; vote: PlayOnVote } | { ok: false; reason: 'not_winner' | 'too_late' } {
  if (!offer.proposer_ids.includes(proposerId)) return { ok: false, reason: 'not_winner' };
  if (now > offer.expires_at) return { ok: false, reason: 'too_late' };
  const votes: Record<string, boolean | null> = {};
  for (const id of offer.human_ids) {
    if (id !== proposerId) votes[id] = null;
  }
  return {
    ok: true,
    vote: { proposer_id: proposerId, votes, bot_ids: [...offer.bot_ids], expires_at: now + PLAY_ON_VOTE_MS },
  };
}

/**
 * Where a vote stands: one no ends it, every yes carries it, and one still
 * open past its time has failed.
 */
export function playOnVoteOutcome(vote: PlayOnVote, now: number): PlayOnOutcome | 'pending' {
  const answers = Object.values(vote.votes);
  if (answers.some((a) => a === false)) return 'declined';
  if (answers.every((a) => a === true)) return 'accepted';
  return now > vote.expires_at ? 'expired' : 'pending';
}

/**
 * Record a voter's answer. False when they have no vote, already answered, or
 * the time is up: the first answer is the one that counts.
 */
export function castPlayOnVote(vote: PlayOnVote, voterId: string, yes: boolean, now: number): boolean {
  if (!(voterId in vote.votes) || vote.votes[voterId] !== null) return false;
  if (now > vote.expires_at) return false;
  vote.votes[voterId] = yes;
  return true;
}

/**
 * The continuation's opening state: the final board under a new game id,
 * played for domination alone, with no round cap.
 *
 * It resumes the turn the win ended. A win reached mid-turn (the capture that
 * crossed the threshold) goes on in that turn's attack, or its draft while
 * units were still to place; a win judged as a turn began goes on with that
 * turn's draft. A bot's turn always starts from the draft, as everywhere.
 */
export function playOnState(final: GameState, newGameId: string, now: number): GameState {
  const ending = final.victory_condition;
  if (!ending) throw new Error('playOnState: the game has no recorded win');
  const state = structuredClone(final);
  const marker: PlayOnMarker = {
    of: final.game_id,
    won_by: [...(final.winner_ids ?? (final.winner_id ? [final.winner_id] : []))],
    won_with: ending,
    won_turn: final.turn_number,
    rematch_settings: {
      victory_type: final.settings.victory_type,
      allowed_victory_conditions: final.settings.allowed_victory_conditions,
      victory_threshold: final.settings.victory_threshold,
      max_turns: final.settings.max_turns,
    },
  };

  state.game_id = newGameId;
  state.play_on = marker;
  delete state.winner_id;
  delete state.winner_ids;
  delete state.victory_condition;
  state.settings = {
    ...state.settings,
    victory_type: 'domination',
    allowed_victory_conditions: ['domination'],
    victory_threshold: undefined,
    max_turns: null,
  };

  const current = state.players[state.current_player_index];
  state.phase = current?.is_ai || state.draft_units_remaining > 0 ? 'draft' : 'attack';
  state.turn_started_at = now;
  state.phase_deadline_at = null;
  state.game_started_at = now;
  return state;
}
