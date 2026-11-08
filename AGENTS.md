# Agent instructions (Borderfall)

This repo is **Borderfall**: a browser-based historical Risk-style game — React + Vite + TypeScript frontend (PixiJS 2D map, react-globe.gl globe, Zustand), **Fastify** + **Socket.io** backend, **PostgreSQL** (plain SQL through `pg`, no ORM) for users/games/state backups/**maps (JSONB)**, **Redis**, **JWT** access/refresh. Gameplay is **server-authoritative**; live game state is **Redis-authoritative** (per-process hot cache → Redis truth → debounced Postgres backups, per-game redlock) — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §Game state authority model.

## Where to read first

- **[README.md](README.md)** — setup, Docker, env, migrations, `seed:maps`, ports, architecture diagram.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — system ground truth (state model, resilience, workers, CI). Wins over any summary in this file.
- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** — every env var, feature flag, and port. **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)** — third-party connections.
- **[docs/CLAUDE.md](docs/CLAUDE.md)** — full **system prompt** for Claude (Console / Projects / API): paste that document’s “Paste-ready system prompt” block into custom instructions.

## Scripts (from repo root)

- `pnpm run test:backend` — backend Vitest tests.
- `pnpm run lint` — ESLint on backend and frontend (`lint:backend` + `lint:frontend`).
- `pnpm run validate:maps` — validate map JSON under `database/maps/`.
- `pnpm run test:e2e:smoke` — Playwright against the built frontend (`pnpm -C frontend run build` first; CI builds, then runs this and `test:e2e:map-visual`). Includes the map editor smoke, `frontend/tests/e2e/editor-smoke.spec.ts`.

## Balance harnesses (from `backend/`)

Headless, pure-engine simulators. No sockets, no database. Each seeds the AI
planner's jitter, which production leaves on `Math.random` — without that a
config's measured win rate moves ten points between runs and an A/B means
nothing.

- `pnpm exec tsx scripts/simFactionBalance.ts` — ranks an era's factions
  against each other with every seat the same AI and the faction-to-seat
  mapping rotated per game. `SIM_PATCH` measures a candidate kit before it is
  written; `SIM_DEAL=1` prints the opening allocation; `SIM_TRACE=1` prints
  territories held at turn 3/6/10, tiles lost and the turn each seat died,
  which is what separates "loses its fights" from "never takes anything".
- `pnpm exec tsx scripts/simCampaignStages.ts` — win rate per campaign stage
  for a fixed stand-in, plus a breakdown of how each side won. `SIM_HANDICAP=1`
  applies each stage's starting-unit modifier as the route does; `SIM_STAGES`
  narrows the sweep; the `SIM_DIFFICULTY` / `SIM_AI_COUNT` / `SIM_CLOCK` family
  asks "what if" without editing `campaignPaths.ts`, and `SIM_AI_FACTIONS`
  seats another line-up, which re-deals the board. `SIM_BY_SEAT=1` names the
  AI faction that won each game instead of pooling them. Every seat plays the live
  bot turn (`ai/runAiTurn.ts`); `SIM_AI_FLAGS` sets the stage AI's flags and
  `SIM_STANDIN_FLAGS` the stand-in's, so an AI flag is measured against a
  stand-in that does not move. Each stage prints a digest, as the arena does.
- `pnpm exec tsx scripts/simAiArena.ts` — bots against bots: one candidate
  seat against baseline seats, each side its own difficulty, AI flags
  (`ARENA_*_FLAGS`) and settings over its level's row in `AI_PROFILES`
  (`ARENA_*_PROFILE`), on the Quick Match maps or Full Game rules. It plays
  the live bot turn (`ai/runAiTurn.ts`), cards included, seeds every draw, and
  prints a digest per configuration: a change meant to leave the bots alone
  must leave it alone.

The first two rank configurations against each other. Their stand-in is a
medium bot, so the numbers do not predict what a person scores.

## Quick pointers

| Area | Path |
|------|------|
| Socket game | `backend/src/sockets/gameSocket.ts` |
| Room lifecycle / state authority | `backend/src/sockets/gameRoomManager.ts`, `redisGameStore.ts`, `gameLock.ts` |
| Game engine | `backend/src/game-engine/` |
| Daily challenge (schedule, simulation gate, set-piece library) | `backend/src/game-engine/daily/`, `backend/src/content/dailySetPieces.ts` — see ARCHITECTURE.md § Daily challenge |
| Game UI shell | `frontend/src/pages/GamePage.tsx` |
| 2D map | `frontend/src/components/game/GameMap.tsx` |
| Globe | `frontend/src/components/game/GlobeMap.tsx` |
| Globe geometry | `frontend/src/utils/globeTerritoryGeometry.ts` |
| Map editor (page, store with undo, panels, start screen) | `frontend/src/pages/MapEditorPage.tsx`, `frontend/src/store/mapEditorStore.ts`, `frontend/src/components/editor/` |
| Editor geography: Natural Earth templates, neighbours and sea lanes, provinces, camera | `frontend/src/components/editor/editorTemplates.ts`, `editorGeo.ts` (`cameraFit`), `editorProvinces.ts`; data under `frontend/public/geo/` |
| Map rules shared by editor and server (publish health, structure read) | `packages/shared/src/mapHealth.ts`, `packages/shared/src/mapStructure.ts`; parity test `backend/src/modules/maps/mapHealthParity.test.ts` |
| Map routes, moderation, balance report (bots in a worker thread), map of the week | `backend/src/modules/maps/maps.routes.ts`, `mapBalanceSim.ts` + `mapBalanceThread.ts`, `featuredMap.ts` |
| Editor funnel (Admin → Analytics card, funnel CLI) | `backend/src/services/analyticsQueries.ts` (`getEditorMetrics`), `frontend/src/components/admin/AdminAnalyticsPanel.tsx`, `backend/scripts/funnelReport.ts` |

## Rules of thumb

- Small, focused changes; match existing style; do not swap the stack without explicit user request.
- Maps and games both live in **PostgreSQL** — map geometry in the `maps` table (JSONB); game sessions in `games` / `game_states`. When debugging “map not found” vs “game not found,” distinguish HTTP map fetch from socket `game:join` and DB rows.
- Globe: respect **GeoJSON winding** and **`projection_bounds` / `geo_polygon`**; map data changes may affect **both** 2D and globe.
- Do not add new markdown docs unless the user asks.
- **Map editor:** the publish rules live in `@borderfall/shared` (`mapHealth.ts`) and run identically in the editor and on the server — change them there, and rebuild shared (`pnpm --filter @borderfall/shared build`) before frontend tests, which resolve the built `dist/`. Two flags, both ON with Admin → Config kill switches: `map_editor_enabled` (the editor and publishing) and `map_showcase_enabled` (map of the week, creator shelves, author links). Camera moves go through `cameraFit`: Oceania and Europe cross the antimeridian in Natural Earth, and a plain bounding box sends the camera to the wrong ocean.
- **Warfront** (experimental RTS mode) must never affect the live Borderfall game and is **admin-only until further notice** — see the isolation rule in [CLAUDE.md](CLAUDE.md) before touching anything under `packages/warfront-sim/`, `database/warfront/`, or any Warfront route.
- **0→1 feature work:** when the user asks to add a new building, tech, wonder, event card, faction ability, combat/economy rule, or any new gameplay capability, load and follow `.cursor/skills/feature-integration-playbook/SKILL.md` before touching code.
