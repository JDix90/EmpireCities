import type { FastifyRequest, FastifyReply } from 'fastify';

const GUEST_REFUSED = { error: 'Guest accounts cannot access this resource' } as const;

/**
 * Use after `authenticate`. Blocks JWTs issued for guest sessions.
 */
export async function rejectGuest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.isGuest) {
    return reply.status(403).send(GUEST_REFUSED);
  }
}

/**
 * `rejectGuest`, except while `guestsAllowed()` says guests may use the route.
 * Read on every request, so a flag flipped off closes the route to guests at once.
 */
export function rejectGuestUnless(guestsAllowed: () => boolean) {
  return async function rejectGuestUnlessAllowed(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.isGuest && !guestsAllowed()) {
      return reply.status(403).send(GUEST_REFUSED);
    }
  };
}
