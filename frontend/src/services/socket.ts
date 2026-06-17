import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { getSocketUrl } from '../config/env';

let socket: Socket | null = null;
let boundSocketUrl: string | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function socketUrlKey(): string {
  return getSocketUrl() ?? '';
}

/** Decode a JWT's `exp` (seconds) without verifying — for client-side scheduling only. */
function decodeJwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Proactively refresh the access token shortly before it expires so a
 * long-lived game socket never lapses — the server now drops events from a
 * socket whose token has expired. refreshToken() sets the new token and calls
 * resyncSocketAuth(), which pushes it to the socket and reschedules the next
 * refresh, so the cycle self-sustains for the life of the session.
 */
function scheduleProactiveRefresh(token: string | null): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!token) return;
  const exp = decodeJwtExp(token);
  if (!exp) return;
  const LEAD_MS = 120_000; // refresh 2 minutes before expiry
  const delay = Math.max(exp * 1000 - Date.now() - LEAD_MS, 5_000);
  refreshTimer = setTimeout(() => {
    void useAuthStore.getState().refreshToken({ silent: true });
  }, delay);
}

export function getSocket(): Socket {
  const key = socketUrlKey();
  if (socket && boundSocketUrl !== key) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    boundSocketUrl = key;
    const token = useAuthStore.getState().accessToken;
    const url = getSocketUrl();
    socket = io(url, {
      auth: { token },
      withCredentials: true,
      transports: ['websocket'],
      autoConnect: false,
    });

    // Before each reconnect attempt, refresh the token so the server sees a valid JWT
    socket.io.on('reconnect_attempt', () => {
      const freshToken = useAuthStore.getState().accessToken;
      if (socket) {
        socket.auth = { token: freshToken };
      }
    });

    // Once connected, schedule a proactive token refresh ahead of expiry so the
    // long-lived socket never lapses.
    socket.on('connect', () => {
      scheduleProactiveRefresh(useAuthStore.getState().accessToken);
    });

    // The server signalled our token lapsed (e.g. a missed proactive refresh).
    // Refresh now — refreshToken() → resyncSocketAuth() pushes the fresh token
    // to the still-connected socket via `auth:refresh`.
    socket.on('auth:expired', () => {
      void useAuthStore.getState().refreshToken({ silent: true });
    });
  }
  return socket;
}

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    // Update token before connecting
    const token = useAuthStore.getState().accessToken;
    s.auth = { token };
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    boundSocketUrl = undefined;
  }
}

/**
 * Push a refreshed access token to the socket. Called after a successful HTTP
 * token refresh to prevent stale-token disconnects.
 *
 * When connected we extend the socket IN PLACE via `auth:refresh` (the server
 * updates the socket's recorded expiry) rather than disconnecting/reconnecting,
 * so an active player never sees a gap. `socket.auth` is also updated so any
 * future (re)connect handshake carries the fresh token.
 */
export function resyncSocketAuth(): void {
  if (!socket) return;
  const token = useAuthStore.getState().accessToken;
  if (!token) return;
  socket.auth = { token };
  if (socket.connected) {
    socket.emit('auth:refresh', token);
  }
  scheduleProactiveRefresh(token);
}
