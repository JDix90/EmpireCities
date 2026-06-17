import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

const queryOneMock = vi.fn();
vi.mock('../db/postgres', () => ({ queryOne: (...a: unknown[]) => queryOneMock(...a) }));

import { requireAdmin } from './requireAdmin';

function makeReplyReq(opts: { isAdmin: boolean; userId?: string }) {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    send(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as FastifyReply;
  const request = { isAdmin: opts.isAdmin, userId: opts.userId ?? 'u1' } as unknown as FastifyRequest;
  return { request, reply, sent };
}

beforeEach(() => queryOneMock.mockReset());

describe('requireAdmin', () => {
  it('returns 403 when the JWT admin claim is absent (no DB hit)', async () => {
    const { request, reply, sent } = makeReplyReq({ isAdmin: false });
    await requireAdmin(request, reply);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: 'Admin access required' });
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it('passes through when the DB confirms admin and not banned', async () => {
    queryOneMock.mockResolvedValue({ is_admin: true, is_banned: false });
    const { request, reply, sent } = makeReplyReq({ isAdmin: true });
    await requireAdmin(request, reply);
    expect(sent.status).toBeUndefined();
    expect(queryOneMock).toHaveBeenCalledTimes(1);
  });

  it('403s a demoted admin (claim true but DB is_admin false) — live revocation', async () => {
    queryOneMock.mockResolvedValue({ is_admin: false, is_banned: false });
    const { request, reply, sent } = makeReplyReq({ isAdmin: true });
    await requireAdmin(request, reply);
    expect(sent.status).toBe(403);
  });

  it('403s a banned admin', async () => {
    queryOneMock.mockResolvedValue({ is_admin: true, is_banned: true });
    const { request, reply, sent } = makeReplyReq({ isAdmin: true });
    await requireAdmin(request, reply);
    expect(sent.status).toBe(403);
  });

  it('403s when the user row no longer exists', async () => {
    queryOneMock.mockResolvedValue(null);
    const { request, reply, sent } = makeReplyReq({ isAdmin: true });
    await requireAdmin(request, reply);
    expect(sent.status).toBe(403);
  });
});
