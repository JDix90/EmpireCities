/** What to do when a self-heal `POST /games/:id/join` fails for a non-participant. */
export type JoinFailureAction = 'spectate' | 'error';

/**
 * Decide how to handle a failed join. A game that has already *started*
 * (`not_waiting`) can't be joined but can be watched — route those to the live
 * spectator view. Everything else (gone, full, unknown) falls through to the
 * error screen.
 */
export function resolveJoinFailure(status: number | undefined, code: string | undefined): JoinFailureAction {
  if (status === 409 && code === 'not_waiting') return 'spectate';
  return 'error';
}
