/**
 * A beaten bot resigns (ai_resignation_enabled).
 *
 * Today a bot plays on to its last territory, so a game the player has won
 * still asks for every remnant to be hunted down. With the flag on, a bot
 * that is beaten resigns as its turn opens, through the same step as a
 * player's resignation (state/resignation.ts): its land turns neutral at half
 * strength, so nobody inherits it. When the last rival resigns, the game ends
 * as a resignation.
 *
 * Beaten, for three of its own turns running, means all of:
 *   - the opening is over (round 10 on);
 *   - it holds at most 5% of the territories;
 *   - a rival is at least 85% of the way to winning (ai/aiEnding.ts
 *     winStandings: territory against the line, capitals, the cap tiebreak);
 *   - that rival's armies are at least eight times everything this bot could
 *     field this turn: its units, its draft, and a card set it holds.
 * It reads the board, its own hand and the endings, never whether another
 * seat is human, and the authoritative board even under fog of war, as the
 * decided-game press does: it decides only whether to leave, never where to
 * attack. In 3,140 arena games it would have resigned 154 bots; 3 went on to
 * win, each in a game whose leader, many times their size, never closed it
 * out and lost it at the turn limit, as bot leaders do and players rarely
 * would. The hand and the leader's closeness matter: a bot down to one
 * territory still wins on an escalating card set while a leader stalls, and
 * reading land and armies alone resigned a future winner one time in nine.
 *
 * And only with an empty hand. Its cards go to whoever takes its last
 * territory, and a rival behind the leader may be hunting it for them to
 * catch up; a resignation would take them out of the game. Nearly every bot
 * that resigned without this rule held cards, so it leaves resignation rare:
 * with the odds press, planned reinforcements, the ending play and goals on,
 * 1 resignation in 1,500 arena games over Easy, Medium, Hard and Expert
 * tables and a Hard bot among Easy ones, against 23 without the rule.
 * A player who has the game won can be offered the bots' surrender instead
 * (surrender_offers_enabled, victory/surrender.ts).
 *
 * Never where a resignation would change what a player is playing for:
 *   - a daily challenge or a campaign stage, whose bots stay today's
 *     (aiProfiles.ts keepsTodaysBots);
 *   - a tutorial, whose bot is part of the lesson;
 *   - a team game, where it would abandon a teammate;
 *   - a game with secret missions: a mission to eliminate a seat fails for
 *     good when that seat resigns, and a bot may not read missions to know;
 *   - a human seat the AI covers while its player is away.
 */
import type { GameMap, GameState, PlayerState, VictoryConditionKey } from '../../types';
import { getCardSetBonus } from '../combat/combatResolver';
import { checkVictory, findRedeemableCardIds } from '../state/gameStateManager';
import { getAllowedVictoryConditions } from '../state/gameSettings';
import { resignSeat } from '../state/resignation';
import { isTeamGame } from '../state/teams';
import { winStandings } from './aiEnding';
import { aiProfile, keepsTodaysBots, type AiLevel } from './aiProfiles';

/** No bot is beaten before this round: the opening's swings are too large to call. */
export const BEATEN_FROM_ROUND = 10;
/** It holds at most this share of the territories… */
export const BEATEN_TERRITORY_SHARE = 0.05;
/** …a rival is at least this close to winning (aiEnding.ts winStandings)… */
export const BEATEN_LEADER_CLOSENESS = 0.85;
/** …with armies at least this many times what the bot could field this turn. */
export const BEATEN_ARMY_RATIO = 8;
/** Its own turns in a row that must open with it beaten before it resigns. */
export const BEATEN_TURNS = 3;

function armies(state: GameState, playerId: string): number {
  let units = 0;
  for (const t of Object.values(state.territories)) if (t.owner_id === playerId) units += t.unit_count;
  return units;
}

/**
 * Whether `playerId` is beaten as its turn opens: read then, its draft is
 * this turn's. One reading; the bot resigns after BEATEN_TURNS of them.
 */
export function isBeaten(state: GameState, playerId: string): boolean {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player || player.is_eliminated || state.turn_number < BEATEN_FROM_ROUND) return false;
  const total = Object.keys(state.territories).length;
  if (total === 0 || (player.territory_count ?? 0) > BEATEN_TERRITORY_SHARE * total) return false;

  const leader = winStandings(state)
    .filter((s) => s.playerId !== playerId)
    .sort((a, b) => b.closeness - a.closeness)[0];
  if (!leader || leader.closeness < BEATEN_LEADER_CLOSENESS) return false;

  // Everything it could field this turn: a set in hand is the comeback that
  // keeps a one-territory bot in a game.
  const draft = state.players[state.current_player_index]?.player_id === playerId ? state.draft_units_remaining ?? 0 : 0;
  const set = findRedeemableCardIds(player.cards ?? [])
    ? getCardSetBonus(state.card_set_redemption_count ?? 0, state.settings.card_set_bonus_cap)
    : 0;
  const mine = armies(state, playerId) + draft + set;
  return armies(state, leader.playerId) >= BEATEN_ARMY_RATIO * Math.max(1, mine);
}

/** Whether this game lets a bot resign at all. */
export function resignationAllowed(state: GameState): boolean {
  const settings = state.settings;
  if (keepsTodaysBots(settings) || settings.tutorial) return false;
  if (isTeamGame(state)) return false;
  return !getAllowedVictoryConditions(settings).includes('secret_mission');
}

/**
 * Read `player` as its turn opens, and resign it if it is a bot, its level
 * resigns, this game allows it, it has been beaten for BEATEN_TURNS of its
 * turns running, and its hand is empty. True when it resigned; the caller
 * announces it, checks the game's end (victoryAfterResignation) and hands
 * the turn on.
 */
export function resignIfBeaten(
  state: GameState,
  player: PlayerState,
  difficulty: AiLevel,
  enabled: boolean | undefined,
): boolean {
  if (!enabled || !player.is_ai || player.is_eliminated) return false;
  if (!aiProfile(difficulty).resignsWhenBeaten || !resignationAllowed(state)) return false;
  if (!isBeaten(state, player.player_id)) {
    delete player.beaten_turns;
    return false;
  }
  player.beaten_turns = (player.beaten_turns ?? 0) + 1;
  // Its cards go to whoever takes its last territory, and a resignation would
  // take them out of the game: a bot with a hand plays on, to be taken out.
  if (player.beaten_turns < BEATEN_TURNS || (player.cards?.length ?? 0) > 0) return false;
  resignSeat(state, player.player_id);
  return true;
}

/**
 * The game's end after a resignation, if it ended: a commander left standing
 * alone won by the resignation, as when a player resigns (gameSocket.ts
 * `game:resign`), not by eliminating everyone.
 */
export function victoryAfterResignation(
  state: GameState,
  map: GameMap,
): { winnerIds: string[]; condition: VictoryConditionKey } | null {
  const victory = checkVictory(state, map);
  if (!victory) return null;
  return { ...victory, condition: victory.condition === 'last_standing' ? 'resignation' : victory.condition };
}
