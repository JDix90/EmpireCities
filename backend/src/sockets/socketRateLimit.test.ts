import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// Mock the shared Redis limiter so these tests run in the plain (non-Redis)
// suite and we can drive allow/deny deterministically.
const rateLimitMock = vi.fn();
vi.mock('../utils/socketLimiter', () => ({
  rateLimit: (key: string, opts: { max: number; windowMs: number }) => rateLimitMock(key, opts),
}));

import { registerSocketRateLimit } from './socketRateLimit';

type Middleware = (packet: unknown[], next: (err?: Error) => void) => void;

function makeSocket(): { socket: Socket; emit: ReturnType<typeof vi.fn>; getMiddleware: () => Middleware } {
  let middleware: Middleware = () => {};
  const emit = vi.fn();
  const socket = {
    data: {} as Record<string, unknown>,
    emit,
    use: (fn: Middleware) => {
      middleware = fn;
    },
  } as unknown as Socket;
  return { socket, emit, getMiddleware: () => middleware };
}

/** Flush the microtask queue so the limiter's `.then(...)` runs. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('registerSocketRateLimit', () => {
  beforeEach(() => {
    rateLimitMock.mockReset();
  });

  it('calls next() and runs the handler when under the limit', async () => {
    rateLimitMock.mockResolvedValue(true);
    const { socket, emit, getMiddleware } = makeSocket();
    registerSocketRateLimit(socket, 'user1');

    const next = vi.fn();
    getMiddleware()(['game:attack', {}], next);
    await flush();

    expect(next).toHaveBeenCalledOnce();
    expect(emit).not.toHaveBeenCalled();
  });

  it('drops the packet (no next) and emits a RATE_LIMITED notice when over the limit', async () => {
    rateLimitMock.mockResolvedValue(false);
    const { socket, emit, getMiddleware } = makeSocket();
    registerSocketRateLimit(socket, 'user1');

    const next = vi.fn();
    getMiddleware()(['game:chat', {}], next);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('error', {
      code: 'RATE_LIMITED',
      message: expect.stringContaining('too quickly'),
    });
  });

  it('keys sibling events into one shared bucket so rotation cannot dodge the limit', async () => {
    rateLimitMock.mockResolvedValue(true);
    const { socket, getMiddleware } = makeSocket();
    registerSocketRateLimit(socket, 'user42');
    const mw = getMiddleware();

    mw(['game:attack', {}], vi.fn());
    mw(['game:draft', {}], vi.fn());
    await flush();

    // Both gameplay events resolve to the same bucket key for the user.
    expect(rateLimitMock).toHaveBeenNthCalledWith(1, 'sock:user42:gameplay', expect.anything());
    expect(rateLimitMock).toHaveBeenNthCalledWith(2, 'sock:user42:gameplay', expect.anything());
  });

  it('throttles repeated notices to once per cooldown window', async () => {
    rateLimitMock.mockResolvedValue(false);
    const { socket, emit, getMiddleware } = makeSocket();
    registerSocketRateLimit(socket, 'user1');
    const mw = getMiddleware();

    mw(['game:chat', {}], vi.fn());
    await flush();
    mw(['game:chat', {}], vi.fn());
    await flush();

    // Two blocked packets back-to-back, but only one notice emitted.
    expect(emit).toHaveBeenCalledOnce();
  });

  it('falls open (calls next) if the limiter rejects unexpectedly', async () => {
    rateLimitMock.mockRejectedValue(new Error('boom'));
    const { socket, getMiddleware } = makeSocket();
    registerSocketRateLimit(socket, 'user1');

    const next = vi.fn();
    getMiddleware()(['game:attack', {}], next);
    await flush();

    expect(next).toHaveBeenCalledOnce();
  });

  it('applies the default bucket to unclassified events', async () => {
    rateLimitMock.mockResolvedValue(true);
    const { socket, getMiddleware } = makeSocket();
    registerSocketRateLimit(socket, 'u');

    getMiddleware()(['some:unknown_event', {}], vi.fn());
    await flush();

    expect(rateLimitMock).toHaveBeenCalledWith('sock:u:default', expect.anything());
  });
});
