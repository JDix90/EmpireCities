import type { Socket } from 'socket.io';

/**
 * Stable machine-readable codes for socket error events. The payload stays
 * backward compatible: `{ message }` consumers keep working, newer clients
 * can branch on `code` instead of string-matching messages.
 */
export const GameErrorCode = {
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  ACTION_FAILED: 'ACTION_FAILED',
  NOT_PARTICIPANT: 'NOT_PARTICIPANT',
  /**
   * The games row itself is missing — the game is permanently gone, as
   * opposed to GAME_NOT_FOUND which can be a transient room-load miss the
   * client repairs by re-joining. Old clients fall back to matching the
   * 'Game not found' message and treat this the same as GAME_NOT_FOUND.
   */
  GAME_DELETED: 'GAME_DELETED',
  /**
   * The client is sending events faster than the per-user socket rate limit
   * allows. The action was dropped (not applied); the client should back off
   * and retry. Emitted at most once per notice window so a flood of blocked
   * packets cannot itself amplify outbound traffic.
   */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type GameErrorCodeValue = (typeof GameErrorCode)[keyof typeof GameErrorCode];

export function emitGameError(
  socket: Socket,
  code: GameErrorCodeValue,
  message: string,
): void {
  socket.emit('error', { message, code });
}
