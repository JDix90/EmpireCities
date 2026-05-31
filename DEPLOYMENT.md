# Deploying Borderfall for friends (web)

This document implements the **staged release** plan: host the app on the internet so others can open a link, and keep it running without your Mac.

## Architecture (recommended for beta)

**Single VPS + Docker Compose** (implemented in [docker/docker-compose.prod.yml](docker/docker-compose.prod.yml)):

- **nginx** serves the Vite SPA and proxies `/api/*` and `/socket.io/*` to the Node backend (same browser origin — no `VITE_*` build args required).
- **Backend** (Fastify + Socket.io) — **one instance** only; game state is in-memory ([backend/src/sockets/gameSocket.ts](backend/src/sockets/gameSocket.ts)).
- **Postgres, MongoDB, Redis** as containers with named volumes (data survives container restarts).

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

## 2. Build and start the stack

From the **repository root**:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

- **Migrations** run automatically when the backend container starts (`docker/entrypoint-backend.sh`).
- **First-time data** (after Postgres + Mongo are up):

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production exec backend \
  sh -c "cd /app/backend && node dist/db/postgres/seed.js"

docker compose -f docker/docker-compose.prod.yml --env-file .env.production exec backend \
  sh -c "cd /app && pnpm exec tsx database/seedMaps.ts"
```

`seedMaps.ts` loads `MONGO_URI` from the environment (already set in Compose).

## 3. Verify

```bash
chmod +x scripts/smoke-production.sh
./scripts/smoke-production.sh http://YOUR_SERVER_IP
# or your HTTPS URL once TLS is in front
```

Open two browsers, register, create/join a game, confirm WebSocket connects (DevTools → Network → WS).

## 4. HTTPS

Terminating TLS **in front of** nginx (recommended):

- **Caddy** or **Traefik** with automatic Let’s Encrypt, reverse-proxy to `127.0.0.1:80` (or the `HTTP_PORT` you set).
- Or **Certbot** + nginx on the host (not inside the `web` container) — proxy to the container.

Update **`FRONTEND_URL`** to `https://…` after HTTPS is live.

## 5. Always-on / operations (Stage 2)

- **Restart policy:** Compose uses `restart: unless-stopped` so processes come back after reboot (with Docker enabled on boot).
- **Backups:** Schedule dumps of Postgres (`pg_dump`) and Mongo (`mongodump`) volumes or use managed DB backups.
- **Monitoring:** Poll `GET /health` (exposed via nginx at `/health`) from UptimeRobot, Better Stack, etc.
- **Deploys:** Restarting the **backend** clears **in-memory games**. Schedule deploys when no active playtests, or accept brief resets during beta.

## 6. Split frontend / API (optional)

If the SPA is on a different origin than the API:

1. Build the frontend with `VITE_API_URL` and `VITE_SOCKET_URL` pointing at the API origin (see [frontend/src/config/env.ts](frontend/src/config/env.ts)).
2. Set **`CORS_ORIGINS`** on the backend to include the static site origin.
3. If cookies must cross sites, review **`REFRESH_COOKIE_SAME_SITE`** and secure cookie settings.

## Database names (rebrand)

Default Postgres DB and Mongo database segment are `borderfall` / `borderfall_maps`. If you already run production on `erasofempire` or `chronoconquest` names, either keep those values in env (no data move) or migrate with `pg_dump` / `mongodump` as described in [README.md — Migrating from legacy database names](README.md#migrating-from-legacy-database-names).

## Troubleshooting

- **CORS errors:** `FRONTEND_URL` must equal the browser’s `Origin` (scheme + host + port).
- **WebSocket fails:** Ensure proxies pass `Upgrade` and `Connection` headers (see [docker/nginx.prod.conf](docker/nginx.prod.conf)).
- **Mongo URI:** Special characters in passwords must be URL-encoded in `MONGO_URI`.
