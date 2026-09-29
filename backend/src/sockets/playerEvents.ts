import type { Server } from 'socket.io';

/**
 * Send a game event to one player, through their user room (`user:<id>`).
 *
 * Every socket the player has open is in that room, whichever game it shows:
 * a player in two games at once, or one watching another game, receives the
 * event on every page. So the payload names the game it comes from, and the
 * client drops an event for a game other than the one on screen.
 */
export function emitToPlayer(
  io: Server,
  gameId: string,
  playerId: string,
  event: string,
  payload: object,
): void {
  io.to(`user:${playerId}`).emit(event, { ...payload, gameId });
}
