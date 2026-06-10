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
} as const;

export type GameErrorCodeValue = (typeof GameErrorCode)[keyof typeof GameErrorCode];

export function emitGameError(
  socket: Socket,
  code: GameErrorCodeValue,
  message: string,
): void {
  socket.emit('error', { message, code });
}
