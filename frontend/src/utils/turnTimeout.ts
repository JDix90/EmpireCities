export interface TurnTimeoutPayload {
  /** 'next_turn': the turn's clock ran out and the turn passed on. */
  phaseAdvanced: 'next_turn' | string;
  appliedDraft?: boolean;
  unitsPlaced?: number;
}

/**
 * Human-readable explanation of a turn-timer expiry. Returned message is
 * shown only to the player whose clock ran out; null means "no toast".
 *
 * The clock covers the whole turn, so an expiry always ends it. It used to
 * time out one phase at a time with a fresh clock for each.
 */
export function turnTimeoutToastMessage(payload: TurnTimeoutPayload): string | null {
  if (payload.phaseAdvanced !== 'next_turn') return null;
  const placed = payload.appliedDraft ? (payload.unitsPlaced ?? 0) : 0;
  return placed > 0
    ? `Time's up — ${placed} unit${placed === 1 ? '' : 's'} auto-placed, and your turn ended.`
    : "Time's up — your turn ended and play passed to the next player.";
}
