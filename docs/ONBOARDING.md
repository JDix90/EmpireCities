# Developer onboarding

## Prerequisites

- Node 22+, pnpm 9+
- Docker (optional): Postgres, MongoDB, Redis per `docker/docker-compose.yml`

## Setup

1. Clone the repo.
2. Copy `backend/.env.example` → `backend/.env` and set secrets (JWT, DB URLs).
3. From repo root: `pnpm install --frozen-lockfile`
4. Start databases (e.g. `pnpm run db:up` if using bundled compose).
5. `pnpm run db:migrate`
6. Optional: `pnpm run seed:maps` / project-specific seed scripts per README.

## Run locally

- **Full stack:** `pnpm run dev` (backend + frontend concurrently).
- **Backend only:** `pnpm run dev:backend`
- **Frontend only:** `pnpm run dev:frontend` (expects API on configured port).

## Checks (match CI)

```bash
pnpm -C packages/shared run build
pnpm exec eslint backend/src --max-warnings 0
pnpm run test:backend
pnpm -C frontend exec tsc --noEmit
pnpm -C frontend run build
pnpm run validate:maps
pnpm -C frontend run build && pnpm run test:e2e:smoke
```

## Environment variables (ops)

See `backend/.env.example` and `docs/RUNBOOK.md`. Notable:

- `ANALYTICS_EVENTS_ENABLED` — structured JSON analytics lines.
- `METRICS_ENDPOINT_ENABLED` — set to `false` to hide `GET /metrics/json`.
