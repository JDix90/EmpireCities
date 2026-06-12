# Deploying Borderfall for friends (web)

This document implements the **staged release** plan: host the app on the internet so others can open a link, and keep it running without your Mac.

## Architecture (recommended for beta)

**Single VPS + Docker Compose** (implemented in [docker/docker-compose.prod.yml](docker/docker-compose.prod.yml)):

- **nginx** serves the Vite SPA and proxies `/api/*` and `/socket.io/*` to the Node backend (same browser origin — no `VITE_*` build args required).
- **Backend** (Fastify + Socket.io) — **one instance** in this stack. Live game state is Redis-authoritative with per-game redlocks ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), so multi-instance is architecturally possible, but single-instance keeps ops simple for beta.
- **Postgres, Redis** as containers with named volumes (data survives container restarts).

**Alternative:** Managed databases (Neon, Atlas, Upstash) + backend on Railway/Render/Fly + static frontend on Netlify/Vercel. Set `VITE_API_URL` and `VITE_SOCKET_URL` at frontend build time ([frontend/src/config/env.ts](frontend/src/config/env.ts)) and set `FRONTEND_URL` / `CORS_ORIGINS` on the backend ([backend/src/config/index.ts](backend/src/config/index.ts)).

## Prerequisites

- Docker Engine + Docker Compose v2 (or compatible).
- A server with a public IP or DNS (for HTTPS, use Caddy, Certbot, or your cloud’s TLS).
- Strong secrets: never commit `.env.production`.

## 1. Configure environment

```bash
cp .env.production.example .env.production
```

Edit `.env.production`:

- **`FRONTEND_URL`** — Must match the exact origin users use (`https://your.domain` or `http://ip:port`). CORS and Socket.io rely on this.
- **`JWT_ACCESS_SECRET`** / **`JWT_REFRESH_SECRET`** — Use long random values (e.g. `openssl rand -hex 32`).
- Database passwords — change defaults.
- **`SENTRY_DSN`** / **`VITE_SENTRY_DSN`** — Optional but recommended for production error monitoring.
- **`SMTP_*`** — Recommended for password reset and async turn emails (`SMTP_FROM` on your domain).

## 2. Build and start the stack

From the **repository root** (helper script):

```bash
chmod +x scripts/deploy-production.sh scripts/seed-production.sh scripts/backup-databases.sh
./scripts/deploy-production.sh --seed
```

Or manually:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

- **Migrations** run automatically when the backend container starts (`docker/entrypoint-backend.sh`).
- **First-time data** (after Postgres is up):

```bash
./scripts/seed-production.sh
```

## 3. Verify

```bash
chmod +x scripts/smoke-production.sh
./scripts/smoke-production.sh http://YOUR_SERVER_IP
# or your HTTPS URL once TLS is in front
```

Open two browsers, register, create/join a game, confirm WebSocket connects (DevTools → Network → WS).

## 4. HTTPS

Terminating TLS **in front of** nginx (recommended):

- **Caddy** — see [docker/Caddyfile.example](docker/Caddyfile.example) for a minimal reverse-proxy config.
- **Traefik** or **Certbot** + nginx on the host — proxy to `127.0.0.1:80` (or the `HTTP_PORT` you set).

Update **`FRONTEND_URL`** to `https://…` after HTTPS is live.

### Staging before public launch

1. Deploy to a subdomain (e.g. `staging.your-domain.com`) with the same Compose stack.
2. Run the QA gates in [docs/LAUNCH_QA_SIGNOFF.md](docs/LAUNCH_QA_SIGNOFF.md).
3. Closed beta on production domain (invite-only) → soft launch → public launch.

## 5. Always-on / operations (Stage 2)

- **Restart policy:** Compose uses `restart: unless-stopped` so processes come back after reboot (with Docker enabled on boot).
- **Backups:** `./scripts/backup-databases.sh` (targets `borderfall_postgres_prod`). Schedule with `./scripts/setup-backup-cron.sh`.
- **Monitoring:** Poll `GET /health` and `GET /ready` from UptimeRobot, Better Stack, etc.
- **Deploys:** `./scripts/deploy-production.sh` — backend restarts do **not** lose live games (state reloads from Redis; turn timers survive in BullMQ; clients resync automatically — see [docs/OPERATIONS.md](docs/OPERATIONS.md)). Players see a brief reconnect, nothing more.
- **QA sign-off:** [docs/LAUNCH_QA_SIGNOFF.md](docs/LAUNCH_QA_SIGNOFF.md) before each go-live.

## 6. Split frontend / API (optional)

If the SPA is on a different origin than the API:

1. Build the frontend with `VITE_API_URL` and `VITE_SOCKET_URL` pointing at the API origin (see [frontend/src/config/env.ts](frontend/src/config/env.ts)).
2. Set **`CORS_ORIGINS`** on the backend to include the static site origin.
3. If cookies must cross sites, review **`REFRESH_COOKIE_SAME_SITE`** and secure cookie settings.

## Database names (rebrand)

Default Postgres DB is `borderfall`. If you already run production on `erasofempire` or `chronoconquest` names, either keep those values in env (no data move) or migrate with `pg_dump` / `pg_restore` as described in [README.md — Migrating from legacy database names](README.md#migrating-from-legacy-database-names). Maps that lived in MongoDB must be copied once with `pnpm run migrate:maps-from-mongo` before decommissioning the old Mongo container.

## Troubleshooting

- **CORS errors:** `FRONTEND_URL` must equal the browser’s `Origin` (scheme + host + port).
- **WebSocket fails:** Ensure proxies pass `Upgrade` and `Connection` headers (see [docker/nginx.prod.conf](docker/nginx.prod.conf)).
- **Maps missing after deploy:** Run `./scripts/seed-production.sh` or `pnpm run seed:maps` after migration `028_maps_postgres.sql` is applied.
