/**
 * The siege posture of a daily build or research day.
 *
 * Measured before this existed: with the AI next door, every build and
 * research day in the library was solved on turn two or three with the bot
 * never touching the site, at any difficulty and any stack size. The budget
 * landed before combat could matter, and the shipped bot has no reason to
 * fight for a tile it is not winning the game by. On these days the bot now
 * has one: it besieges the human seat (aiBot `siege`) and presses as if the
 * game were decided, so the goal is reached under fire or not at all.
 *
 * Read by the socket's AI turn and by the daily simulator's, so the two can
 * never drift apart — the AI-parity rule.
 */
import type { GameState } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

export interface SiegePosture {
  /** The human seat the bot is besieging. */
  targetPlayerId: string;
}

/** The bot's siege target on a build or research day; undefined on every other game. */
export function dailySiegeTarget(state: GameState): SiegePosture | undefined {
  const spec = (state.settings as { daily_challenge_spec?: DailyPuzzleSpec }).daily_challenge_spec;
  if (!spec || (spec.archetype !== 'economy_build' && spec.archetype !== 'tech_research')) return undefined;
  const human = state.players.find((p) => !p.is_ai && !p.is_eliminated);
  return human ? { targetPlayerId: human.player_id } : undefined;
}
