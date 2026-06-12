# Operations: game-state persistence and process restarts

> Full design: [ARCHITECTURE.md → Game state authority model](ARCHITECTURE.md#game-state-authority-model). Tuning knobs (`PG_POOL_MAX`, `PG_CONNECT_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`): [CONFIGURATION.md](CONFIGURATION.md).

## Where live game state lives

Live game state is **Redis-authoritative**: every mutation runs under a per-game redlock and persists to Redis immediately (`game:<id>:state`, 7-day activity-refreshed TTL). PostgreSQL `game_states` receives **debounced backups** (~800ms after each mutation, immediate flush on game over / leave / shutdown) via `persistGameStateAfterMutation` in [backend/src/sockets/gameRoomManager.ts](../backend/src/sockets/gameRoomManager.ts).

## Backend restarts

A backend restart (deploy, crash, `tsx watch` reload) does **not** lose live games:

- State reloads from **Redis** on the next join or action; if Redis also missed, the room **self-heals from the latest Postgres backup** (`loadAuthoritativeRoom` looks up the map id itself — any action path recovers, not just `game:join`).
- Turn timers and async deadlines are **BullMQ jobs in Redis** — they survive the process and fire on the new one. A rejoin re-arms a lost timer from the surviving deadline without granting extra clock.
- Clients ride it out: the auth layer treats an unreachable server as retryable (no logout), and a transient `GAME_NOT_FOUND` triggers a silent rejoin rather than ejecting the player.

What a restart **does** cost: the last ≤800ms of un-debounced Postgres backup *if Redis is lost at the same time* — i.e., only a simultaneous Redis+process loss can drop recent moves. Graceful shutdown (SIGTERM) flushes pending backups first (`setupGracefulShutdown` in [backend/src/index.ts](../backend/src/index.ts)).

## Redis loss

If Redis data is lost entirely (flush, volume loss), in-progress games recover from their Postgres backups on next access, missing at most the final debounce window. Redis itself should be deployed with persistence (the prod compose uses a named volume).

## WebSocket reconnect (client)

The game client re-emits `game:join` after a Socket.IO reconnect; the server re-attaches the socket to the room, replays pending modals (event cards, truce proposals), resumes a stalled AI turn, and re-arms a missing turn timer. The main game page does this automatically on `connect`.
