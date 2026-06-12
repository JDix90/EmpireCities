# Agent instructions (Borderfall)

This repo is **Borderfall**: a browser-based historical Risk-style game — React + Vite + TypeScript frontend (PixiJS 2D map, react-globe.gl globe, Zustand), **Fastify** + **Socket.io** backend, **PostgreSQL** (Drizzle) for users/games/state backups/**maps (JSONB)**, **Redis**, **JWT** access/refresh. Gameplay is **server-authoritative**; live game state is **Redis-authoritative** (per-process hot cache → Redis truth → debounced Postgres backups, per-game redlock) — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §Game state authority model.

## Where to read first

- **[README.md](README.md)** — setup, Docker, env, migrations, `seed:maps`, ports, architecture diagram.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — system ground truth (state model, resilience, workers, CI). Wins over any summary in this file.
- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** — every env var, feature flag, and port. **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)** — third-party connections.
- **[docs/CLAUDE.md](docs/CLAUDE.md)** — full **system prompt** for Claude (Console / Projects / API): paste that document’s “Paste-ready system prompt” block into custom instructions.

## Scripts (from repo root)

- `pnpm run test:backend` — backend Vitest tests.
- `pnpm run lint` — ESLint on backend and frontend (`lint:backend` + `lint:frontend`).
- `pnpm run validate:maps` — validate map JSON under `database/maps/`.

## Quick pointers

| Area | Path |
|------|------|
| Socket game | `backend/src/sockets/gameSocket.ts` |
| Room lifecycle / state authority | `backend/src/sockets/gameRoomManager.ts`, `redisGameStore.ts`, `gameLock.ts` |
| Game engine | `backend/src/game-engine/` |
| Game UI shell | `frontend/src/pages/GamePage.tsx` |
| 2D map | `frontend/src/components/game/GameMap.tsx` |
| Globe | `frontend/src/components/game/GlobeMap.tsx` |
| Globe geometry | `frontend/src/utils/globeTerritoryGeometry.ts` |

## Rules of thumb

- Small, focused changes; match existing style; do not swap the stack without explicit user request.
- Maps and games both live in **PostgreSQL** — map geometry in the `maps` table (JSONB); game sessions in `games` / `game_states`. When debugging “map not found” vs “game not found,” distinguish HTTP map fetch from socket `game:join` and DB rows.
- Globe: respect **GeoJSON winding** and **`projection_bounds` / `geo_polygon`**; map data changes may affect **both** 2D and globe.
- Do not add new markdown docs unless the user asks.
- **0→1 feature work:** when the user asks to add a new building, tech, wonder, event card, faction ability, combat/economy rule, or any new gameplay capability, load and follow `.cursor/skills/feature-integration-playbook/SKILL.md` before touching code.
