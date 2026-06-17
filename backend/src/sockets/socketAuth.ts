import type { Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';

/** Tolerate minor clock skew / an in-flight refresh before enforcing expiry. */
export const EXPIRY_GRACE_MS = 10_000;
/** Throttle the `auth:expired` notice so a lapsed client can't be spammed. */
const EXPIRED_NOTICE_COOLDOWN_MS = 5_000;

function tokenExpired(socket: Socket): boolean {
  const exp = socket.data?.tokenExp as number | undefined;
  // No recorded expiry → don't enforce (defensive; never break a live socket
  // that predates this field).
  if (typeof exp !== 'number') return false;
  return Date.now() > exp * 1000 + EXPIRY_GRACE_MS;
}

/**
 * Enforce access-token expiry on a live socket, with a cooperative in-place
 * refresh so active players are never disconnected.
 *
 * The handshake (`io.use`) verifies the access token only ONCE; without this a
 * socket keeps full game-action authority for the life of the TCP connection —
 * long after the (default 1h) token's `exp`, and a logout / forced revocation
 * cannot stop it. Here we:
 *
 *   - drop any inbound event once the token is past `exp` (so no action is
 *     taken on an expired credential), and prompt the client to refresh;
 *   - accept `auth:refresh` with a fresh access token for the SAME user to
 *     extend the socket in place, so a client that refreshes before `exp`
 *     never sees a gap.
 *
 * This bounds the post-expiry action window to the grace period instead of the
 * whole connection lifetime, without the reconnection churn a forced
 * `disconnect()` would cause mid-game. Install once per connection, BEFORE the
 * rate-limit middleware.
 */
export function registerSocketAuth(socket: Socket): void {
  socket.use((packet, next) => {
    const event = Array.isArray(packet) ? (packet[0] as string | undefined) : undefined;
    // The refresh event must always get through — otherwise a lapsed client
    // could never re-validate (deadlock).
    if (event === 'auth:refresh') return next();
    if (!tokenExpired(socket)) return next();

    const now = Date.now();
    const lastAt = (socket.data?.authExpiredNoticeAt as number | undefined) ?? 0;
    if (now - lastAt >= EXPIRED_NOTICE_COOLDOWN_MS) {
      socket.data.authExpiredNoticeAt = now;
      socket.emit('auth:expired', { message: 'Your session token expired. Refreshing…' });
    }
    // Intentionally do NOT call next(): the event is dropped.
  });

  socket.on('auth:refresh', (raw: unknown) => {
    const token =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object'
          ? (raw as { token?: unknown }).token
          : undefined;
    if (typeof token !== 'string') return;

    const payload = verifyAccessToken(token);
    // Must be a valid token for the SAME user — never let a socket rebind its
    // identity to another account via a refreshed token.
    if (!payload || payload.sub !== socket.data?.userId) return;

    socket.data.tokenExp = payload.exp;
    socket.data.authExpiredNoticeAt = 0;
    socket.emit('auth:refreshed', { ok: true });
  });
}
