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
| `EMBED_ORIGINS` | — | when embedded by a portal | Comma-separated portal origins (`*.` = subdomains only) that receive a `Partitioned; SameSite=None` refresh cookie so the game keeps its session inside their iframe. Generated from `docker/portals.json` — see [PORTALS.md](PORTALS.md) |
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
| `FCM_SERVICE_ACCOUNT_PATH` | — | Path to Firebase Admin service-account JSON; enables server push. In the prod compose stack this is the path **inside** the backend container: the host directory `/etc/borderfall/secrets` is bind-mounted read-only at `/run/secrets/borderfall`, so the value is `/run/secrets/borderfall/service-account-fcm.json` |
| `SENTRY_DSN` | — | Backend error reporting (also whitelists the ingest host in CSP) |
| `SENTRY_RELEASE` | — | The release Sentry files reports under, normally the deployed commit; read by the Sentry SDK itself. `scripts/deploy-production.sh` sets it, and `docker-compose.prod.yml` bakes it into the backend image and the frontend build (`VITE_SENTRY_RELEASE`). Without it Sentry keeps no crash-free session data |
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
| `mapEditorEnabled` | `MAP_EDITOR_ENABLED` | **on** | Map Editor UI + custom-map publishing (draft → review → approve pipeline; kill switch in Admin → Config) |
| `firstTurnCoachEnabled` | `FIRST_TURN_COACH_ENABLED` | **on** | Coached first turn for 0-XP players (globe, turn 1 only) |
| `turnClarityEnabled` | `TURN_CLARITY_ENABLED` | **on** | Phase-progression bar, valid source/target highlighting, reinforcement undo |
| `onboardingTutorialFirstEnabled` | `ONBOARDING_TUTORIAL_FIRST_ENABLED` | **on** | Landing "Play as Guest" goes straight into the tutorial match |
| `heroSingleCtaEnabled` | `HERO_SINGLE_CTA_ENABLED` | **on** | Landing hero collapses to one dominant Play CTA |
| `eraAdvancePayoffEnabled` | `ERA_ADVANCE_PAYOFF_ENABLED` | **on** | Celebratory modal on era advancement instead of a toast |
| `eraAdvancementLobbyEnabled` | `ERA_ADVANCEMENT_LOBBY_ENABLED` | **on** | Era Advancement setting + Full Game Start CTA in the lobby |
| `rankedEraAdvancementEnabled` | `RANKED_ERA_ADVANCEMENT_ENABLED` | off | Ranked matchmaking creates Era Advancement games (pending balance review) |
| `signupNudgeEnabled` | `SIGNUP_NUDGE_ENABLED` | **on** | One-time guest → create-account nudge after a finished game |
| `referralSurveyEnabled` | `REFERRAL_SURVEY_ENABLED` | off | One-time "how did you hear about us?" prompt after a finished game. The only attribution signal that sees assistants which send no referrer — those otherwise count as Direct |
| `indexNowEnabled` | `INDEXNOW_ENABLED` | off | Announce each settled Daily archive page to IndexNow (Bing et al.) rather than waiting for a sitemap re-crawl. Needs `INDEXNOW_KEY` and the matching key file served at the site root |
| `aiAttackGrindEnabled` | `AI_ATTACK_GRIND_ENABLED` | **on** | AI spends its per-turn attack budget as dice exchanges rather than distinct targets, so it can grind one territory until it falls (off, a 3+ unit garrison is uncapturable by the AI). Turn length is unchanged |
| `aiCaptureOddsEnabled` | `AI_CAPTURE_ODDS_ENABLED` | **on** | AI ranks attack candidates by exact capture probability fed with the real dice modifiers, instead of the legacy dice differential. Changes target choice only, never combat resolution |
| `aiDecidedGamePressEnabled` | `AI_DECIDED_GAME_PRESS_ENABLED` | **on** | An AI past 70% heuristic win probability doubles its exchange budget and attack cap to finish a decided game (never Easy/tutorial). Kill switch if the endgame press plays badly |
| `aiOddsPressEnabled` | `AI_ODDS_PRESS_ENABLED` | off | Bots press on the odds instead of a fixed exchange budget: each level starts an attack and rolls again at its own capture odds, up to a per-turn exchange ceiling (`pressStartOdds`, `pressContinueOdds`, `pressExchangeCeiling` in `ai/aiProfiles.ts`), and Easy stops planning long shots. Each run of exchanges is emitted as one combined `game:combat_result`, as a Blitz is. Daily challenges keep the fixed budget |
| `attackBlitzEnabled` | `ATTACK_BLITZ_ENABLED` | **on** | "Blitz until captured": one `game:attack_blitz` event resolves repeated exchanges server-side, emitted as one aggregated combat result. Land only, never in daily challenges; on a truce partner it breaks the truce, confirmed first like a single attack |
| `retentionNotificationsEnabled` | `RETENTION_NOTIFICATIONS_ENABLED` | **on in production only** | Hourly re-engagement sweep: streak-at-risk push, daily-challenge reminder, D2/D7 win-back email. Never fires from dev/test unless the env var is set explicitly (see [RETENTION-PLAYBOOK.md](RETENTION-PLAYBOOK.md)) |
| `streakFreezesEnabled` | `STREAK_FREEZES_ENABLED` | off | Streak-freeze purchase + freeze state in Today/comeback panels (consuming a held freeze is never gated) |
| `todayPanelEnabled` | `TODAY_PANEL_ENABLED` | off | Lobby right column swaps to the unified Today panel |
| `asyncOnboardingEnabled` | `ASYNC_ONBOARDING_ENABLED` | off | Multi-day async nudges: post-tutorial "challenge a friend", Today-panel async row |
| `spectateEnabled` | `SPECTATE_ENABLED` | off | Watch/Spectate surface: Live nav + lobby Watch entries, `GET /api/games/live`, spectator socket joins. Off while player counts are low (an empty/stale live list reads worse than none) |
| `spaceAgeFrontiersEnabled` | `SPACE_AGE_FRONTIERS_ENABLED` | on | Standalone Space Age seeds the 8 authored frontier tiles (63-tile board instead of 55) |
| `rankedMultiSizeEnabled` | `RANKED_MULTI_SIZE_ENABLED` | off | Ranked opponents-count dropdown + multi-player cohort matching (off = strict 1v1) |
| `matchAlertsEnabled` | `MATCH_ALERTS_ENABLED` | off | Ranked match-found alerts: app-wide socket listener, OS notification, FCM push. With `asyncTurnAlertsEnabled`, the kill switch for the always-on per-tab websocket — it stays up while either is on |
| `asyncTurnAlertsEnabled` | `ASYNC_TURN_ALERTS_ENABLED` | on | In-app "it's your turn" alerts for async games: the server emits `lobby:your_turn` to the player's sockets on every async turn change; the client mounts an app-wide listener (toast with a Play button on any page, OS notification when the tab is hidden). Server emit is unconditional; the flag gates the client listener and the websocket it keeps open |
| `warfrontEnabled` | `WARFRONT_ENABLED` | off | Experimental Warfront RTS mode ([WARFRONT_RTS_MODE.md](WARFRONT_RTS_MODE.md)): second gate on its admin-only surfaces (the terrain endpoint behind the Admin → Warfront tab, which the solo match at `/admin/warfront` loads from; later the match host). The headless lab is a local CLI and is not gated by it. Every Warfront route also requires an admin server-side, so this never exposes anything to players |
| `localizationEnabled` | `LOCALIZATION_ENABLED` | off | Landing page + tutorial in the player's language (es, pt-BR, de, fr) with a language switcher; off = English for everyone, exactly as before. Client-only effect. See [LOCALIZATION.md](LOCALIZATION.md) |
| `dailyPuzzleV2Enabled` | `DAILY_PUZZLE_V2_ENABLED` | off | Daily Challenge v2 ([DAILY_PUZZLE_V2.md](DAILY_PUZZLE_V2.md)): a day whose set-piece carries a scripted-opponent plan is served as a decision puzzle (short clock, scripted opponent, every move graded against the exact solution). Days without a plan, Thursday and Sunday stay v1 either way; off = the v1 daily exactly as before |
| `storeV2Enabled` | `STORE_V2_ENABLED` | on | Store overhaul as other players see it: every equipped cosmetic drawn where players see each other: frames and banners on the profile and beside names in matches (players list, combat cards, final standings), dice skins in combat, map markers on capitals (2D map and globe). The era sets (migration 046, `cosmetics.cosmetic_set`) are listed and sold only with it on. A match takes its players' cosmetics when it starts; turning the flag off hides them at once, running games included. The store page, the banner slot (`equipped_banner`) and unequipping are the same either way. Off = profiles and matches exactly as before, and no era sets |
| `ww2BombAiEnabled` | `WW2_BOMB_AI_ENABLED` | off | WW2 Manhattan Project Phase 1 ([WW2_MANHATTAN_PROJECT.md](WW2_MANHATTAN_PROJECT.md)): hard and expert bots research toward the Atom Bomb, fire it, and walk in. Baked at create as `settings.ww2_bomb_ai`, only in games that start in WW2, so a flip never re-rules a running match |
| `ww2ManhattanScienceEnabled` | `WW2_MANHATTAN_SCIENCE_ENABLED` | off | Phase 2: Manhattan Project follows Radar Network instead of Panzer Tactics. Baked as `settings.ww2_manhattan_science`, only in games that start in WW2; the tech tree route serves it with `?manhattan=science` |
| `ww2AtomicArsenalEnabled` | `WW2_ATOMIC_ARSENAL_ENABLED` | off | Phase 3: the Atom Bomb becomes once per turn at an escalating PP price, leaves three rounds of fallout, costs the bomber stability at home, and halves Manhattan's price for everyone once anyone has detonated. Baked as `settings.ww2_atomic_arsenal`, only in games that start in WW2: a climb from an earlier era keeps today's bomb (see the doc, §5) |
| `firstMatchEasyEnabled` | `FIRST_MATCH_EASY_ENABLED` | off | A player's first Quick Match (no finished game yet, and no Quick Match setup of their own) is one Easy bot on Great Britain 925 under the default Conquest ending, instead of their setup on a random era. Chosen with `backend/scripts/simFirstMatch.ts`. The game is tagged `settings.first_match`, kept only while the flag is on, and Admin → Analytics counts these under First matches. Off = Quick Match exactly as before |
| `backgroundMusicEnabled` | `BACKGROUND_MUSIC_ENABLED` | on | Generated ambient music on the game page (WebAudio, no audio files) that follows the viewer's era and rises in combat. Client-only; the player's own volume, mute and lite mode still win |
| `eraHeritageBuildingsEnabled` | `ERA_HERITAGE_BUILDINGS_ENABLED` | on | Era-advancement games: build rights earned by research survive the era tech wipe; a building raised in an earlier era yields less until the current era's tech for it is researched, which restores it with a premium. Baked at create, so a flip reaches new games only |
| `eraWonderPerEraEnabled` | `ERA_WONDER_PER_ERA_ENABLED` | off | Era-advancement games hold one wonder per era instead of one in total, so each advance opens a new wonder to compete for. A balance change; baked at create |
| `rankedLeaderboardEnabled` | `RANKED_LEADERBOARD_ENABLED` | off | Shows the ranked ladder: the Ranked tab on `/leaderboards` and the lobby's Top Commanders widget. Off until enough registered players have ranked games that the board does not look empty |
| `dailyGuestPlayEnabled` | `DAILY_GUEST_PLAY_ENABLED` | on | Guests may start the Daily Challenge; only registered players are ranked on its board. Turning it off closes the door without a deploy if guest game creation becomes a load or abuse problem |
| `spaceAgeMoonRaceEnabled` | `SPACE_AGE_MOON_RACE_ENABLED` | on | The whole Space Age Moon Race package as one switch, Lunar Hegemony included. Baked at create; the Custom Game form reads it to say whether a Space Age game can also be won on the Moon |
| `spaceAgeMoonTributeEnabled` | `SPACE_AGE_MOON_TRIBUTE_ENABLED` | off | Moon Race Tribute: a player holding 6 or more of the nine lunar tiles levies 1 tech point a turn from every player holding none. Its own switch because it is an optional extra, not a phase; applies wherever the Moon Race does |
| `galaxyTutorialEnabled` | `GALAXY_TUTORIAL_ENABLED` | on | The Galactic Age lessons in the Academy (the primer, then one per galaxy victory condition). Off, `POST /games/tutorial/start` refuses them and the Academy hides them |
| `galaxyCorridorsEnabled` | `GALAXY_CORRIDORS_ENABLED` | on | Galactic Age (admin-only era): lanes need no tech to cross and cap the attacker at 2 dice, 3 with Lane Charts. Baked at create |
| `galaxyWorldRulesEnabled` | `GALAXY_WORLD_RULES_ENABLED` | on | Galactic Age: each world's authored rules apply. Sol drafts deeper and breeds faster, Verdan's storms shed units above 12, Rust's defence buildings roll an extra die, and the Nexus Gate Ring starts neutral as the Vault. The master switch for the four below; baked at create |
| `galaxyDisabledWorldRules` | `GALAXY_RULE_CRADLE_ENABLED`, `GALAXY_RULE_STORMS_ENABLED`, `GALAXY_RULE_FORGE_ENABLED`, `GALAXY_RULE_VAULT_ENABLED` | on | One switch per world rule under the master (cradle is Sol, storms Verdan, forge Rust, vault the Nexus Gate Ring), so a misbehaving rule can be turned off alone. Baked at create as `world_rules_disabled` |
| `galaxyTransitEnabled` | `GALAXY_TRANSIT_ENABLED` | off | Galactic Age: a fortify between two worlds becomes a convoy that lands at the mover's next turn start. Baked at create |
| `galaxyBuildingsV2Enabled` | `GALAXY_BUILDINGS_V2_ENABLED` | off | Galactic Age buildings, Phase 1 ([GALACTIC_AGE_BUILDINGS.md](GALACTIC_AGE_BUILDINGS.md)): galaxy building names, and tech gating that opens each tier behind its tier of the tree. Baked at create |
| `galaxyOrbitalBuildingsEnabled` | `GALAXY_ORBITAL_BUILDINGS_ENABLED` | off | Phase 2: buildings on a gateway survive capture and pass to the captor. Baked at create |
| `galaxyGarrisonsEnabled` | `GALAXY_GARRISONS_ENABLED` | off | Phase 3: garrison doctrines, trained for PP once Lattice Logistics is researched: Hardened defends on d8s, Forward attacks from its tile on d8s. Baked at create |
| `galaxyPowersEnabled` | `GALAXY_POWERS_ENABLED` | off | Phase 4: once-per-turn lane powers fired from a gateway and paid in PP: Lance Battery, Orbital Muster, Seal Breaker and Surge Projector. Baked at create |
| `galaxyWorldBuildingsEnabled` | `GALAXY_WORLD_BUILDINGS_ENABLED` | off | Phase 5: world buildings opened by Lattice Logistics: Habitat Dome, Storm Shelter, Vault Conduit and Toll Beacon. Baked at create |

## Frontend environment variables

> Source of truth: [frontend/.env.example](../frontend/.env.example), [frontend/src/config/env.ts](../frontend/src/config/env.ts). Verify with: `grep -rohE '\bVITE_[A-Z0-9_]+' frontend/src | sort -u`
> ⚠️ **Build-time baking:** `VITE_*` values are inlined at `vite build`. Changing them requires a rebuild (the prod Dockerfile accepts them as build args). All are optional — the same-origin default (nginx proxying `/api` and `/socket.io`) needs none.

| Variable | Effect |
|---|---|
| `VITE_API_URL` | REST base when API is on another origin (default: same-origin `/api` via proxy) |
| `VITE_SOCKET_URL` | Socket.io origin (default: same-origin) |
| `VITE_SENTRY_DSN` | Frontend error reporting |
| `VITE_SENTRY_RELEASE` | The release on frontend reports and sessions; the prod build takes it from `SENTRY_RELEASE` (see the backend table) |
| `VITE_SUPPORT_EMAIL` | Contact shown on Privacy/Terms (default `support@borderfall.com`) |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY` | Web push. The first five come from the Firebase web app registration, the VAPID key from Cloud Messaging → Web Push certificates. Unset → the app shows no push UI at all (`getWebPushStatus()` = `unconfigured`). The page hands the config to `public/firebase-messaging-sw.js` through the worker's registration URL query string (`buildServiceWorkerUrl`), so nothing injects it at build time; permission is asked only from the opt-in controls (Settings → Notifications → This browser, and the lobby card), never on load. Forwarded as build args by `docker-compose.prod.yml` → `Dockerfile.frontend`. Native builds use Capacitor instead |
| `VITE_TENOR_API_KEY` | In-chat GIF search (feature hidden without it) |
| `VITE_TUTORIAL_V2` | Set `0` to fall back to the legacy tutorial (default: on) |
| `VITE_LAB_ROUTES` | Set `1` **at build time** to expose the `/__modal-lab` and `/__map-visual-lab` QA harnesses the Playwright specs drive. CI sets it for the e2e build only ([ci.yml](../.github/workflows/ci.yml)); the production image never passes it ([Dockerfile.frontend](../docker/Dockerfile.frontend)), so those routes do not exist in a shipped build |

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
