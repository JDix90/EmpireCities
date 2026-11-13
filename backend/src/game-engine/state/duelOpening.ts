import type { GameState } from '../../types';

/**
 * Two-player opening balance (`duel_opening_enabled`, baked at create).
 *
 * In a two-player game whoever moves first won about 71% of Medium-bot games
 * (64% Easy, 65% Hard; the product review's section 6.2): they reinforce and
 * attack a board still standing on its 3-unit starting garrisons before the
 * other player has placed a unit. Each player holds half the board, so an
 * opening turn is normally 5 to 7 units plus region bonuses, not the 3 a
 * bigger game gives.
 *
 * The fix takes the first strike's teeth rather than handing out a visible
 * gift: the first mover's opening turn places at most 3 units, the game's
 * usual minimum (4 on Modern, below), and the second mover's first turn places
 * 1 more than usual.
 * In 2,400-game runs per setting on the six Quick Match maps, the first mover
 * then won 50.3% (Medium), 48.5% (Easy), 49.5% (Hard) and 47.3% under
 * Ranked's domination-only rules. Bigger maps, where the edge was bigger,
 * lose more of the opening turn.
 *
 * Round 1 only, two seats only, never a team game or a Territory Draft (whose
 * opening the runs did not cover). Where it is baked is the create route's
 * business (createGameSettings.ts, the ranked matchmaker).
 */
export const DUEL_OPENING_FIRST_MOVER_UNITS = 3;
export const DUEL_OPENING_SECOND_MOVER_BONUS = 1;

/**
 * Maps whose first mover opens with more than 3. Modern alone: at 3 its first
 * mover won only 44% of two-player Medium-bot games (39.8% over 1,200 with the
 * even deal's neutral leftover too), while Cold War, the same size, sat at 51%.
 * A rule that scaled the cap with the map (usual - 3) fixed Modern and pushed
 * Cold War to 60%, so the exception is Modern's own.
 */
export const DUEL_OPENING_FIRST_MOVER_UNITS_BY_MAP: Readonly<Record<string, number>> = {
  era_modern: 4,
};

/** The most the first mover places on their opening turn, on this map. */
export function duelOpeningFirstMoverUnits(mapId: string | undefined): number {
  return (mapId && DUEL_OPENING_FIRST_MOVER_UNITS_BY_MAP[mapId]) || DUEL_OPENING_FIRST_MOVER_UNITS;
}

/** Whether the opening balance applies to this game, in its first round. */
export function duelOpeningApplies(state: Pick<GameState, 'settings' | 'players' | 'teams' | 'turn_number'>): boolean {
  return state.settings.duel_opening_enabled === true
    && state.players.length === 2
    && !(state.teams?.length)
    && !state.settings.territory_selection
    && state.turn_number === 1;
}

/**
 * Adjust the reinforcements just computed for the player at `playerIndex`,
 * whose turn is starting: the first mover's opening turn down to 3 (4 on
 * Modern), the second mover's first turn up by 1. Call it after the usual
 * rule has set `draft_units_remaining`, at the game's start and at each
 * hand-off.
 */
export function applyDuelOpening(state: GameState, playerIndex: number): void {
  if (!duelOpeningApplies(state)) return;
  const units = state.draft_units_remaining ?? 0;
  state.draft_units_remaining = playerIndex === (state.starting_player_index ?? 0)
    ? Math.min(units, duelOpeningFirstMoverUnits(state.map_id))
    : units + DUEL_OPENING_SECOND_MOVER_BONUS;
}
