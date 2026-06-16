import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../utils/jwt';

/**
 * Key generator for @fastify/rate-limit.
 *
 * The limiter runs on the `onRequest` hook — before the `authenticate`
 * preHandler — so `request.userId` is not populated yet. We therefore verify
 * the Bearer access token here ourselves and key authenticated traffic by user
 * id, so a user's quota follows them regardless of NAT/shared-proxy IPs and a
 * single abusive account cannot exhaust the bucket for everyone behind its IP.
 *
 * Unauthenticated requests (login, register, public reads) fall back to the
 * client IP, which Fastify derives from `X-Forwarded-For` when `trustProxy`
 * is enabled.
 */
export function userOrIpKey(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = verifyAccessToken(authHeader.slice(7));
    if (payload) return `u:${payload.sub}`;
  }
  return `ip:${request.ip}`;
}
