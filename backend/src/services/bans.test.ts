/**
 * services/bans.ts: the two primitives a ban relies on. The refresh route and
 * the socket handshake ask `isUserBanned`; the admin ban route calls
 * `endSessionsForBannedUser` to drop what is already live.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server } from 'socket.io';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: async (...a: unknown[]) => ((await queryMock(...a)) as unknown[])[0] ?? null,
}));

import { endSessionsForBannedUser, isUserBanned } from './bans';

const USER = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

describe('isUserBanned', () => {
  it('reads the account row', async () => {
    queryMock.mockResolvedValueOnce([{ is_banned: true }]);
    expect(await isUserBanned(USER)).toBe(true);
    expect(queryMock.mock.calls[0]![1]).toEqual([USER]);

    queryMock.mockResolvedValueOnce([{ is_banned: false }]);
    expect(await isUserBanned(USER)).toBe(false);
  });

  it('treats a missing account or a null column as not banned', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await isUserBanned(USER)).toBe(false);
    queryMock.mockResolvedValueOnce([{ is_banned: null }]);
    expect(await isUserBanned(USER)).toBe(false);
  });
});

describe('endSessionsForBannedUser', () => {
  function fakeIo() {
    const disconnectSockets = vi.fn();
    const inRoom = vi.fn(() => ({ disconnectSockets }));
    return { io: { in: inRoom } as unknown as Server, inRoom, disconnectSockets };
  }

  it('revokes every live refresh token and disconnects the account\'s sockets', async () => {
    const { io, inRoom, disconnectSockets } = fakeIo();
    await endSessionsForBannedUser(USER, io);

    const revoke = queryMock.mock.calls.find(([sql]) => /UPDATE refresh_tokens SET revoked = TRUE/.test(String(sql)));
    expect(revoke).toBeDefined();
    expect(revoke![1]).toEqual([USER]);
    expect(inRoom).toHaveBeenCalledWith(`user:${USER}`);
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('still revokes the tokens when no socket server is running', async () => {
    await endSessionsForBannedUser(USER, null);
    expect(queryMock.mock.calls.some(([sql]) => /UPDATE refresh_tokens/.test(String(sql)))).toBe(true);
  });
});
