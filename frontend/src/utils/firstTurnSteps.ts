/**
 * First-turn measurement (`first_turn_events_enabled`): which steps of a real
 * game's first turn a player reached, so the funnel can say where a first turn
 * stops between seeing the map (`map_rendered`) and attacking (`first_attack`).
 * Six in ten new players who opened a real game never attacked, and nothing
 * in between was recorded.
 *
 * GamePage builds a `FirstTurnView` from the game as it renders and posts each
 * step this returns as `first_turn_step`, once per game. The server accepts
 * only these step names (backend modules/analytics/analytics.routes.ts).
 */
export type FirstTurnStep = 'briefing_closed' | 'territory_opened' | 'units_placed' | 'draft_ended';

export const FIRST_TURN_STEPS: readonly FirstTurnStep[] = [
  'briefing_closed',
  'territory_opened',
  'units_placed',
  'draft_ended',
];

/** The game as one viewer sees it, at one render. */
export interface FirstTurnView {
  /** A real game (not the tutorial) the viewer has a seat in. */
  realGame: boolean;
  /** The round; every seat's first turn is round 1. */
  turn: number;
  /** It is this viewer's turn. */
  myTurn: boolean;
  phase: string;
  /** The game-start briefing ("The battle begins") is showing. */
  briefingOpen: boolean;
  /** One of the viewer's own territories is open in the territory panel. */
  ownTerritoryOpen: boolean;
  /** Reinforcements the viewer still has to place this turn. */
  draftLeft: number;
}

/**
 * The steps reached between the previous view and this one, in order, that
 * have not been sent for this game. Only the first round of a real game
 * counts; a player who joins later records nothing.
 */
export function newFirstTurnSteps(
  prev: FirstTurnView | null,
  next: FirstTurnView,
  sent: ReadonlySet<FirstTurnStep>,
): FirstTurnStep[] {
  if (!next.realGame || next.turn !== 1) return [];
  const reached: FirstTurnStep[] = [];
  const draftingNow = next.myTurn && next.phase === 'draft';
  const wasDrafting = !!prev && prev.myTurn && prev.phase === 'draft';

  if (prev?.briefingOpen && !next.briefingOpen) reached.push('briefing_closed');
  if (draftingNow && next.ownTerritoryOpen) reached.push('territory_opened');
  if (draftingNow && wasDrafting && next.draftLeft < prev.draftLeft) reached.push('units_placed');
  // Ended by the player: the turn goes on into its attack. A clock that runs
  // out passes the turn on instead (the server records that, turn_timed_out).
  if (wasDrafting && next.myTurn && next.phase === 'attack') reached.push('draft_ended');

  return reached.filter((step) => !sent.has(step));
}
