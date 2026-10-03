/**
 * Banning an account has to end what it is already doing, not only refuse its
 * next login. A session is a refresh-token cookie (seven days, rotated on every
 * page load) plus any live game sockets, and neither looked at `is_banned`, so a
 * banned player who never logged out kept playing.
 *
 * The refresh route and the socket handshake call `isUserBanned`; the admin ban
 * route calls `endSessionsForBannedUser` to drop what is already live. An access
 * token already issued still authenticates REST calls until it expires (one
 * hour); it can no longer be refreshed, and it can no longer hold a game socket.
 */
import type { Server } from 'socket.io';
import { query, queryOne } from '../db/postgres';

/** Whether the account is banned. An unknown account reads as not banned; callers handle missing users themselves. */
export async function isUserBanned(userId: string): Promise<boolean> {
  const row = await queryOne<{ is_banned: boolean | null }>(
    'SELECT is_banned FROM users WHERE user_id = $1',
    [userId],
  );
  return row?.is_banned === true;
}

/**
 * Sign a just-banned account out everywhere: revoke every refresh token it
 * holds, so no browser can refresh its way back in, and disconnect its live
 * sockets. Every socket joins `user:<id>` on connect (gameSocket.ts), and the
 * handshake then refuses to let it back. `io` is null before the socket server
 * starts and in tests that never start one; the tokens are revoked regardless.
 */
export async function endSessionsForBannedUser(userId: string, io: Server | null): Promise<void> {
  await query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE', [userId]);
  io?.in(`user:${userId}`).disconnectSockets(true);
}
