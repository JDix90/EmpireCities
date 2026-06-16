# Security checklist (rolling)

Use before major releases or public launches. Track completion in your issue tracker.

## Authentication & sessions

- [ ] JWT access/refresh secrets are long random values in production (not defaults).
- [ ] Refresh cookies use appropriate `SameSite` / `Secure` for your deployment (HTTPS).
- [ ] CORS `CORS_ORIGINS` lists only trusted web origins (+ Capacitor if used).

## Transport & headers

- [ ] HTTPS terminated correctly; `trustProxy` on Fastify matches your load balancer.
- [x] Rate limits appropriate for auth routes (stricter) vs general API.
- [ ] Confirm the edge/LB always **overwrites** `X-Forwarded-For` (the HTTP rate
      limiter and `trustProxy` derive the client IP from it; a spoofable header
      lets a client forge its key). Limiters are Redis-backed and key
      authenticated traffic by user id, IP otherwise (`middleware/rateLimitKey.ts`).

## Real-time

- [ ] Socket.io uses auth middleware; unauthenticated connections cannot join game rooms.
- [x] Inbound socket events are rate limited per user (`sockets/socketRateLimit.ts`,
      shared Redis limiter) — chat/lobby broadcasts and turn actions are bucketed
      so a client cannot flood the room or our DB/Redis.

## Dependencies

- [ ] Run `pnpm audit` (or equivalent) and patch critical/high issues.
- [ ] Lockfile committed; CI uses frozen install.

## Data

- [ ] Postgres and Mongo credentials not committed; least-privilege DB users where possible.
- [ ] Guest vs registered user permissions reviewed (`rejectGuest` on sensitive routes).

## Privacy

- [ ] Document what PII is stored (see product policy); support account deletion if promised.
