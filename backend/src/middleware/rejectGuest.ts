import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Use after `authenticate`. Blocks JWTs issued for guest sessions.
 */
export async function rejectGuest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.isGuest) {
    return reply.status(403).send({ error: 'Guest accounts cannot access this resource' });
  }
}
