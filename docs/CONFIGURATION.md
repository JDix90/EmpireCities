# Configuration Reference — Borderfall

> Every knob in one place. If a setting isn't here, check the source-of-truth files cited under each table — they win over this doc.
> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (what the systems do), [INTEGRATIONS.md](INTEGRATIONS.md) (third-party credentials in context), [docs index](README.md).

## Backend environment variables

> Source of truth: [backend/src/config/index.ts](../backend/src/config/index.ts) (defaults), [validateEnv.ts](../backend/src/config/validateEnv.ts) (production requirements). Verify with: `grep -rohE 'process\.env\.[A-Z0-9_]+' backend/src | sort -u`

### Core runtime

| Variable | Default | Prod-required | Effect |
|---|---|---|---|
| `NODE_ENV` | `development` | set to `production` | Gates CSP, cookie flags, error verbosity, metrics default |
| `PORT` | `3001` | — | Fastify + Socket.io listen port |
| `FRONTEND_URL` | `http://localhost:5173` | ✅ (non-localhost) | Public app origin: CORS primary, deep links, cookie Secure auto-detect |
| `CORS_ORIGINS` | — | as needed | Comma-separated extra origins (Capacitor app URL, staging). Dev auto-adds localhost:5173–5177 + capacitor/ionic |
| `REFRESH_COOKIE_SAME_SITE` | `lax` prod / `strict` dev | — | Refresh-cookie SameSite (`none` forces Secure) |
| `REFRESH_COOKIE_SECURE` | auto from `FRONTEND_URL` scheme | — | Override refresh-cookie Secure flag |
| `INSTANCE_ID` | OS hostname | — | Shown by `/api/instance` for multi-node debugging |

### Database & cache

| Variable | Default | Prod-required | Effect |
|---|---|---|---|
| `POSTGRES_HOST` / `POSTGRES_PORT` | `localhost` / `5432` | ✅ | Postgres connection (dev compose maps host port **5434**) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `chronouser` / `chronopass` / `borderfall` | ✅ (non-default password warned) | Credentials + database name |
| `PG_POOL_MAX` | `50` (floor 10) | — | pg pool size; raise behind PgBouncer / multi-instance |
| `PG_CONNECT_TIMEOUT_MS` | `15000` (floor 1000) | — | Connection-checkout wait. Was 2s; that turned creation-burst queueing into user-facing 500s (found by the load-test harness) |
| `PG_STATEMENT_TIMEOUT_MS` | `8000` (floor 500) | — | Per-statement cap so a runaway query can't pin a backend |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6379` / `chronoredis` | ✅ | Redis (authoritative live game state, locks, BullMQ, sessions, leaderboards) |

### Auth

| Variable | Default | Prod-required | Effect |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | dev placeholder | ✅ **boot fails on dev value** | Access-token signing key |
| `JWT_REFRESH_SECRET` | dev placeholder | ✅ **boot fails on dev value** | Refresh-token signing key |
| `JWT_ACCESS_EXPIRES_IN` | `1h` | — | Access TTL (guests get an explicit 4h token at creation) |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | — | Refresh TTL |
| `BCRYPT_ROUNDS` | `12` | — | Password hash cost (uniform for guests + registered) |

### Email, push, observability

| Variable | Default | Effect |
|---|---|---|
| `EMAIL_PROVIDER` | `smtp` | `resend_api` switches to HTTPS delivery via Resend (cloud hosts often block outbound SMTP) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — / `587` / — / — / `noreply@borderfall.com` | SMTP transport; `SMTP_PASS` doubles as the Resend key |
| `RESEND_API_KEY` | falls back to `SMTP_PASS` | Explicit Resend API key (takes precedence) |
| `FCM_SERVICE_ACCOUNT_PATH` | — | Path to Firebase Admin service-account JSON; enables server push |
| `SENTRY_DSN` | — | Backend error reporting (also whitelists the ingest host in CSP) |
| `CSP_EXTRA_CONNECT_ORIGINS` | — | Comma-separated https/wss origins added to CSP `connect-src` |
| `PASSWORD_RESET_DEV_LOG` | — | Non-prod: log reset URLs to stdout when SMTP is unconfigured |
| `UNSUBSCRIBE_TOKEN_SECRET` | falls back to `JWT_ACCESS_SECRET` | HMAC secret for one-click email-unsubscribe links (set it so JWT secret rotation doesn't invalidate links already in inboxes) |

## Feature flags

> Source of truth: [backend/src/config/featureFlags.ts](../backend/src/config/featureFlags.ts) → `FLAG_CODE_DEFAULTS`. Client-visible flags are served by `GET /api/feature-flags`.

**Precedence.** An `admin_config.feature_flags` entry wins; with no entry for that key, the code default below applies. The DB row means *"an operator is deliberately forcing this flag"* — it is the kill switch, nothing more, and `DEFAULTS.feature_flags` in `services/adminConfig.ts` is deliberately empty because anything seeded there would shadow a code default permanently.

Admin → Config shows each flag as **Default · on/off**, **Forced on**, or **Forced off**, and "Back to default" removes the override. Toggles write a *delta* (one key), so they never pin unrelated flags. If a flag ignores a code-default change, an old override is pinning it — preview and clear the redundant ones with:

```bash
pnpm -C backend exec tsx scripts/pruneFeatureFlagOverrides.ts          # preview
pnpm -C backend exec tsx scripts/pruneFeatureFlagOverrides.ts --apply  # write + invalidate caches
```

Env vars: a flag defaulting **on** is disabled with `X=false`; one defaulting **off** is enabled with `X=true`.

| Flag | Env var | Default | Effect |
|---|---|---|---|
| `analyticsEventsEnabled` | `ANALYTICS_EVENTS_ENABLED` | **on** (off under test) | Funnel/retention events → `analytics_events` + JSON log lines. Cohorts only accrue while this is live |
| `metricsEndpointEnabled` | `METRICS_ENDPOINT_ENABLED` | **on in dev, off in prod** | `GET /metrics/json` (room count, lock/persistence failure counters, memory) |
| `socketDebug` | `SOCKET_DEBUG` | off (dev-only) | Verbose Socket.io logging |
| `mapEditorEnabled` | `MAP_EDITOR_ENABLED` | off | Map Editor UI + custom-map publishing |
| `firstTurnCoachEnabled` | `FIRST_TURN_COACH_ENABLED` | **on** | Coached first turn for 0-XP players (globe, turn 1 only) |
| `turnClarityEnabled` | `TURN_CLARITY_ENABLED` | **on** | Phase-progression bar, valid source/target highlighting, reinforcement undo |
| `onboardingTutorialFirstEnabled` | `ONBOARDING_TUTORIAL_FIRST_ENABLED` | **on** | Landing "Play as Guest" goes straight into the tutorial match |
| `heroSingleCtaEnabled` | `HERO_SINGLE_CTA_ENABLED` | **on** | Landing hero collapses to one dominant Play CTA |
| `eraAdvancePayoffEnabled` | `ERA_ADVANCE_PAYOFF_ENABLED` | **on** | Celebratory modal on era advancement instead of a toast |
| `eraAdvancementLobbyEnabled` | `ERA_ADVANCEMENT_LOBBY_ENABLED` | **on** | Era Advancement setting + Full Game Start CTA in the lobby |
| `rankedEraAdvancementEnabled` | `RANKED_ERA_ADVANCEMENT_ENABLED` | off | Ranked matchmaking creates Era Advancement games (pending balance review) |
| `signupNudgeEnabled` | `SIGNUP_NUDGE_ENABLED` | **on** | One-time guest → create-account nudge after a finished game |
| `combinedTutorialEnabled` | `COMBINED_TUTORIAL_ENABLED` | **on** | Core tutorial runs as one continuous match on Tutorial Island with economy/tech/era advancement on — the player researches and advances an era instead of reading preview cards. Off returns *new* tutorials to the WW2 core lesson; in-flight games keep the shape they started with (`tutorial_combined` is snapshotted at creation) |
| `aiAttackGrindEnabled` | `AI_ATTACK_GRIND_ENABLED` | **on** | AI spends its per-turn attack budget as dice exchanges rather than distinct targets, so it can grind one territory until it falls (off, a 3+ unit garrison is uncapturable by the AI). Turn length is unchanged |
| `aiCaptureOddsEnabled` | `AI_CAPTURE_ODDS_ENABLED` | **on** | AI ranks attack candidates by exact capture probability fed with the real dice modifiers, instead of the legacy dice differential. Changes target choice only, never combat resolution |
| `aiDecidedGamePressEnabled` | `AI_DECIDED_GAME_PRESS_ENABLED` | **on** | An AI past 70% heuristic win probability doubles its exchange budget and attack cap to finish a decided game (never Easy/tutorial). Kill switch if the endgame press plays badly |
| `attackBlitzEnabled` | `ATTACK_BLITZ_ENABLED` | **on** | "Blitz until captured": one `game:attack_blitz` event resolves repeated exchanges server-side, emitted as one aggregated combat result. Land only, never breaks a truce, never in daily challenges |
| `retentionNotificationsEnabled` | `RETENTION_NOTIFICATIONS_ENABLED` | **on in production only** | Hourly re-engagement sweep: streak-at-risk push, daily-challenge reminder, D2/D7 win-back email. Never fires from dev/test unless the env var is set explicitly (see [RETENTION-PLAYBOOK.md](RETENTION-PLAYBOOK.md)) |
| `streakFreezesEnabled` | `STREAK_FREEZES_ENABLED` | off | Streak-freeze purchase + freeze state in Today/comeback panels (consuming a held freeze is never gated) |
| `todayPanelEnabled` | `TODAY_PANEL_ENABLED` | off | Lobby right column swaps to the unified Today panel |
| `asyncOnboardingEnabled` | `ASYNC_ONBOARDING_ENABLED` | off | Multi-day async nudges: post-tutorial "challenge a friend", Today-panel async row |
| `spectateEnabled` | `SPECTATE_ENABLED` | off | Watch/Spectate surface: Live nav + lobby Watch entries, `GET /api/games/live`, spectator socket joins. Off while player counts are low (an empty/stale live list reads worse than none) |
| `spaceAgeFrontiersEnabled` | `SPACE_AGE_FRONTIERS_ENABLED` | off | Standalone Space Age seeds the 8 authored frontier tiles (63-tile board instead of 55) |
| `rankedMultiSizeEnabled` | `RANKED_MULTI_SIZE_ENABLED` | off | Ranked opponents-count dropdown + multi-player cohort matching (off = strict 1v1) |
| `matchAlertsEnabled` | `MATCH_ALERTS_ENABLED` | off | Ranked match-found alerts: app-wide socket listener, OS notification, FCM push. Also the kill switch for the always-on per-tab websocket |

## Frontend environment variables

> Source of truth: [frontend/.env.example](../frontend/.env.example), [frontend/src/config/env.ts](../frontend/src/config/env.ts). Verify with: `grep -rohE '\bVITE_[A-Z0-9_]+' frontend/src | sort -u`
> ⚠️ **Build-time baking:** `VITE_*` values are inlined at `vite build`. Changing them requires a rebuild (the prod Dockerfile accepts them as build args). All are optional — the same-origin default (nginx proxying `/api` and `/socket.io`) needs none.

| Variable | Effect |
|---|---|
| `VITE_API_URL` | REST base when API is on another origin (default: same-origin `/api` via proxy) |
| `VITE_SOCKET_URL` | Socket.io origin (default: same-origin) |
| `VITE_SENTRY_DSN` | Frontend error reporting |
| `VITE_SUPPORT_EMAIL` | Contact shown on Privacy/Terms (default `support@borderfall.com`) |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY` | Web push (requires `firebase-messaging-sw.js`); native builds use Capacitor instead |
| `VITE_TENOR_API_KEY` | In-chat GIF search (feature hidden without it) |
| `VITE_TUTORIAL_V2` | Set `0` to fall back to the legacy tutorial (default: on) |

## Ports & networking

> Source of truth: [docker/docker-compose.yml](../docker/docker-compose.yml) (dev), [docker-compose.prod.yml](../docker/docker-compose.prod.yml), [frontend/vite.config.ts](../frontend/vite.config.ts). Verify with: `grep -hE '"[0-9]+:[0-9]+"' docker/docker-compose*.yml`

| Port | What | Notes |
|---|---|---|
| `3001` | Backend (Fastify + Socket.io) | Internal-only in prod (nginx proxies) |
| `5173` | Vite dev server | Proxies `/api/*` and `/socket.io/*` → `:3001`; falls back to 5174+ if busy |
| `5434 → 5432` | Dev Postgres (compose host mapping) | Prod compose uses the container network |
| `6379` | Redis | Dev and prod |
| `80/443` | nginx (prod) / Caddy (TLS, optional) | Serves SPA + proxies API/socket |

Health endpoints: `GET /health` (liveness), `GET /ready` (Postgres + Redis checks) — used by compose healthchecks, deploy script, and uptime monitors.

---

*Curated by hand — re-verify against the cited sources with `bash scripts/check-docs.sh` (see [docs index → Keeping docs accurate](README.md#keeping-docs-accurate)).*
