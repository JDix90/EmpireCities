import type { FastifyReply, FastifyRequest } from 'fastify';
import { queryOne } from '../db/postgres';

/**
 * Gate admin-only routes. Runs after `authenticate` (which sets `request.isAdmin`
 * from the JWT `admin` claim).
 *
 * The claim alone is baked in at token-issue time, so a demoted or banned admin
 * would keep access until their access token expires (up to ~1h). We therefore
 * RE-VALIDATE against the DB on every admin request, so revocation/ban takes
 * effect immediately. Admin routes are low-traffic, so the extra indexed lookup
 * (PK on user_id) is negligible.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.isAdmin) {
    return reply.status(403).send({ error: 'Admin access required' });
  }

  const row = await queryOne<{ is_admin: boolean; is_banned: boolean }>(
    'SELECT is_admin, is_banned FROM users WHERE user_id = $1',
    [request.userId],
  );
  if (!row || !row.is_admin || row.is_banned) {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}
