/**
 * HTTP + Socket.io helpers for Redis migration staging validation.
 */

import { io as ioClient, type Socket } from 'socket.io-client';
import type { GameState } from '../../src/types';

export interface StagingConfig {
  baseUrl: string;
  socketUrl?: string;
}

export interface GuestSession {
  accessToken: string;
  userId: string;
  username: string;
}

export interface CreatedGame {
  gameId: string;
  joinCode: string | null;
}

export interface GameCreateOptions {
  eraId?: string;
  mapId?: string;
  maxPlayers?: number;
  aiCount?: number;
  settings?: Record<string, unknown>;
}

const DEFAULT_SETTINGS = {
  fog_of_war: false,
  turn_timer_seconds: 0,
  territory_selection: false,
  events_enabled: false,
  economy_enabled: false,
  tech_trees_enabled: false,
  factions_enabled: false,
  diplomacy_enabled: false,
  initial_unit_count: 3,
};

export async function waitForReady(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/ready`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ready') return;
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error(`Backend not ready at ${baseUrl} within ${timeoutMs}ms`);
}

export async function createGuest(cfg: StagingConfig): Promise<GuestSession> {
  const res = await fetch(`${cfg.baseUrl}/api/auth/guest`, { method: 'POST' });
  if (!res.ok) throw new Error(`guest auth failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    accessToken: string;
    guestId: string;
    user: { username: string };
  };
  return {
    accessToken: body.accessToken,
    userId: body.guestId,
    username: body.user.username,
  };
}

export async function createGame(
  cfg: StagingConfig,
  token: string,
  options: GameCreateOptions = {},
): Promise<CreatedGame> {
  const payload = {
    era_id: options.eraId ?? 'ancient',
    map_id: options.mapId ?? 'era_ancient',
    max_players: options.maxPlayers ?? 2,
    ai_count: options.aiCount ?? 1,
    ai_difficulty: 'medium',
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
  };
  const res = await fetch(`${cfg.baseUrl}/api/games`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`create game failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { game_id: string; join_code: string | null };
  return { gameId: body.game_id, joinCode: body.join_code };
}

export async function joinGameApi(cfg: StagingConfig, token: string, gameId: string): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/api/games/${gameId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`join game failed: ${res.status} ${await res.text()}`);
  }
}

export function connectSocket(cfg: StagingConfig, token: string): Socket {
  const url = cfg.socketUrl ?? cfg.baseUrl;
  return ioClient(url, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 15_000,
  });
}

export async function connectAndJoin(
  cfg: StagingConfig,
  token: string,
  gameId: string,
): Promise<{ socket: Socket; state: GameState | null }> {
  const socket = connectSocket(cfg, token);
  await waitForSocketConnect(socket);

  const state = await new Promise<GameState | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('game join timeout')), 30_000);
    let resolved = false;
    const finish = (value: GameState | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      socket.off('error', onError);
      resolve(value);
    };
    const onError = (err: { message?: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      socket.off('game:state', onState);
      socket.off('game:joined', onJoined);
      reject(new Error(err?.message ?? 'socket error on join'));
    };
    const onState = (payload: GameState) => finish(payload);
    const onJoined = () => finish(null);
    socket.once('game:state', onState);
    socket.once('game:joined', onJoined);
    socket.once('error', onError);
    socket.emit('game:join', { gameId });
  });

  return { socket, state };
}

export async function startGame(socket: Socket, gameId: string): Promise<GameState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('game:start timeout')), 45_000);
    const onState = (payload: GameState) => {
      clearTimeout(timer);
      socket.off('error', onError);
      resolve(payload);
    };
    const onError = (err: { message?: string }) => {
      clearTimeout(timer);
      socket.off('game:state', onState);
      reject(new Error(err?.message ?? 'game:start error'));
    };
    socket.once('game:state', onState);
    socket.once('error', onError);
    socket.emit('game:start', { gameId });
  });
}

export async function waitForHumanTurn(
  socket: Socket,
  userId: string,
  timeoutMs = 60_000,
  initialState?: GameState | null,
): Promise<GameState> {
  if (initialState) {
    const current = initialState.players[initialState.current_player_index];
    if (current && !current.is_ai && current.player_id === userId) {
      return initialState;
    }
  }

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const handler = (state: GameState) => {
      const current = state.players[state.current_player_index];
      if (current && !current.is_ai && current.player_id === userId) {
        socket.off('game:state', handler);
        resolve(state);
      } else if (Date.now() > deadline) {
        socket.off('game:state', handler);
        reject(new Error('timed out waiting for human turn'));
      }
    };
    socket.on('game:state', handler);
  });
}

export async function waitForStateUpdate(
  socket: Socket,
  predicate: (state: GameState) => boolean,
  timeoutMs = 30_000,
): Promise<GameState> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const handler = (state: GameState) => {
      if (predicate(state)) {
        socket.off('game:state', handler);
        resolve(state);
      } else if (Date.now() > deadline) {
        socket.off('game:state', handler);
        reject(new Error('timed out waiting for state update'));
      }
    };
    socket.on('game:state', handler);
  });
}

export function snapshotFingerprint(state: GameState): string {
  const territorySig = Object.entries(state.territories)
    .map(([id, t]) => `${id}:${t.owner_id}:${t.units}`)
    .sort()
    .join('|');
  return [
    `turn=${state.turn_number}`,
    `phase=${state.phase}`,
    `player=${state.current_player_index}`,
    `territories=${territorySig.slice(0, 200)}…(${Object.keys(state.territories).length})`,
  ].join(' ');
}

export function disconnectSocket(socket: Socket): void {
  socket.removeAllListeners();
  socket.disconnect();
}

function waitForSocketConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 15_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
