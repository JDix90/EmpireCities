import { describe, it, expect } from 'vitest';
import type { Server } from 'socket.io';
import { emitToPlayer } from './playerEvents';

function recordingIo() {
  const sent: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => { sent.push({ room, event, payload }); return true; },
    }),
  } as unknown as Server;
  return { io, sent };
}

describe('emitToPlayer', () => {
  it("sends the event to the player's user room, naming its game", () => {
    const { io, sent } = recordingIo();
    emitToPlayer(io, 'game-1', 'user-2', 'game:truce_broken', { breakerId: 'user-1', breakerName: 'Ada' });
    expect(sent).toEqual([{
      room: 'user:user-2',
      event: 'game:truce_broken',
      payload: { breakerId: 'user-1', breakerName: 'Ada', gameId: 'game-1' },
    }]);
  });

  it('names the game it was sent from, whatever the payload carried', () => {
    const { io, sent } = recordingIo();
    emitToPlayer(io, 'game-1', 'user-2', 'game:truce_proposal', { gameId: 'game-9', proposerId: 'user-1' });
    expect(sent[0]!.payload).toEqual({ gameId: 'game-1', proposerId: 'user-1' });
  });
});
