/**
 * What a player pressed on the game-over screen (`results_action_events_enabled`),
 * posted as the `results_action` UI event. There was no record of what a finished
 * game led to — a second game, a share, a saved account or the lobby — so
 * "what do players do after a game" could not be answered. The server takes a
 * closed set of actions (analytics.routes.ts RESULTS_ACTIONS).
 */
export type ResultsAction =
  | 'rematch'
  | 'lobby'
  | 'share'
  | 'replay'
  | 'clip'
  | 'challenge'
  | 'save_account'
  | 'play_on';

export interface ResultsActionContext {
  gameId?: string;
  isWinner: boolean;
  firstMatch: boolean;
  isTutorial: boolean;
  isGuest: boolean;
}

/** The event's properties: strings only, as the UI-event endpoint takes them. */
export function resultsActionProperties(action: ResultsAction, ctx: ResultsActionContext): Record<string, string> {
  return {
    action,
    outcome: ctx.isWinner ? 'won' : 'lost',
    game_id: ctx.gameId ?? '',
    first_match: String(ctx.firstMatch),
    is_tutorial: String(ctx.isTutorial),
    is_guest: String(ctx.isGuest),
  };
}
