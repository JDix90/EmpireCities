/**
 * The socket handshake refuses a banned account, through a REAL socket.io
 * server and client. An access token is valid for an hour after a ban; it must
 * not be able to open a game socket (services/bans.ts). A failing ban check
 * lets the connection through rather than locking every player out.
 *
 * Redis-gated (REDIS_TEST=1) like the rest of the socket tier; skips in plain
 * unit runs. Locally:
 *   REDIS_TEST=1 pnpm exec vitest run src/sockets/socketBan.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';

const banCheck = vi.hoisted(() => vi.fn<(userId: string) => Promise<boolean>>());
vi.mock('../services/bans', () => ({
  isUserBanned: (userId: string) => banCheck(userId),
  endSessionsForBannedUser: async () => {},
}));

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('socket handshake and bans', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    const redisMod = await import('../db/redis');
    await redisMod.redis.connect().catch(() => {});
    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    await shutdownGameSocket(ioServer).catch(() => {});
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(() => {
    while (openClients.length) openClients.pop()?.disconnect();
    banCheck.mockReset();
  });

  /** Connect as `userId`; resolve 'connected' or the server's refusal message. */
  function connectAs(userId: string): Promise<string> {
    const client = ClientIO(`http://localhost:${port}`, {
      auth: { token: signAccessToken({ sub: userId, username: userId }) },
      transports: ['websocket'],
      reconnection: false,
    });
    openClients.push(client);
    return new Promise((resolve) => {
      client.on('connect', () => resolve('connected'));
      client.on('connect_error', (err) => resolve(err.message));
    });
  }

  it('refuses a banned account', async () => {
    banCheck.mockImplementation(async (id) => id === 'banned-user');
    expect(await connectAs('banned-user')).toBe('Account is banned');
    expect(banCheck).toHaveBeenCalledWith('banned-user');
  });

  it('admits an account in good standing', async () => {
    banCheck.mockResolvedValue(false);
    expect(await connectAs('good-user')).toBe('connected');
  });

  it('admits the connection when the ban check itself fails', async () => {
    banCheck.mockRejectedValue(new Error('database unavailable'));
    expect(await connectAs('good-user')).toBe('connected');
  });
});
