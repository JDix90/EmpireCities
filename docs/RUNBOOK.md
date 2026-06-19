# Operations runbook — Borderfall

## Deploy (production)

1. **Backup** Postgres: `./scripts/backup-databases.sh`
2. **Pull** the release tag / commit on the app host.
3. **Configure** `.env.production` (see [DEPLOYMENT.md](../DEPLOYMENT.md) and `.env.production.example`).
4. **Deploy:** `./scripts/deploy-production.sh` (first time add `--seed`).
5. **Smoke:** `./scripts/smoke-production.sh https://your-domain` — checks `/health` and `/ready`.
6. **Rollback (app):** redeploy previous image; **do not** roll back migrations unless you have a tested down migration.

### Deploy key (private repo access)

The repo (`JDix90/EmpireCities`) is **private**, so the app host pulls it with a **read-only GitHub deploy key** — scoped to this one repo, no write access. One-time setup on the host:

1. **Generate a dedicated key:** `ssh-keygen -t ed25519 -C "borderfall-droplet-deploy" -f ~/.ssh/borderfall_deploy -N ""` (`-N ""` = no passphrase, so automated deploys never prompt).
2. **Add the public key** (`cat ~/.ssh/borderfall_deploy.pub`) at **GitHub → repo → Settings → Deploy keys → Add deploy key**. Leave **"Allow write access" unchecked** — that's what makes it read-only.
3. **Route GitHub SSH to the key** — append to `~/.ssh/config`, then `chmod 600 ~/.ssh/config ~/.ssh/borderfall_deploy`:
   ```
   Host github.com
     HostName github.com
     User git
     IdentityFile ~/.ssh/borderfall_deploy
     IdentitiesOnly yes
   ```
4. **Point the repo at the SSH remote:** `git remote set-url origin git@github.com:JDix90/EmpireCities.git`
5. **Verify:** `ssh -T git@github.com` (greets with the repo name) then `git fetch origin && git pull`.

A deploy key binds to **one repo**, so a host compromise exposes read-only access to just this repo and **cannot** push or reach anything else in the account. Remove any stale HTTPS token (`~/.git-credentials`) so the key is the only path in.

### Web launch sequence

1. **Staging** — same stack on a subdomain; run [LAUNCH_QA_SIGNOFF.md](LAUNCH_QA_SIGNOFF.md) gates A–G.
2. **Closed beta** — production domain, invite-only; monitor Sentry and `/ready`.
3. **Soft launch** — open registration; watch load and mobile UX.
4. **Public launch** — marketing; re-run Gate A before announce.

See [DEPLOYMENT.md](../DEPLOYMENT.md) for HTTPS (Caddy example: [docker/Caddyfile.example](../docker/Caddyfile.example)).

## Launch day — backups, load test, watch, rollback

**1. Fresh backup (on the host, before announce):**

```bash
./scripts/backup-databases.sh
ls -lh /var/backups/borderfall/                 # confirm a new postgres_*.dump exists
pg_restore -l /var/backups/borderfall/postgres_*.dump | head   # confirm it lists objects (not empty/corrupt)
```

Confirm the **daily job** is scheduled, e.g. `crontab -l | grep backup` — if missing, add:

```cron
0 4 * * * cd /path/to/repo && ./scripts/backup-databases.sh >> /var/log/borderfall-backup.log 2>&1
```

Backups land on the **same droplet** — if the droplet dies they die with it. For real durability, copy off-box (DO Spaces / `scp`) after each run.

**2. Quick load test** (read-only, safe against prod — see [scripts/loadtest.js](../scripts/loadtest.js)):

```bash
brew install k6                         # one binary
MAX_VUS=50 k6 run scripts/loadtest.js   # gentle first pass; raise MAX_VUS to find the ceiling
```

PASS = `http_req_failed` < 1% and `/ready` p95 in the low hundreds of ms. This only proves the proxy + backend + DB/Redis pools survive concurrent connections on the **single node** — it does not exercise gameplay/sockets. For that, script a guest→create-game scenario against **staging**.

**3. Watch during launch** (leave running in a terminal; pair with the Sentry dashboard):

```bash
./scripts/watch-health.sh               # prod, every 15s; rings the bell + flags streaks on non-200
```

`/ready` failing while `/health` is 200 ⇒ Postgres or Redis is unhealthy.

**4. Rollback (app).** Deploys build locally, so rollback = redeploy a previous commit. **Tag the known-good commit before you announce:**

```bash
git -C /path/to/repo rev-parse HEAD                  # note current good SHA
# if it goes wrong:
git checkout <previous-good-sha>
./scripts/deploy-production.sh                       # rebuilds the previous version
./scripts/smoke-production.sh https://borderfall.gg  # confirm /health + /ready
```

**Do not** roll back database migrations unless you have a tested down-migration — roll the app back, leave the schema. Rehearse this on **staging** (or as a tabletop with the exact SHAs in hand) before launch, not during an incident.

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
