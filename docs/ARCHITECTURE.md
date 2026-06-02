# Architecture — Borderfall (overview)

## High level

- **Browser client:** React (Vite), PixiJS 2D map, react-globe.gl 3D, Zustand, Socket.io client.
- **API:** Fastify (REST), JWT auth, rate limiting, cookie-based refresh.
- **Real-time:** Socket.io on the same Node HTTP server; game state held in memory per active room with periodic Postgres persistence (`game_states`).
- **Data:**
  - **PostgreSQL:** users, games, ratings, progression, daily challenges, **map documents** (`maps` / `map_ratings` JSONB), migrations metadata (`_migrations`).
  - **Redis:** sessions, caching (e.g. map cache), leaderboards, queues (BullMQ for async turn deadlines).

## Key backend modules

| Area | Location |
|------|----------|
| HTTP routes | `backend/src/modules/*/*.routes.ts` |
| Game socket | `backend/src/sockets/gameSocket.ts` (orchestration; extract handlers over time) |
| Daily puzzle helpers | `backend/src/sockets/dailyPuzzleSocket.ts`, `backend/src/game-engine/daily/*` |
| Rules engine | `backend/src/game-engine/**` |
| Workers | `backend/src/workers/asyncDeadlineWorker.ts` |

## Feature flags

See `backend/src/config/featureFlags.ts` (environment-driven; no UI toggle required for MVP).
