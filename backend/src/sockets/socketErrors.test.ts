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
});
