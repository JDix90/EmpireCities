import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Use after `authenticate`. Allows ONLY guest sessions — the inverse of
 * `rejectGuest`. Currently guards the account-upgrade endpoint, which
 * converts a guest's users row in place and must never run against an
 * already-registered account.
 */
export async function requireGuest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.isGuest) {
    return reply.status(403).send({ error: 'Only guest accounts can be upgraded' });
  }
}
