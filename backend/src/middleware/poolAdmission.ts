import type { FastifyReply, FastifyRequest } from 'fastify';
import { pgPool } from '../db/postgres';

/**
 * When the Postgres pool already has this many checkouts QUEUED, new requests to
 * DB-heavy endpoints fast-fail with 503 instead of waiting up to the 15s
 * connection-acquire timeout. Under a game-creation burst the old behaviour was
 * to queue every request for 15s → clients retry → more pressure → cascading
 * timeouts. Shedding early converts that thundering-herd outage into
 * degraded-but-up. Tunable via PG_ADMISSION_MAX_WAITING.
 */
const MAX_WAITING = Math.max(1, parseInt(process.env.PG_ADMISSION_MAX_WAITING || '20', 10));

/**
 * Fastify preHandler that sheds load when the pg pool is saturated. Apply to the
 * expensive routes (game creation, lobby live-list, leaderboards). Returns a
 * retryable 503 so the client can back off rather than hang.
 */
export async function shedIfPoolSaturated(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (pgPool.waitingCount >= MAX_WAITING) {
    return reply.code(503).header('Retry-After', '2').send({
      error: 'Server is busy. Please retry in a moment.',
    });
  }
}
