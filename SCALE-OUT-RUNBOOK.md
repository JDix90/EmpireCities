# Scale-Out Runbook — Borderfall multi-instance + marketing burst

This covers the **ops/infra steps** required to safely run Borderfall on multiple
backend instances and absorb a marketing burst (hundreds–thousands concurrent).
The application code is now multi-instance-safe (Tier 2); the steps below are the
host/infrastructure work that can't be done in the codebase and must be executed
on the deployment environment.

## What Tier 2 already fixed (scale-out is now SAFE in code)

- **Boot sweeps run on one node per tick** (Redis lease in `utils/singletonTask.ts`) — season, monthly-challenge, orphaned-game, and guest-cleanup sweeps no longer multiply or race across instances. (Matchmaking + the BullMQ timer workers intentionally still run everywhere; they're already cross-instance-safe.)
- **Season payout is idempotent** — atomic per-row `claimed_at` claim, so concurrent sweeps/retries can never double-grant gold.
- **Admin-config changes propagate across instances** via Redis pub/sub (no more divergent economy/matchmaking/XP/flags between nodes).
- **`game_states` snapshots are pruned** (batched retention, default 30 days) so the append-only table stops growing without bound.
- **Leaderboard `/top`** uses a shared cache + a `user_ratings(rating_type, mu DESC)` index.
- **Resilience**: `uncaughtException` → clean restart; graceful-shutdown hard timeout; Redis AOF persistence.

The remaining gates below are infrastructure execution.

---

## Pre-launch gates (do in order)

### Gate 1 — Redis high availability  ⚠️ biggest single fragility
Today a single Redis is a hard SPOF: every game action takes a Redis lock and writes state through Redis, so a Redis blip **freezes all live gameplay**, not just persistence.
- [ ] Run Redis as a **managed HA service with automatic failover** (ElastiCache, Upstash, or self-managed Sentinel/Cluster). Point `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` at it.
- [ ] Set **`--maxmemory`** to ~70–80% of the Redis instance's RAM **with `--maxmemory-policy noeviction`**. Never use an `lru`/`random` policy — it would evict live game-state keys and corrupt games. (AOF is already enabled in `docker-compose.prod.yml`.)
- [ ] Test a failover in staging and confirm the app reconnects without losing in-progress games (state is Redis-authoritative + Postgres-backed).

### Gate 2 — Per-service resource limits (host isolation)
Without limits, one runaway container can OOM the co-located Postgres/Redis/nginx.
- [ ] Set `mem_limit` (or `deploy.resources.limits.memory` under Swarm/k8s) on **every** service in `docker-compose.prod.yml`, sized to the host. Redis's limit must exceed its `--maxmemory` + overhead. The backend's working set (in-memory room cache + sockets) grows with concurrent games — watch `rss_bytes` from `/metrics/json` under load and size accordingly.
- [ ] If on k8s, add an HPA keyed on CPU/event-loop-lag.

### Gate 3 — Database migrations
- [ ] Confirm migrations `034_games_status_index` and `035_user_ratings_mu_index` applied (they run on backend start). Both are additive `CREATE INDEX IF NOT EXISTS` → **backward-compatible** (old code runs fine against the new schema), so a code rollback is safe.
- [ ] (Recommended for heavy burst) Put **PgBouncer** (transaction pooling) in front of Postgres and lower the app pool `max` — the Tier-1 review flagged the connection pool as the first thing to saturate under a creation burst.

### Gate 4 — Turn on multi-instance + smoke test
- [ ] Uncomment `backend_2` in `docker-compose.prod.yml` and the `ip_hash` directive + second `server` line in `docker/nginx.prod.conf`.
- [ ] Smoke test cross-instance correctness:
  - Two clients from **different IPs** (so `ip_hash` routes them to different backends) join the **same** game → moves, chat, and broadcasts work for both.
  - Change an admin config on one instance → reflected on the other within ~1s (pub/sub).
  - (Staging) Force a season rollover → gold is granted **exactly once** per player.
- [ ] Confirm sticky sessions: `ip_hash` pins each WebSocket to one node for its lifetime (required for the long-polling fallback).

### Gate 5 — Observability + alerting
Tier 1 exposed `/metrics/json` (`active_game_rooms`, `pg_pool` depth, `event_loop_lag_ms`, `ai_turns` queue) and enabled it in prod (`METRICS_ENDPOINT_ENABLED=true`, proxy-internal).
- [ ] Scrape `/metrics/json` into a dashboard (Prometheus/Grafana/hosted).
- [ ] Add **external alerting** (not in code): uptime check on `/ready` → SMS/Slack; Sentry alert on error-rate + new issues; alerts on `pg_pool.waiting` climbing, high `event_loop_lag_ms`, Redis/Postgres down.
- [ ] Set `SENTRY_DSN`.

### Gate 6 — Load test to find the real ceiling
- [ ] Run `scripts/loadTestSoloBurst.ts` against staging at increasing concurrency; find where p99 latency / `pg_pool.waiting` / `event_loop_lag_ms` degrade. That number is your **per-node capacity** — size the instance count and the marketing ramp to it.
- [ ] Confirm Tier-1's admission-control 429s and AI worker cap engage under overload (graceful shedding, not hangs).

### Gate 7 — Deploy + rollback
- [ ] Tag the last-known-good backend image before deploying (`docker tag … borderfall-backend:last-good`). Rollback = retag + `up -d` (fast), **not** a rebuild.
- [ ] Prefer a **rolling deploy** with ≥2 instances behind nginx so a deploy doesn't drop every WebSocket at once.
- [ ] Pre-flight: confirm no destructive migration is pending (current ones are additive indexes → safe).

---

## Marketing ramp
Start with spend capped to the load-tested per-node ceiling × instance count, watch the dashboards, scale instances to demand, **then** open the bursty/high-volume channels.

## Still open (future work / explicit decisions)
- **PgBouncer** in front of Postgres (recommended before a true thousands-concurrent burst).
- **Weekly-challenge server-authoritative scoring** (product decision — currently client-reported with bounds).
- **Autoscaling automation** (manual instance scaling until then).
