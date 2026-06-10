export interface TurnTimeoutPayload {
  phaseAdvanced: 'attack' | 'fortify' | 'next_turn' | string;
  appliedDraft?: boolean;
  unitsPlaced?: number;
  deadline_at?: number | null;
}

/**
 * Human-readable explanation of a turn-timer expiry. Returned message is
 * shown only to the player whose clock ran out; null means "no toast".
 */
export function turnTimeoutToastMessage(payload: TurnTimeoutPayload): string | null {
  switch (payload.phaseAdvanced) {
    case 'attack':
      return payload.appliedDraft && (payload.unitsPlaced ?? 0) > 0
        ? `Draft time expired — ${payload.unitsPlaced} unit${payload.unitsPlaced === 1 ? '' : 's'} auto-placed. Attack phase started with a fresh clock.`
        : 'Draft time expired — attack phase started with a fresh clock.';
    case 'fortify':
      return 'Attack time expired — fortify phase started with a fresh clock.';
    case 'next_turn':
      return "Time's up — your turn ended and play passed to the next player.";
    default:
      return null;
  }
}
