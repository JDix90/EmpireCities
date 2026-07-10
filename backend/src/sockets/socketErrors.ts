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

  /*
   * Gameplay-action rejection codes. These carry the same human `message` as
   * before (so old clients are unaffected), but let newer clients map each
   * rejection to specific, actionable guidance instead of echoing a raw string.
   * The server remains authoritative — these describe *why* a move was refused.
   */
  /** Not the requesting player's turn. */
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  /** The action isn't valid in the current phase (e.g. attacking during draft). */
  WRONG_PHASE: 'WRONG_PHASE',
  /** The player doesn't own the source/target territory the action requires. */
  NOT_OWNER: 'NOT_OWNER',
  /** Not enough units for the action (attack needs ≥2; must leave 1 behind). */
  INSUFFICIENT_UNITS: 'INSUFFICIENT_UNITS',
  /** The two territories don't share a border. */
  NOT_ADJACENT: 'NOT_ADJACENT',
  /** No connected chain of owned territories links source and destination. */
  PATH_NOT_CONNECTED: 'PATH_NOT_CONNECTED',
  /** Already advanced an era this turn, so attacking is locked out. */
  ALREADY_ADVANCED: 'ALREADY_ADVANCED',
  /** An active truce with the target player blocks the attack. */
  TRUCE_ACTIVE: 'TRUCE_ACTIVE',
  /** A galaxy hyperspace lane between the territories is sealed. */
  LANE_SEALED: 'LANE_SEALED',
  /** Orbit/moon access rules deny the move (e.g. no launch capability). */
  ACCESS_DENIED: 'ACCESS_DENIED',
  /** Empire stability caps how many units may be deployed this turn. */
  STABILITY_CAP: 'STABILITY_CAP',
  /** A referenced territory id is missing or otherwise invalid. */
  INVALID_TERRITORY: 'INVALID_TERRITORY',
  /** A unit count was not a positive whole number. */
  NON_INTEGER_UNITS: 'NON_INTEGER_UNITS',
  /** A prior action for this player is still being processed. */
  ACTION_IN_FLIGHT: 'ACTION_IN_FLIGHT',
  /** The per-turn fortify move allowance is exhausted. */
  FORTIFY_LIMIT: 'FORTIFY_LIMIT',
} as const;

export type GameErrorCodeValue = (typeof GameErrorCode)[keyof typeof GameErrorCode];

export function emitGameError(
  socket: Socket,
  code: GameErrorCodeValue,
  message: string,
): void {
  socket.emit('error', { message, code });
}
