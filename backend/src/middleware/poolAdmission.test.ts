import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

// vi.mock is hoisted above imports, so the factory can't close over a normal
// const — declare the shared stub via vi.hoisted.
const { pool } = vi.hoisted(() => ({ pool: { waitingCount: 0 } }));
vi.mock('../db/postgres', () => ({ pgPool: pool }));

import { shedIfPoolSaturated } from './poolAdmission';

function makeReply() {
  const sent: { code?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const reply = {
    code(c: number) {
      sent.code = c;
      return this;
    },
    header(k: string, v: string) {
      sent.headers[k] = v;
      return this;
    },
    send(b: unknown) {
      sent.body = b;
      return this;
    },
  } as unknown as FastifyReply;
  return { reply, sent };
}

describe('shedIfPoolSaturated', () => {
  beforeEach(() => {
    pool.waitingCount = 0;
  });

  it('passes the request through when the pool is not saturated', async () => {
    pool.waitingCount = 0;
    const { reply, sent } = makeReply();
    await shedIfPoolSaturated({} as FastifyRequest, reply);
    expect(sent.code).toBeUndefined();
  });

  it('sheds with a retryable 503 when the pool is saturated', async () => {
    pool.waitingCount = 999; // well past the default threshold (20)
    const { reply, sent } = makeReply();
    await shedIfPoolSaturated({} as FastifyRequest, reply);
    expect(sent.code).toBe(503);
    expect(sent.headers['Retry-After']).toBe('2');
    expect(sent.body).toMatchObject({ error: expect.stringMatching(/busy/i) });
  });
});
