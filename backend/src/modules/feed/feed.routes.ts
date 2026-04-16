import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { getFriendActivity, getOwnActivity } from '../../services/activityService';

export async function feedRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/feed ────────────────────────────────────────────────────────
  // Friend activity feed (recent events from friends)
  fastify.get('/', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const qs = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '20', 10) || 20, 50);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;

    const activities = await getFriendActivity(request.userId, limit, offset);
    return reply.send({ activities });
  });

  // ── GET /api/feed/me ─────────────────────────────────────────────────────
  // Own activity history
  fastify.get('/me', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const qs = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(qs.limit ?? '20', 10) || 20, 50);
    const offset = parseInt(qs.offset ?? '0', 10) || 0;

    const activities = await getOwnActivity(request.userId, limit, offset);
    return reply.send({ activities });
  });
}
