import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    username: string;
  }
}

/**
 * Fastify preHandler hook that validates the Bearer access token.
 * Attaches userId and username to the request object on success.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);

  if (!payload) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or expired token' });
  }

  request.userId = payload.sub;
  request.username = payload.username;
}
