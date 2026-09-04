# Security checklist (rolling)

Use before major releases or public launches. Track completion in your issue tracker.

## Authentication & sessions

- [ ] JWT access/refresh secrets are long random values in production (not defaults).
- [ ] Refresh cookies use appropriate `SameSite` / `Secure` for your deployment (HTTPS).
- [ ] CORS `CORS_ORIGINS` lists only trusted web origins (+ Capacitor if used).

## Transport & headers

- [ ] HTTPS terminated correctly; `trustProxy` on Fastify matches your load balancer.
- [x] Rate limits appropriate for auth routes (stricter) vs general API.
- [x] The edge **overwrites** `X-Forwarded-For` (the HTTP rate limiter and
      `trustProxy` derive the client IP from it; a spoofable header lets a client
      forge its key). `docker/nginx.prod.conf` sets `X-Forwarded-For $remote_addr`
      (overwrite, not `$proxy_add_x_forwarded_for` append), and Fastify
      `trustProxy` is bounded (default 1 hop, `TRUST_PROXY` env) instead of `true`,
      so the client-supplied header cannot become `request.ip`. Raise `TRUST_PROXY`
      if you add another trusted proxy in front of nginx. Limiters are Redis-backed
      and key authenticated traffic by user id, IP otherwise (`middleware/rateLimitKey.ts`).

## Real-time

- [ ] Socket.io uses auth middleware; unauthenticated connections cannot join game rooms.
- [x] Inbound socket events are rate limited per user (`sockets/socketRateLimit.ts`,
      shared Redis limiter) — chat/lobby broadcasts and turn actions are bucketed
      so a client cannot flood the room or our DB/Redis.

## Dependencies

- [ ] Run `pnpm audit` (or equivalent) and patch critical/high issues.
- [ ] Lockfile committed; CI uses frozen install.

## Secrets & credentials

- [x] `scripts/check-secrets.sh` runs in CI (the `secrets` job) and fails the
      build if a real-looking API key, token, or private key lands in a tracked
      file. Run it locally with `pnpm run check:secrets`.
- [ ] `.env*.example` files contain placeholders only — never a working value.
      A live Resend API key was committed in `.env.production.example` (2026-06-30,
      `71de3ec`), sat in the public history until 2026-08-04, and was used by a
      third party to send phishing mail. It has been revoked.
- [ ] GitHub **secret scanning + push protection** enabled (Settings → Code
      security). Confirmed off as of 2026-08-04; both are free for public repos
      and push protection would have blocked the Resend key at `git push` —
      before the CI job above ever ran.
- [ ] Machine-wide ignore installed once per dev machine:
      `bash scripts/setup-global-gitignore.sh`. Covers `.env*`, private keys and
      credential bundles in **every** repo you clone, not just this one.
      Idempotent, and it preserves any global excludes file you already have.
      Note what it does *not* do: it guards file **names**, so it would not have
      stopped the Resend leak (a key inside a tracked `.example` file). Content
      scanning is the control for that.
- [ ] Third-party keys (Resend/SMTP, Sentry, Firebase) are supplied per
      environment via `.env.production` — which is gitignored — or the host's
      secret store, never via a file in the repo.
- [ ] On any suspected exposure: revoke at the provider **first**, then rotate,
      then clean the file. Deleting the line does not un-leak the value; assume
      anything that reached a push is compromised.

## Data

- [ ] Postgres and Mongo credentials not committed; least-privilege DB users where possible.
- [ ] Guest vs registered user permissions reviewed (`rejectGuest` on sensitive routes).

## Privacy

- [ ] Document what PII is stored (see product policy); support account deletion if promised.
