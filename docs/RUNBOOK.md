# Operations runbook — Borderfall

## Deploy (production)

1. **Backup** Postgres (and Mongo if map data is mutable in your process).
2. **Pull** the release tag / commit on the app host.
3. **Install** dependencies: `pnpm install --frozen-lockfile` at repo root.
4. **Build** shared + backend + frontend: `pnpm run build`.
5. **Migrate** Postgres: `pnpm run db:migrate` (runs `backend` migrate script; records filenames in `_migrations`).
6. **Restart** the Node process (Docker Compose, systemd, or your orchestrator).
7. **Smoke:** `GET /health` → `200`; `GET /ready` → `200` when Postgres, MongoDB, and Redis are reachable.
8. **Rollback (app):** redeploy previous image; **do not** roll back migrations unless you have a tested down migration.

## Health vs readiness

| Route | Meaning |
|-------|---------|
| `GET /health` | Process is up (does not verify databases). |
| `GET /ready` | Postgres, MongoDB, and Redis respond — use for load balancer readiness. |
| `GET /metrics/json` | Process metrics (`METRICS_ENDPOINT_ENABLED=false` to disable). |

## Structured analytics (optional)

Set `ANALYTICS_EVENTS_ENABLED=true` to emit JSON lines for events such as `daily_challenge_settled` (see `backend/src/services/analyticsEvents.ts`). Forward logs to your analytics or warehouse pipeline.

## Incident checklist

1. Check Sentry / logs for `game_id` or `reqId`.
2. Verify `/ready` per dependency.
3. Redis down → sessions/cache degraded; Mongo down → map fetch may fail; Postgres down → API unavailable.
