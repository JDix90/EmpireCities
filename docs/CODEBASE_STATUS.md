# Codebase status vs common code-review assumptions

External reviews sometimes assume an early stub. The following are **already implemented** in this repository (verify in source if upgrading):

| Topic | Location |
|-------|----------|
| Socket.IO JWT on connect | `backend/src/sockets/gameSocket.ts` — `io.use` + `verifyAccessToken` |
| Phase checks (draft / attack / fortify) | Same file — handlers reject wrong phase |
| Adjacency before combat | Same file — `map.connections` undirected check |
| Fog-of-war filtered `game:state` | Same file — `buildClientState` per socket |
| Refresh token storage and rotation | `backend/src/modules/auth/auth.routes.ts` — `refresh_tokens` table |
| CORS allowlist | `backend/src/index.ts` — not `*` |
| Global HTTP rate limit | `backend/src/index.ts` — `@fastify/rate-limit` |
| Docker healthchecks and named volumes | `docker/docker-compose.yml` |

**Tests:** From repo root, `pnpm run test:backend` (Vitest). Map connection JSON validation: `pnpm run validate:maps` (undirected edges, unique pairs).

See also [README.md](../README.md) for setup and [AGENTS.md](../AGENTS.md) for agent orientation.
