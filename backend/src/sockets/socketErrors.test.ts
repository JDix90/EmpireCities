import { describe, it, expect, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { emitGameError, GameErrorCode } from './socketErrors';

describe('emitGameError', () => {
  it('emits the legacy-compatible payload with a machine-readable code', () => {
    const emit = vi.fn();
    const socket = { emit } as unknown as Socket;

    emitGameError(socket, GameErrorCode.GAME_NOT_FOUND, 'Game not found');

    expect(emit).toHaveBeenCalledWith('error', {
      message: 'Game not found',
      code: 'GAME_NOT_FOUND',
    });
  });

  it('round-trips each gameplay rejection code with the human message intact', () => {
    const gameplayCodes = [
      GameErrorCode.NOT_YOUR_TURN,
      GameErrorCode.WRONG_PHASE,
      GameErrorCode.NOT_OWNER,
      GameErrorCode.INSUFFICIENT_UNITS,
      GameErrorCode.NOT_ADJACENT,
      GameErrorCode.PATH_NOT_CONNECTED,
      GameErrorCode.ALREADY_ADVANCED,
      GameErrorCode.TRUCE_ACTIVE,
      GameErrorCode.LANE_SEALED,
      GameErrorCode.ACCESS_DENIED,
      GameErrorCode.STABILITY_CAP,
      GameErrorCode.INVALID_TERRITORY,
      GameErrorCode.NON_INTEGER_UNITS,
      GameErrorCode.ACTION_IN_FLIGHT,
      GameErrorCode.FORTIFY_LIMIT,
    ];

    for (const code of gameplayCodes) {
      const emit = vi.fn();
      const socket = { emit } as unknown as Socket;
      emitGameError(socket, code, `msg:${code}`);
      // Payload stays { message, code } so old clients ignoring `code` still work.
      expect(emit).toHaveBeenCalledWith('error', { message: `msg:${code}`, code });
    }
  });

  it('exposes each code as its own literal value (no accidental collisions)', () => {
    const values = Object.values(GameErrorCode);
    expect(new Set(values).size).toBe(values.length);
    // Every code is a non-empty SCREAMING_SNAKE_CASE string equal to its key.
    for (const [key, value] of Object.entries(GameErrorCode)) {
      expect(value).toBe(key);
    }
  });
});
