import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.isAdmin) {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}
