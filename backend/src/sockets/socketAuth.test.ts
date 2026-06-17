import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

const verifyMock = vi.fn();
vi.mock('../utils/jwt', () => ({
  verifyAccessToken: (t: string) => verifyMock(t),
}));

import { registerSocketAuth } from './socketAuth';

type Middleware = (packet: unknown[], next: (err?: Error) => void) => void;

function makeSocket(data: Record<string, unknown> = {}) {
  let middleware: Middleware = () => {};
  const handlers: Record<string, (arg: unknown) => void> = {};
  const emit = vi.fn();
  const socket = {
    data,
    emit,
    use: (fn: Middleware) => {
      middleware = fn;
    },
    on: (event: string, fn: (arg: unknown) => void) => {
      handlers[event] = fn;
    },
  } as unknown as Socket;
  return { socket, emit, data, getMiddleware: () => middleware, getHandler: (e: string) => handlers[e] };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

beforeEach(() => verifyMock.mockReset());

describe('registerSocketAuth — expiry gate', () => {
  it('passes events through when the token is not expired', () => {
    const { socket, getMiddleware } = makeSocket({ userId: 'u1', tokenExp: nowSec() + 3600 });
    registerSocketAuth(socket);
    const next = vi.fn();
    getMiddleware()(['game:attack', {}], next);
    expect(next).toHaveBeenCalled();
  });

  it('drops events and emits auth:expired once the token is expired', () => {
    const { socket, emit, getMiddleware } = makeSocket({ userId: 'u1', tokenExp: nowSec() - 3600 });
    registerSocketAuth(socket);
    const next = vi.fn();
    getMiddleware()(['game:attack', {}], next);
    expect(next).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('auth:expired', expect.anything());
  });

  it('always lets auth:refresh through the gate even when expired (no deadlock)', () => {
    const { socket, getMiddleware } = makeSocket({ userId: 'u1', tokenExp: nowSec() - 3600 });
    registerSocketAuth(socket);
    const next = vi.fn();
    getMiddleware()(['auth:refresh', 'tok'], next);
    expect(next).toHaveBeenCalled();
  });

  it('does not enforce when no tokenExp is recorded (defensive)', () => {
    const { socket, getMiddleware } = makeSocket({ userId: 'u1' });
    registerSocketAuth(socket);
    const next = vi.fn();
    getMiddleware()(['game:attack', {}], next);
    expect(next).toHaveBeenCalled();
  });
});

describe('registerSocketAuth — auth:refresh handler', () => {
  it('extends tokenExp for a valid same-user token', () => {
    const { socket, emit, data, getHandler } = makeSocket({ userId: 'u1', tokenExp: nowSec() - 10 });
    registerSocketAuth(socket);
    verifyMock.mockReturnValue({ sub: 'u1', username: 'a', exp: nowSec() + 3600 });
    getHandler('auth:refresh')('newtoken');
    expect(data.tokenExp as number).toBeGreaterThan(nowSec());
    expect(emit).toHaveBeenCalledWith('auth:refreshed', { ok: true });
  });

  it('accepts the { token } object form', () => {
    const { socket, data, getHandler } = makeSocket({ userId: 'u1', tokenExp: nowSec() - 10 });
    registerSocketAuth(socket);
    verifyMock.mockReturnValue({ sub: 'u1', username: 'a', exp: nowSec() + 3600 });
    getHandler('auth:refresh')({ token: 'newtoken' });
    expect(data.tokenExp as number).toBeGreaterThan(nowSec());
  });

  it('rejects a token for a different user (no identity rebind)', () => {
    const { socket, data, getHandler } = makeSocket({ userId: 'u1', tokenExp: nowSec() - 10 });
    registerSocketAuth(socket);
    verifyMock.mockReturnValue({ sub: 'attacker', username: 'm', exp: nowSec() + 3600 });
    getHandler('auth:refresh')('othertoken');
    expect(data.tokenExp as number).toBeLessThan(nowSec()); // unchanged (still expired)
  });

  it('rejects an invalid token', () => {
    const { socket, data, getHandler } = makeSocket({ userId: 'u1', tokenExp: nowSec() - 10 });
    registerSocketAuth(socket);
    verifyMock.mockReturnValue(null);
    getHandler('auth:refresh')('bad');
    expect(data.tokenExp as number).toBeLessThan(nowSec());
  });
});
