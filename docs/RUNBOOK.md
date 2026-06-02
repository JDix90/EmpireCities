# Operations runbook — Borderfall

## Deploy (production)

1. **Backup** Postgres: `./scripts/backup-databases.sh`
2. **Pull** the release tag / commit on the app host.
3. **Configure** `.env.production` (see [DEPLOYMENT.md](../DEPLOYMENT.md) and `.env.production.example`).
4. **Deploy:** `./scripts/deploy-production.sh` (first time add `--seed`).
5. **Smoke:** `./scripts/smoke-production.sh https://your-domain` — checks `/health` and `/ready`.
6. **Rollback (app):** redeploy previous image; **do not** roll back migrations unless you have a tested down migration.

### Web launch sequence

1. **Staging** — same stack on a subdomain; run [LAUNCH_QA_SIGNOFF.md](LAUNCH_QA_SIGNOFF.md) gates A–G.
2. **Closed beta** — production domain, invite-only; monitor Sentry and `/ready`.
3. **Soft launch** — open registration; watch load and mobile UX.
4. **Public launch** — marketing; re-run Gate A before announce.

See [DEPLOYMENT.md](../DEPLOYMENT.md) for HTTPS (Caddy example: [docker/Caddyfile.example](../docker/Caddyfile.example)).

## Health vs readiness

| Route | Meaning |
|-------|---------|
| `GET /health` | Process is up (does not verify databases). |
| `GET /ready` | Postgres and Redis respond — use for load balancer readiness. |
| `GET /metrics/json` | Process metrics (`METRICS_ENDPOINT_ENABLED=false` to disable). |

## Structured analytics (optional)

Set `ANALYTICS_EVENTS_ENABLED=true` to emit JSON lines for events such as `daily_challenge_settled` (see `backend/src/services/analyticsEvents.ts`). Forward logs to your analytics or warehouse pipeline.

## Incident checklist

1. Check Sentry / logs for `game_id` or `reqId`.
2. Verify `/ready` per dependency.
3. Redis down → sessions/cache degraded; Postgres down → API and map fetch unavailable.
