import type { Server, Socket } from 'socket.io';
import type { GameState, GameMap } from '../../types';

export interface ActiveGameRoom {
  state: GameState;
  map: GameMap;
  connectedSockets: Map<string, string>;
}

/**
 * Shared context passed to every extracted socket handler.
 * Keeps the handler decoupled from the top-level shared Maps.
 */
export interface SocketContext {
  io: Server;
  socket: Socket;
  userId: string;
  username: string;
  activeGames: Map<string, ActiveGameRoom>;
  broadcastState: (io: Server, gameId: string, state: GameState) => void;
  scheduleDebouncedSave: (gameId: string) => void;
  isSocketUsersTurn: (state: GameState, socketUserId: string, socketUsername?: string) => boolean;
}
