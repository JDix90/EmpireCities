/**
 * The global error handler reports server faults to Sentry and leaves client
 * errors out: a 500 is something to fix, a 404 or a validation failure is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const captureMock = vi.hoisted(() => vi.fn());
vi.mock('./services/sentry', () => ({
  captureException: (...a: unknown[]) => captureMock(...a),
}));

import { registerErrorHandler } from './errorHandler';
import { fastifyLoggerOptions } from './loggerOptions';

function app() {
  const a = Fastify();
  registerErrorHandler(a);
  a.get('/boom', async () => {
    throw new Error('database exploded');
  });
  a.get('/missing', async () => {
    const err = new Error('no such map') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  });
  return a;
}

beforeEach(() => captureMock.mockReset());

describe('registerErrorHandler and Sentry', () => {
  it('reports a 500 with its request', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(captureMock).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureMock.mock.calls[0]!;
    expect((err as Error).message).toBe('database exploded');
    expect(ctx).toMatchObject({ url: '/boom', method: 'GET', reqId: expect.any(String) });
    await a.close();
  });

  it('does not report a client error', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    expect(captureMock).not.toHaveBeenCalled();
    await a.close();
  });
});

describe('fastifyLoggerOptions', () => {
  it('logs warnings and errors in production, everything in development, nothing in tests', () => {
    expect(fastifyLoggerOptions('production')).toEqual({ level: 'warn' });
    expect(fastifyLoggerOptions('development')).toBe(true);
    expect(fastifyLoggerOptions('test')).toBe(false);
  });
});
