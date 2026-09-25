/**
 * Whether a `game:cards_redeemed` event is this client's own.
 *
 * The server sends the event to the redeeming socket for a human and to the
 * whole room for an AI, and the client used to treat every one as its own:
 * a toast, a haptic and the AI's bonus added to this player's reinforcement
 * counter. The payload now names the seat; a payload without one comes from
 * an older server and keeps the old reading.
 */
export interface CardsRedeemedPayload {
  bonus: number;
  playerId?: string | null;
}

export function isOwnCardRedemption(
  payload: CardsRedeemedPayload,
  viewerIds: ReadonlyArray<string | null | undefined>,
): boolean {
  if (!payload.playerId) return true;
  return viewerIds.some((id) => !!id && id === payload.playerId);
}
