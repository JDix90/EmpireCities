/**
 * Accepting the bots' surrender (surrender_offers_enabled).
 *
 * A player who has clearly won a game against bots still has to hunt down
 * every remnant before it ends. With the flag on, the bots offer their
 * surrender once the result is no longer in doubt, and the player may accept
 * it on their own turn: the game ends at once as a `surrender`, a win like
 * any other for ratings, XP and streaks.
 *
 * Offered, as the player's turn stands, when all of:
 *   - the opening is over (round 10 on);
 *   - the player is at least 70% of the way to winning (ai/aiEnding.ts
 *     winStandings: territory against the line, capitals, the cap tiebreak);
 *   - the player holds at least two thirds of every army on the board, twice
 *     all the bots' together;
 *   - no bot is even halfway to winning.
 * In 3,140 arena games, the seat this would first have offered surrender to
 * went on to win in all but one, with about nine rounds of play still ahead.
 * Under fog of war it reads the whole board too: the offer tells the player
 * only that the game is decided, never where a bot's armies stand.
 *
 * Only in a game of one player against bots, and never where ending it early
 * would change what a player is playing for:
 *   - a daily challenge or a campaign stage, whose bots and endings stay as
 *     they are (ai/aiProfiles.ts keepsTodaysBots);
 *   - a tutorial;
 *   - a team game;
 *   - a secret-mission game: a bot's mission is hidden, so nobody can know it
 *     is not about to complete.
 */
import type { GameState } from '../../types';
import { winStandings } from '../ai/aiEnding';
import { keepsTodaysBots } from '../ai/aiProfiles';
import { getAllowedVictoryConditions } from '../state/gameSettings';
import { isTeamGame } from '../state/teams';

/** No surrender is offered before this round. */
export const SURRENDER_FROM_ROUND = 10;
/** The player is at least this close to winning… */
export const SURRENDER_CLOSENESS = 0.7;
/** …holds at least this share of every army on the board… */
export const SURRENDER_ARMY_SHARE = 2 / 3;
/** …and no bot is closer to winning than this. */
export const SURRENDER_RIVAL_CLOSENESS = 0.5;

const PLAYING_PHASES = new Set(['draft', 'attack', 'fortify']);

/** Whether this game can end by surrender at all. */
export function surrenderAllowed(state: GameState): boolean {
  const settings = state.settings;
  if (keepsTodaysBots(settings) || settings.tutorial || isTeamGame(state)) return false;
  if (getAllowedVictoryConditions(settings).includes('secret_mission')) return false;
  // One player against bots: no other human seat, playing or not.
  return state.players.filter((p) => !p.is_ai).length === 1;
}

/** Whether the bots offer `playerId` their surrender now, on that player's turn. */
export function surrenderOffered(state: GameState, playerId: string): boolean {
  if (!PLAYING_PHASES.has(state.phase) || state.turn_number < SURRENDER_FROM_ROUND) return false;
  const player = state.players[state.current_player_index];
  if (!player || player.player_id !== playerId || player.is_ai || player.is_eliminated || player.is_away) return false;
  if (!surrenderAllowed(state)) return false;

  const standings = winStandings(state);
  const mine = standings.find((s) => s.playerId === playerId)?.closeness ?? 0;
  if (mine < SURRENDER_CLOSENESS) return false;
  if (standings.some((s) => s.playerId !== playerId && s.closeness > SURRENDER_RIVAL_CLOSENESS)) return false;

  let own = 0;
  let all = 0;
  const active = new Set(state.players.filter((p) => !p.is_eliminated).map((p) => p.player_id));
  for (const t of Object.values(state.territories)) {
    if (!t.owner_id || !active.has(t.owner_id)) continue;
    all += t.unit_count;
    if (t.owner_id === playerId) own += t.unit_count;
  }
  return all > 0 && own >= SURRENDER_ARMY_SHARE * all;
}

/**
 * End the game by the bots' surrender, if they offer it to `playerId`: the
 * player is credited with the win as a `surrender`. True when the game ended;
 * the caller finalizes it (gameSocket.ts finalizeGame).
 */
export function acceptSurrender(state: GameState, playerId: string): boolean {
  if (!surrenderOffered(state, playerId)) return false;
  state.phase = 'game_over';
  state.winner_id = playerId;
  state.winner_ids = [playerId];
  state.victory_condition = 'surrender';
  return true;
}
