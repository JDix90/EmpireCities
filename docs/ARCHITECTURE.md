# Architecture — Borderfall

> Last verified: 2026-06-13 against `721acd8`.
> Scope: **how the system works.** Setup lives in the [root README](../README.md), ops procedures in [OPERATIONS.md](OPERATIONS.md) / [RUNBOOK.md](RUNBOOK.md), every config knob in [CONFIGURATION.md](CONFIGURATION.md), external services in [INTEGRATIONS.md](INTEGRATIONS.md).

## System topology

```
┌────────────────────────── Browser / Capacitor WebView ──────────────────────────┐
│ React 18 + Vite · Zustand stores · PixiJS 7 (2D map) · react-globe.gl/Three (3D)│
│ socket.io-client (websocket transport) · axios (+ JWT refresh interceptor)      │
└─────────────┬──────────────────────────────┬────────────────────────────────────┘
              │ REST /api/*                  │ WebSocket /socket.io
┌─────────────▼──────────────────────────────▼─────────────┐    ┌─────────────────┐
│      Fastify 4 + Socket.io 4 — one Node process, :3001   │───▶│ Third parties:  │
│ modules/*/*.routes.ts (REST) · sockets/gameSocket.ts (RT)│    │ Sentry, FCM,    │
│ game-engine/** (rules) · workers/** (BullMQ) · sweeps    │    │ SMTP/Resend     │
└──────┬─────────────────────────────┬──────────────────────┘   │ (INTEGRATIONS)  │
       │                             │                          └─────────────────┘
┌──────▼──────────┐         ┌────────▼─────────┐    Browser also pulls from CDN:
│ PostgreSQL 16   │         │ Redis 7          │    jsDelivr (globe textures,
│ users/games/    │         │ AUTHORITATIVE    │    Natural Earth geojson), Tenor.
│ ratings/maps    │         │ live game state, │
│ (JSONB) + state │         │ locks, queues,   │
│ backups         │         │ sessions, boards │
└─────────────────┘         └──────────────────┘
```

Monorepo (pnpm workspaces): `frontend/` (SPA), `backend/` (API + realtime), `packages/shared/` (types shared across both — `GamePhase`, map types), `database/` (SQL migrations + seeds + map documents), `docker/` (dev + prod compose), `scripts/` (ops).

## Game state authority model

**Live game state is Redis-authoritative.** The chain, from hottest to coldest:

1. **Per-process hot cache** (`roomCache` in [backend/src/sockets/gameRoomManager.ts](../backend/src/sockets/gameRoomManager.ts)) — a convenience layer only; never trusted over Redis.
2. **Redis** — the source of truth for in-flight games (`game:<id>:state`, `game:<id>:map`, 7-day TTL refreshed on activity; see [backend/src/sockets/redisGameStore.ts](../backend/src/sockets/redisGameStore.ts)). Every mutation runs under a **per-game redlock** ([backend/src/sockets/gameLock.ts](../backend/src/sockets/gameLock.ts)) and persists to Redis immediately on completion.
3. **Postgres `game_states`** — debounced backups (~800ms after each mutation; immediate flush on game over/leave/shutdown). Restart-safe cold storage and the recovery layer of last resort.

> ⚠️ **Older docs said "in-memory game state with Postgres snapshots."** That model was replaced by the Redis migration (Phases 5–8 — see the header comment in `gameRoomManager.ts`). A backend restart no longer loses live games: state reloads from Redis, and timer jobs survive in BullMQ.

Turn timers and async deadlines are **BullMQ jobs** in Redis ([backend/src/workers/gameTimerWorker.ts](../backend/src/workers/gameTimerWorker.ts), [asyncDeadlineWorker.ts](../backend/src/workers/asyncDeadlineWorker.ts)) — they fire even if the process that armed them died. The server stamps `phase_deadline_at` into game state so clients render a server-authoritative countdown.

Gameplay is **server-authoritative**: clients emit intents (`game:attack`, `game:draft`, …); all validation, dice, and state mutation happen server-side inside the lock; clients receive `game:state` broadcasts (fog-of-war filtered per viewer by `buildClientState`).

## Connection resilience

Layered so no single failure ejects a player or kills other games:

- **Room self-heal** — when Redis and the hot cache both miss, `loadAuthoritativeRoom` looks up the game's `map_id` in Postgres and restores the room from the latest backup (in-progress games only). Any action path can recover, not just `game:join`. ([gameRoomManager.ts](../backend/src/sockets/gameRoomManager.ts))
- **Cancellable eviction** — the "no humans connected for 5 minutes" eviction timers are tracked per game and cancelled by any `game:join`; the final check trusts live socket.io room membership over presence sets. ([backend/src/sockets/evictionTimers.ts](../backend/src/sockets/evictionTimers.ts))
- **AI-turn crash-proofing** — AI turns are fire-and-forget; they catch instead of leaking unhandled rejections, and a global `unhandledRejection` handler in [backend/src/index.ts](../backend/src/index.ts) backstops everything else.
- **Client resync** — on a mid-game `GAME_NOT_FOUND` the client silently re-emits `game:join` (the actual repair) and only gives up on `GAME_DELETED` or a repeat failure after a successful repair. ([frontend/src/utils/gameNotFoundTracker.ts](../frontend/src/utils/gameNotFoundTracker.ts))
- **Deploy-safe auth** — token refresh classifies *unreachable* (network/5xx: keep session, retry with backoff) separately from *invalid* (401/403: log out). A backend restart never logs players out. ([frontend/src/store/authStore.ts](../frontend/src/store/authStore.ts))
- **Timer re-arm on join** — a rejoin restores a lost BullMQ turn-timeout from the surviving deadline without granting extra clock. ([backend/src/sockets/turnTimerRearm.ts](../backend/src/sockets/turnTimerRearm.ts))

## Auth & accounts

- **JWT access token** (1h, memory-only on the client) + **HttpOnly refresh cookie** (7d, rotated in a Postgres transaction with replay protection). See [backend/src/modules/auth/auth.routes.ts](../backend/src/modules/auth/auth.routes.ts).
- **Guests** (`POST /api/auth/guest`): real `users` rows (`is_guest=true`, `<uuid>@guest.local`), same refresh-cookie session as registered users, swept after 48h only if they never joined a game.
- **In-place upgrade** (`POST /api/auth/upgrade`): converts the guest's existing row (username/email/password, `is_guest=false`) — same `user_id`, so XP/level/streaks/ratings/achievements carry over with zero migration.
- **Guest rating redaction**: Glicko ratings are computed and stored for guests but redacted from `game:over` payloads and `/users/me` (`redactGuestRatings` in [statsManager.ts](../backend/src/game-engine/state/statsManager.ts)) — competitive numbers are a registered-account feature; they surface at upgrade.
- The `guest` JWT claim gates ~34 routes via `rejectGuest` middleware; refresh rotation re-reads `is_guest` from the DB so upgrades take effect without re-login.

## Background work

| Worker / sweep | File | Trigger | Purpose |
|---|---|---|---|
| Turn timer | `backend/src/workers/gameTimerWorker.ts` | BullMQ queue `game-turn-timer` | Real-time turn/phase timeouts |
| Async deadline | `backend/src/workers/asyncDeadlineWorker.ts` | BullMQ queue `async-deadlines` | 12h/24h/72h async-game deadlines |
| Matchmaking | `backend/src/modules/matchmaking/matchmaking.routes.ts` | every 5s | Pair ranked-queue players, create games |
| Season | `backend/src/game-engine/progression/seasonService.ts` | hourly | 90-day seasons + reward distribution |
| Monthly challenges | `backend/src/game-engine/progression/challengeService.ts` | hourly | Ensure current month's challenges exist |
| Orphaned games | `backend/src/modules/games/gameCleanupService.ts` | every 15m | Delete human-less games idle >4h |
| Guest cleanup | `backend/src/modules/users/guestCleanupService.ts` | every 6h | Delete >48h-old guests with no games |

All are started near the end of `bootstrap()` and stopped on SIGTERM/SIGINT.

## Boot order

From [backend/src/index.ts](../backend/src/index.ts): `validateProductionEnv` (fails fast on dev secrets in prod) → Sentry init → global `unhandledRejection` backstop → Postgres connect → Redis connect → Fastify + plugins (helmet/CSP, CORS, cookies, rate limits — see [CONFIGURATION.md](CONFIGURATION.md)) → route modules → Socket.io init → workers & sweeps → admin-config cache → daily-puzzle ensure → listen on `:3001` → graceful-shutdown handlers.

## Data model overview

- **Postgres** (32 migrations in [database/migrations/](../database/migrations)): `users` (identity + progression columns: xp/level/gold/streaks/`is_guest`), `games`/`game_players` (lobby + results), `game_states` (state backups), `user_ratings` (Glicko-2 `mu/phi/sigma` per `solo|ranked`), `refresh_tokens` (rotation), `maps`/`map_ratings` (**map documents as JSONB** — migrated from MongoDB), achievements/cosmetics/quests/seasons, `admin_config` (feature-flag overrides).
- **Redis key families**: `game:<id>:{state,map,connected,ai-flight,lock}`, BullMQ queues, sessions, `leaderboard:<era>` sorted sets.
- **Maps vs games**: map *documents* (territories, connections, geo data) live in Postgres JSONB and are seeded by `pnpm run seed:maps`; game *state* references a `map_id`. Map authoring: [database/maps/MAP_CREATION.md](../database/maps/MAP_CREATION.md).
- Glicko ratings: display = `round(mu)`, provisional while `phi > 150`. Solo games rate against synthetic AI opponents (wins only — losses can't farm AI padding).

## Repo layout & dependency groups

> Source of truth: each workspace's `package.json`. Versions below are the heavy hitters only.

**frontend** — React 18 / react-router 6 / Zustand 4 (UI & state) · PixiJS 7 + @pixi/react (2D map) · three + react-globe.gl 2.x (3D globe) · @turf/* + polyclip-ts (geo math) · socket.io-client 4 / axios (network) · firebase 12 + @capacitor/* (push & native) · @sentry/react · recharts, lucide-react, react-hot-toast, emoji-mart (UI bits).

**backend** — fastify 4 + @fastify/{cors,cookie,helmet,rate-limit} · socket.io 4 + @socket.io/redis-adapter · pg 8 (Postgres) · ioredis 5 · bullmq 5 (queues) · redlock (per-game locks) · jsonwebtoken / bcryptjs / zod / zxcvbn (auth & validation) · nodemailer + firebase-admin (email & push) · @sentry/node · pino.

**packages/shared** — types only (`GamePhase`, map/world types); no runtime deps. Built before either app (`pnpm -C packages/shared run build`).

## CI & testing

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every PR and push to `main` (branch protection requires both jobs):

- **backend job** — Redis 7 service container; shared build → `tsc` → full vitest suite with `REDIS_TEST=1` (enables the real-Redis integration tier in `redisGameStore.test.ts`) → `validate:maps` → ESLint.
- **frontend job** — shared build → `tsc` → ESLint → vitest → production build → Playwright (`chromium-smoke` + `chromium-map-visual` against `vite preview`).

Other test surfaces: Playwright projects `mobile-safari-size` (iPhone 13 / WebKit) and `chromium-mobile-touch` (Pixel 5 tap regression) run locally via `npx playwright test`. **Load testing**: `pnpm -C backend exec tsx scripts/loadTestSoloBurst.ts [games] [turns]` spins up N concurrent guest quick-matches over real sockets and reports latency percentiles + lock/persistence failure deltas from `/metrics/json` — run it against a local stack before capacity-sensitive changes.

## Key code paths quick reference

| Area | Location |
|---|---|
| HTTP routes | `backend/src/modules/*/*.routes.ts` |
| Game socket orchestration | `backend/src/sockets/gameSocket.ts` |
| Room lifecycle / state authority | `backend/src/sockets/gameRoomManager.ts`, `redisGameStore.ts`, `gameLock.ts` |
| Rules engine | `backend/src/game-engine/**` (state, combat, eras, events, ai, rating, progression, …) |
| Workers | `backend/src/workers/` |
| Health/readiness | `GET /health`, `GET /ready` (`backend/src/health/readiness.ts`) |
| Client game page | `frontend/src/pages/GamePage.tsx` (socket wiring) |
| Map renderers | `frontend/src/components/game/GameMap.tsx` (2D PIXI), `GlobeMap.tsx` (3D) |
| Client stores | `frontend/src/store/{authStore,gameStore}.ts` |
| Shared phase labels | `frontend/src/constants/phaseLabels.ts` (one label set: desktop, mobile, tutorial) |
