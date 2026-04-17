# Launch Plan — Phases 1 & 2: Hardening + Stability

## Phase 1: Hardening

### 1.1 Fix Path Traversal in Map Loading

**Problem**: `resolveMap()` in `gameSocket.ts` (line 85) and `maps.routes.ts` (line 181) build a filesystem path from user-supplied `mapId` without sanitization. A crafted `mapId` like `../../etc/passwd` resolves outside the maps directory.

**Files to edit**:
- `backend/src/sockets/gameSocket.ts` (line ~85)
- `backend/src/modules/maps/maps.routes.ts` (line ~181)

**Requirement**: Validate `mapId` against a strict alphanumeric+underscore regex before constructing any filesystem path. Reject any `mapId` containing path separators, dots, or special characters.

**Implementation**:

Create a shared validator in `backend/src/utils/mapId.ts`:

```ts
const SAFE_MAP_ID = /^[a-zA-Z0-9_-]+$/;

export function isSafeMapId(mapId: string): boolean {
  return SAFE_MAP_ID.test(mapId) && mapId.length <= 128;
}
```

In `gameSocket.ts`, add the guard before the filesystem fallback:

```ts
// BEFORE (vulnerable):
const jsonPath = path.resolve(__dirname, '../../../database/maps', `${mapId}.json`);

// AFTER (safe):
import { isSafeMapId } from '../utils/mapId';
// ...
if (!isSafeMapId(mapId)) return null;
const jsonPath = path.resolve(__dirname, '../../../database/maps', `${mapId}.json`);
```

In `maps.routes.ts`, apply the same guard:

```ts
import { isSafeMapId } from '../../utils/mapId';
// ...
if (!isSafeMapId(mapId)) {
  return reply.status(400).send({ error: 'Invalid map ID format' });
}
const jsonPath = path.resolve(__dirname, '../../../../database/maps', `${mapId}.json`);
```

**Tests**: Add a test in `backend/src/utils/mapId.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isSafeMapId } from './mapId';

describe('isSafeMapId', () => {
  it('allows valid IDs', () => {
    expect(isSafeMapId('era_ancient')).toBe(true);
    expect(isSafeMapId('community_14_nations')).toBe(true);
    expect(isSafeMapId('community-map-v2')).toBe(true);
  });
  it('rejects path traversal', () => {
    expect(isSafeMapId('../../etc/passwd')).toBe(false);
    expect(isSafeMapId('../secret')).toBe(false);
    expect(isSafeMapId('maps/../../root')).toBe(false);
  });
  it('rejects special characters', () => {
    expect(isSafeMapId('map id')).toBe(false);
    expect(isSafeMapId('map\x00id')).toBe(false);
    expect(isSafeMapId('')).toBe(false);
  });
  it('rejects overly long IDs', () => {
    expect(isSafeMapId('a'.repeat(129))).toBe(false);
  });
});
```

---

### 1.2 Fix Campaign Route Auth Bug

**Problem**: All three handlers in `campaign.routes.ts` use `(req as any).user.user_id`, but the `authenticate` middleware sets `request.userId`. This means `userId` is always `undefined`, causing silent DB failures.

**File to edit**: `backend/src/modules/campaign/campaign.routes.ts`

**Requirement**: Replace all three occurrences of `(req as any).user.user_id` with `(req as any).userId` to match the authenticate middleware's convention.

**Implementation**: Three replacements at lines 52, 125, and 216:

```ts
// BEFORE (broken — userId is undefined):
const userId = (req as any).user.user_id as string;

// AFTER (matches authenticate middleware):
const userId = (req as any).userId as string;
```

**Verification**: After fixing, start the dev server and test:
```bash
# 1. Login to get a token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","password":"password1"}' | jq -r '.accessToken')

# 2. Test campaign start (should return 200 or 409, not 404/500)
curl -s -X POST http://localhost:3001/api/campaign/start \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json'
```

---

### 1.3 Add CI Pipeline (GitHub Actions)

**Problem**: No automated checks. A bad merge goes directly to production.

**File to create**: `.github/workflows/ci.yml`

**Requirement**: On every push and PR to `main`, run:
1. Shared package build
2. Backend lint + type-check + Vitest tests
3. Frontend lint + type-check + Vite build
4. Map validation

**Implementation**:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # Shared package (backend pretest depends on this)
      - name: Build shared package
        run: pnpm -C packages/shared run build

      # Backend checks
      - name: Backend type-check
        run: pnpm -C backend exec tsc --noEmit
      - name: Backend tests
        run: pnpm run test:backend
      - name: Validate maps
        run: pnpm run validate:maps

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - name: Build shared package
        run: pnpm -C packages/shared run build
      - name: Frontend type-check
        run: pnpm -C frontend exec tsc --noEmit
      - name: Frontend build
        run: pnpm -C frontend run build
```

---

### 1.4 Add Sentry Error Monitoring

**Problem**: No visibility into production errors. Users hit bugs silently.

**Files to edit/create**:
- `backend/package.json` — add `@sentry/node` dependency
- `backend/src/index.ts` — initialize Sentry before Fastify
- `backend/src/errorHandler.ts` — capture exceptions to Sentry
- `frontend/package.json` — add `@sentry/react` dependency
- `frontend/src/main.tsx` or `frontend/src/App.tsx` — initialize Sentry

**Requirement**: Capture all unhandled backend errors and frontend exceptions to Sentry. Include request ID correlation. Do not leak DSNs to client-side code (use `VITE_SENTRY_DSN` env var).

**Backend implementation**:

```bash
pnpm -C backend add @sentry/node
```

Create `backend/src/services/sentry.ts`:

```ts
import * as Sentry from '@sentry/node';
import { config } from '../config';

export function initSentry(): void {
  if (!config.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.nodeEnv === 'production' ? 0.1 : 1.0,
  });
}

export { Sentry };
```

Add to `backend/src/config/index.ts`:

```ts
sentryDsn: process.env.SENTRY_DSN || '',
```

In `backend/src/index.ts`, call `initSentry()` as the first line of `bootstrap()`.

In `backend/src/errorHandler.ts`, add Sentry capture:

```ts
import { Sentry } from '../services/sentry';

// Inside the error handler, before the reply:
if (statusCode >= 500) {
  Sentry.captureException(error, {
    extra: { reqId: request.id, url: request.url, method: request.method },
  });
}
```

**Frontend implementation**:

```bash
pnpm -C frontend add @sentry/react
```

In `frontend/src/main.tsx`, before `ReactDOM.createRoot`:

```ts
import * as Sentry from '@sentry/react';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}
```

In `frontend/vite.config.ts`, add source map upload for production builds (optional but recommended):

```ts
build: {
  sourcemap: true, // enables Sentry to deobfuscate stack traces
}
```

---

### 1.5 Database Backup Strategy

**Problem**: No automated backups. A single `docker compose down -v` destroys all data.

**File to create**: `scripts/backup-databases.sh`

**Requirement**: Script that dumps Postgres and MongoDB to timestamped files. Designed to run as a daily cron job on the production VPS.

**Implementation**:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/erasofempire}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting at $TIMESTAMP"

# PostgreSQL
docker exec erasofempire_postgres pg_dump \
  -U "${POSTGRES_USER:-chronouser}" \
  -d "${POSTGRES_DB:-erasofempire}" \
  --format=custom \
  > "$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
echo "[backup] Postgres dump complete"

# MongoDB
docker exec erasofempire_mongo mongodump \
  --username="${MONGO_USER:-chronouser}" \
  --password="${MONGO_PASSWORD:-chronopass}" \
  --authenticationDatabase=admin \
  --db="${MONGO_DB:-erasofempire_maps}" \
  --archive \
  > "$BACKUP_DIR/mongo_${TIMESTAMP}.archive"
echo "[backup] MongoDB dump complete"

# Prune old backups
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Pruned backups older than $RETENTION_DAYS days"
echo "[backup] Done"
```

**Cron setup** (on production VPS):
```bash
# Daily at 3 AM
0 3 * * * /opt/erasofempire/scripts/backup-databases.sh >> /var/log/erasofempire-backup.log 2>&1
```

---

### 1.6 Guest User Cleanup

**Problem**: Guest users create permanent DB rows with no TTL. These accumulate indefinitely.

**File to create**: `backend/src/modules/users/guestCleanupService.ts`
**File to edit**: `backend/src/index.ts` (register the sweep)

**Requirement**: Delete guest users older than 48 hours who have no associated games. Run every 6 hours. Follow the existing `gameCleanupService.ts` pattern exactly.

**Implementation**:

```ts
// backend/src/modules/users/guestCleanupService.ts
import { query } from '../../db/postgres';

const GUEST_MAX_AGE_MS = 48 * 60 * 60 * 1000;        // 48 hours
const GUEST_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 hours

let sweepInterval: ReturnType<typeof setInterval> | null = null;

export async function deleteStaleGuestUsers(): Promise<number> {
  const result = await query<{ user_id: string }>(
    `DELETE FROM users
     WHERE is_guest = true
       AND created_at <= NOW() - ($1 * INTERVAL '1 millisecond')
       AND NOT EXISTS (
         SELECT 1 FROM game_players gp WHERE gp.user_id = users.user_id
       )
     RETURNING user_id`,
    [GUEST_MAX_AGE_MS],
  );
  return result.length;
}

export function startGuestCleanupSweep(): void {
  void deleteStaleGuestUsers().catch((err) =>
    console.error('[GuestCleanup] Initial sweep failed:', err),
  );
  sweepInterval = setInterval(() => {
    void deleteStaleGuestUsers().catch((err) =>
      console.error('[GuestCleanup] Sweep failed:', err),
    );
  }, GUEST_SWEEP_INTERVAL_MS);
  sweepInterval.unref();
}

export function stopGuestCleanupSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}
```

In `backend/src/index.ts`, add alongside the other sweeps:

```ts
import { startGuestCleanupSweep, stopGuestCleanupSweep } from './modules/users/guestCleanupService';

// In bootstrap(), after startOrphanedGameSweep():
startGuestCleanupSweep();

// In setupGracefulShutdown(), alongside stopOrphanedGameSweep():
stopGuestCleanupSweep();
```

---

### 1.7 Validate Matchmaking Input with Zod

**Problem**: `POST /matchmaking/join` uses manual `if` checks. `era_id` is never validated against the allowed era list, allowing queue entries for non-existent eras.

**File to edit**: `backend/src/modules/matchmaking/matchmaking.routes.ts`

**Requirement**: Replace manual validation with a Zod schema. Validate `era_id` against the `EraId` union type.

**Implementation**:

At the top of the file, add:

```ts
import { z } from 'zod';

const VALID_ERA_IDS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento'] as const;

const JoinSchema = z.object({
  era_id: z.enum(VALID_ERA_IDS),
  bucket: z.enum(VALID_BUCKETS),
});
```

Replace the handler's manual validation:

```ts
// BEFORE:
const body = request.body as { era_id?: string; bucket?: string } | undefined;
if (!body?.era_id || !body?.bucket) {
  return reply.status(400).send({ error: 'era_id and bucket are required' });
}
if (!VALID_BUCKETS.includes(body.bucket as Bucket)) {
  return reply.status(400).send({ error: 'Invalid bucket' });
}
const { era_id, bucket } = body;

// AFTER:
const parsed = JoinSchema.safeParse(request.body);
if (!parsed.success) {
  return reply.status(400).send({
    error: 'Invalid matchmaking parameters',
    details: parsed.error.flatten().fieldErrors,
  });
}
const { era_id, bucket } = parsed.data;
```

---

## Phase 2: Stability

### 2.1 Extract gameSocket.ts into Handler Modules

**Problem**: `gameSocket.ts` is 3,185 lines with all game logic in one file. This is the biggest maintenance risk and the hardest file to review.

**Files to create**:
- `backend/src/sockets/handlers/draftHandler.ts`
- `backend/src/sockets/handlers/attackHandler.ts`
- `backend/src/sockets/handlers/fortifyHandler.ts`
- `backend/src/sockets/handlers/buildHandler.ts`
- `backend/src/sockets/handlers/navalHandler.ts`
- `backend/src/sockets/handlers/diplomacyHandler.ts`
- `backend/src/sockets/handlers/chatHandler.ts`
- `backend/src/sockets/handlers/lobbyHandler.ts`
- `backend/src/sockets/handlers/phaseHandler.ts`

**Requirement**: Extract each socket event handler into its own module. The main `gameSocket.ts` should only handle connection setup, room management, and delegating to handlers. Game state maps (`activeGames`, `activeTimers`, etc.) should be passed via a shared context object.

**Implementation pattern**:

Define a shared handler context type:

```ts
// backend/src/sockets/handlers/types.ts
import type { Server, Socket } from 'socket.io';
import type { GameState, GameMap } from '../../types';

export interface ActiveGames {
  get(gameId: string): GameState | undefined;
  set(gameId: string, state: GameState): void;
  delete(gameId: string): void;
}

export interface SocketContext {
  io: Server;
  socket: Socket;
  userId: string;
  username: string;
  activeGames: ActiveGames;
  resolveMap: (mapId: string) => Promise<GameMap | null>;
  saveGameState: (gameId: string, state: GameState) => Promise<void>;
  scheduleNextTurnTimer: (gameId: string, state: GameState) => void;
  clearTurnTimer: (gameId: string) => void;
}
```

Extract a handler (example — `draftHandler.ts`):

```ts
// backend/src/sockets/handlers/draftHandler.ts
import type { SocketContext } from './types';
import { z } from 'zod';

const DraftPayload = z.object({
  gameId: z.string().uuid(),
  territoryId: z.string().min(1),
  units: z.number().int().min(1),
});

export function registerDraftHandler(ctx: SocketContext): void {
  ctx.socket.on('game:draft', (rawPayload: unknown) => {
    const parsed = DraftPayload.safeParse(rawPayload);
    if (!parsed.success) {
      ctx.socket.emit('error', { message: 'Invalid draft payload' });
      return;
    }
    const { gameId, territoryId, units } = parsed.data;
    const state = ctx.activeGames.get(gameId);
    if (!state) {
      ctx.socket.emit('error', { message: 'Game not found' });
      return;
    }

    // ... existing draft logic moved here from gameSocket.ts lines ~740-825 ...
  });
}
```

In `gameSocket.ts`, the connection handler becomes:

```ts
io.on('connection', (socket) => {
  const userId = socket.data.userId;
  const username = socket.data.username;

  const ctx: SocketContext = {
    io, socket, userId, username,
    activeGames, resolveMap, saveGameState,
    scheduleNextTurnTimer, clearTurnTimer,
  };

  registerDraftHandler(ctx);
  registerAttackHandler(ctx);
  registerFortifyHandler(ctx);
  registerBuildHandler(ctx);
  registerNavalHandler(ctx);
  registerDiplomacyHandler(ctx);
  registerChatHandler(ctx);
  registerLobbyHandler(ctx);
  registerPhaseHandler(ctx);

  // ... connection/disconnection/join/leave logic stays here ...
});
```

**Approach**: Extract one handler at a time, starting with the simplest (chat), then draft, attack, fortify, build, naval, diplomacy, lobby, phase. Run `pnpm run test:backend` after each extraction. The goal is mechanical extraction, not refactoring — move the code as-is, only changing variable references to use `ctx.*`.

**Approximate size targets after extraction**:

| File | Lines (estimated) |
|------|------------------:|
| `gameSocket.ts` (connection, join, leave, timers, state management) | ~800 |
| `draftHandler.ts` | ~100 |
| `attackHandler.ts` (includes combat resolution calls) | ~350 |
| `fortifyHandler.ts` | ~80 |
| `buildHandler.ts` | ~60 |
| `navalHandler.ts` | ~150 |
| `diplomacyHandler.ts` (truce proposals, influence) | ~200 |
| `chatHandler.ts` | ~100 |
| `lobbyHandler.ts` (start, proposals, voting) | ~400 |
| `phaseHandler.ts` (advance_phase, event_choice, resign, cards) | ~400 |
| `handlers/types.ts` | ~40 |

---

### 2.2 Add Socket Event Payload Validation

**Problem**: Socket event payloads use inline TypeScript types (compile-time only). No runtime validation. Malformed payloads from a hacked client could cause crashes.

**Requirement**: Add Zod runtime validation to every socket event handler. Each handler defines its payload schema and calls `.safeParse()` before processing. On failure, emit `error` to the socket.

This work is bundled with 2.1 — as each handler is extracted, add a Zod schema at the top of the file.

**Schemas for each handler**:

```ts
// Common building blocks
const GameIdParam = z.string().uuid();
const TerritoryIdParam = z.string().min(1).max(128);

// game:draft
const DraftPayload = z.object({
  gameId: GameIdParam,
  territoryId: TerritoryIdParam,
  units: z.number().int().min(1).max(999),
});

// game:attack
const AttackPayload = z.object({
  gameId: GameIdParam,
  fromId: TerritoryIdParam,
  toId: TerritoryIdParam,
});

// game:fortify
const FortifyPayload = z.object({
  gameId: GameIdParam,
  fromId: TerritoryIdParam,
  toId: TerritoryIdParam,
  units: z.number().int().min(1).max(999),
});

// game:build
const BuildPayload = z.object({
  gameId: GameIdParam,
  territoryId: TerritoryIdParam,
  buildingType: z.enum(['camp', 'barracks', 'arsenal', 'palisade', 'fortress',
    'citadel', 'laboratory', 'research_center', 'port', 'naval_base']),
});

// game:naval_move
const NavalMovePayload = z.object({
  gameId: GameIdParam,
  fromId: TerritoryIdParam,
  toId: TerritoryIdParam,
  units: z.number().int().min(1).max(999),
});

// game:naval_attack
const NavalAttackPayload = z.object({
  gameId: GameIdParam,
  fromId: TerritoryIdParam,
  toId: TerritoryIdParam,
});

// game:chat
const ChatPayload = z.object({
  gameId: GameIdParam,
  message: z.string().min(1).max(500),
});

// game:event_choice
const EventChoicePayload = z.object({
  gameId: GameIdParam,
  cardId: z.string().min(1),
  choiceId: z.string().min(1),
});

// game:redeem_cards
const RedeemCardsPayload = z.object({
  gameId: GameIdParam,
  cardIds: z.array(z.string()).length(3),
});

// game:research_tech
const ResearchTechPayload = z.object({
  gameId: GameIdParam,
  techId: z.string().min(1),
});

// game:use_ability
const UseAbilityPayload = z.object({
  gameId: GameIdParam,
  abilityId: z.string().min(1),
  targetId: TerritoryIdParam.optional(),
});

// game:influence
const InfluencePayload = z.object({
  gameId: GameIdParam,
  territoryId: TerritoryIdParam,
});

// game:propose_truce / game:truce_response
const TruceProposalPayload = z.object({
  gameId: GameIdParam,
  targetPlayerId: z.string().uuid(),
  turns: z.number().int().min(1).max(10),
});

const TruceResponsePayload = z.object({
  gameId: GameIdParam,
  proposerId: z.string().uuid(),
  accept: z.boolean(),
});
```

**Validation wrapper** (reusable across all handlers):

```ts
// backend/src/sockets/handlers/validate.ts
import type { Socket } from 'socket.io';
import type { ZodSchema } from 'zod';

export function validatePayload<T>(
  socket: Socket,
  schema: ZodSchema<T>,
  payload: unknown,
): T | null {
  const result = schema.safeParse(payload);
  if (!result.success) {
    socket.emit('error', { message: 'Invalid payload' });
    return null;
  }
  return result.data;
}
```

Usage in every handler:

```ts
socket.on('game:draft', (rawPayload: unknown) => {
  const payload = validatePayload(socket, DraftPayload, rawPayload);
  if (!payload) return;
  const { gameId, territoryId, units } = payload;
  // ... existing logic ...
});
```

---

### 2.3 Structured Logging with Pino

**Problem**: All logging uses `console.log` with `[Tag]` prefixes. No log levels, no JSON output, no request correlation in production.

**Requirement**: Replace `console.log` with Fastify's built-in Pino logger. Enable JSON logging in production, pretty-printing in development. Extend to socket events via a child logger.

**Files to edit**:
- `backend/src/index.ts` — configure logger properly
- `backend/src/errorHandler.ts` — use `request.log`
- `backend/src/sockets/gameSocket.ts` — create a socket logger
- All files using `console.log` / `console.error` (~12 files, ~30 occurrences)

**Implementation**:

```bash
pnpm -C backend add pino-pretty -D
```

In `backend/src/index.ts`, replace the logger config:

```ts
// BEFORE:
const app = Fastify({
  logger: config.nodeEnv === 'development',
  trustProxy: true,
  genReqId: () => randomUUID(),
});

// AFTER:
const app = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    ...(config.nodeEnv === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  },
  trustProxy: true,
  genReqId: () => randomUUID(),
});

// Export for use outside of request context
export const logger = app.log;
```

In `backend/src/errorHandler.ts`:

```ts
// BEFORE:
console.error(`[Error] ${request.id} ${request.method} ${request.url}:`, error);

// AFTER:
request.log.error({ err: error, reqId: request.id }, 'Request error');
```

For socket events, create a child logger in `gameSocket.ts`:

```ts
import { logger } from '../index';

const socketLog = logger.child({ module: 'socket' });

// Then replace:
// console.log('[Socket] Client connected:', socket.id);
// with:
socketLog.info({ socketId: socket.id, userId }, 'Client connected');
```

For services that run outside request context (cleanup, migrations, etc.):

```ts
import { logger } from '../index';

// Replace:
// console.log('[GuestCleanup] Deleted', count, 'stale guests');
// with:
logger.info({ count }, 'Deleted stale guest users');
```

**Migration checklist** (all 12 files with `console.log`):

| File | Occurrences | Replace with |
|------|:-----------:|-------------|
| `index.ts` | 5 | `app.log.info(...)` for startup messages |
| `gameSocket.ts` | 4 | `socketLog.info/warn(...)` |
| `notificationService.ts` | 4 | `logger.info/warn(...)` |
| `asyncDeadlineWorker.ts` | 3 | `logger.info/error(...)` |
| `mongo/index.ts` | 1 | `logger.info(...)` |
| `postgres/index.ts` | 1 | `logger.info(...)` |
| `redis/index.ts` | 1 | `logger.info(...)` |
| `migrate.ts` | 4 | `logger.info(...)` |
| `seed.ts` | 3 | `logger.info(...)` |
| `gameCleanupService.ts` | 1 | `logger.info(...)` |
| `seasonService.ts` | 2 | `logger.info/error(...)` |
| `referralService.ts` | 1 | `logger.info(...)` |

**Note**: The `logger` export from `index.ts` won't be available until after Fastify is created. For modules that initialize early (DB connections), either:
- Accept `console.log` for the 3 one-time DB connection messages (they happen before the logger exists), or
- Create a standalone Pino instance in a `backend/src/utils/logger.ts` that both Fastify and early-init code share

Recommended approach — standalone logger:

```ts
// backend/src/utils/logger.ts
import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  ...(config.nodeEnv === 'development' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});
```

Then pass it to Fastify:

```ts
import { logger } from './utils/logger';

const app = Fastify({
  logger,
  trustProxy: true,
  genReqId: () => randomUUID(),
});
```

This makes `logger` available immediately for all modules.

**Add `pino` as explicit dependency** (even though Fastify bundles it, handlers import it directly):

```bash
pnpm -C backend add pino
```

---

### 2.4 Frontend Integration Tests

**Problem**: Zero frontend test coverage. Socket handling, auth flow, and state transitions are untested.

**Files to create**:
- `frontend/src/__tests__/authStore.test.ts`
- `frontend/src/__tests__/gameStore.test.ts`
- `frontend/src/__tests__/api.test.ts`

**Requirement**: Add Vitest unit tests for the three Zustand stores and the API interceptor. Mock `axios` and `socket.io-client`. Target the highest-value flows: login, token refresh, game state updates, logout.

**Setup**:

```bash
pnpm -C frontend add -D vitest @testing-library/react jsdom
```

Add to `frontend/package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
});
```

**Test: Auth store** (`frontend/src/__tests__/authStore.test.ts`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock axios before importing the store
vi.mock('../services/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));
vi.mock('../services/socket', () => ({
  resyncSocketAuth: vi.fn(),
}));

import { useAuthStore } from '../store/authStore';

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it('logout clears all auth state', () => {
    useAuthStore.setState({
      user: { user_id: '1', username: 'test' } as any,
      accessToken: 'tok',
      isAuthenticated: true,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });
});
```

**Test: Game store** (`frontend/src/__tests__/gameStore.test.ts`):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';

describe('gameStore', () => {
  beforeEach(() => {
    useGameStore.getState().clearGame();
  });

  it('setGameState updates state', () => {
    const mockState = {
      game_id: 'test-123',
      phase: 'draft',
      players: [{ player_id: 'p1', username: 'Alice', is_eliminated: false }],
      territories: {},
      current_player_index: 0,
      turn_number: 1,
    } as any;

    useGameStore.getState().setGameState(mockState);
    expect(useGameStore.getState().gameState?.game_id).toBe('test-123');
  });

  it('clearGame resets all state', () => {
    useGameStore.setState({ gameState: { game_id: 'x' } as any });
    useGameStore.getState().clearGame();
    expect(useGameStore.getState().gameState).toBeNull();
  });

  it('setLastCombatResult stores combat data', () => {
    const combat = {
      attacker_rolls: [6, 5, 3],
      defender_rolls: [4, 2],
      attacker_losses: 0,
      defender_losses: 2,
    } as any;

    useGameStore.getState().setLastCombatResult(combat);
    expect(useGameStore.getState().lastCombatResult).toEqual(combat);
  });
});
```

Add to CI pipeline (`.github/workflows/ci.yml`, in the `frontend` job):

```yaml
      - name: Frontend unit tests
        run: pnpm -C frontend run test
```

---

### 2.5 Bundle Size Optimization

**Problem**: ~750KB of unnecessary JavaScript on the critical path from three oversized dependencies.

#### 2.5a Replace full `firebase` with modular import

**File to edit**: `frontend/src/services/pushNotifications.ts`

**Requirement**: Import only `firebase/app` and `firebase/messaging` instead of the full `firebase` package.

```ts
// BEFORE:
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

// This is likely already correct if tree-shaking works.
// Verify by checking the actual import. If it's:
import firebase from 'firebase';       // ← BAD: pulls everything
// Then change to:
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
```

If the full `firebase` SDK is still pulled, switch to the lighter `firebase/messaging/sw` for the service worker and the modular API for the client. Consider whether `firebase-admin` on the backend could handle push server-side while the frontend uses only `@capacitor/push-notifications`.

#### 2.5b Replace full `d3` with specific modules

**File to edit**: `frontend/package.json`, and all files importing from `d3`

```bash
# Find all d3 imports
grep -rn "from 'd3'" frontend/src/
```

Replace:
```ts
// BEFORE:
import * as d3 from 'd3';
// or
import { geoPath, geoMercator, scaleLinear } from 'd3';

// AFTER:
import { geoPath, geoMercator } from 'd3-geo';
import { scaleLinear } from 'd3-scale';
```

Update `frontend/package.json`:
```bash
pnpm -C frontend remove d3 @types/d3
pnpm -C frontend add d3-geo d3-scale d3-array
pnpm -C frontend add -D @types/d3-geo @types/d3-scale @types/d3-array
```

#### 2.5c Lazy-load emoji-mart

**File to edit**: `frontend/src/components/game/GameChat.tsx`

**Requirement**: Load `emoji-mart` only when the user opens the emoji picker, not on initial render.

```tsx
// BEFORE:
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';

// AFTER:
import { lazy, Suspense, useState } from 'react';
const Picker = lazy(() => import('@emoji-mart/react'));

// In the component:
const [showPicker, setShowPicker] = useState(false);

{showPicker && (
  <Suspense fallback={<div className="h-80 w-72 animate-pulse bg-cc-dark" />}>
    <Picker
      data={undefined}  // emoji-mart fetches data lazily when data prop is omitted
      onEmojiSelect={handleEmojiSelect}
    />
  </Suspense>
)}
```

**Verification**: After all three changes, measure the build output:

```bash
pnpm -C frontend run build 2>&1 | grep -E 'dist/assets.*\.js'
```

Compare chunk sizes before and after. Expected savings: ~400–750KB from the main chunks.

---

### 2.6 Add React.memo to Key Game Components

**Problem**: GamePage has ~30 `useState` hooks. Any state change re-renders all child components. None of the game components use `React.memo`.

**Files to edit**:
- `frontend/src/components/game/GameHUD.tsx`
- `frontend/src/components/game/TerritoryPanel.tsx`
- `frontend/src/components/game/GameChat.tsx`
- `frontend/src/components/game/BuildingPanel.tsx`
- `frontend/src/components/game/EventCardModal.tsx`
- `frontend/src/components/game/BonusesModal.tsx`
- `frontend/src/components/game/TechTreeModal.tsx`
- `frontend/src/components/game/EraModifierBadge.tsx`
- `frontend/src/components/game/MobileCombatBanner.tsx`
- `frontend/src/components/game/MobileCardsTray.tsx`

**Requirement**: Wrap each component's default export with `React.memo`. Do not change any logic — this is a pure performance optimization.

**Implementation pattern** (apply to each file):

```tsx
// BEFORE (typical pattern at the bottom of each file):
export default function GameHUD({ ... }: GameHUDProps) {
  // ...
}

// AFTER:
function GameHUD({ ... }: GameHUDProps) {
  // ...
}

export default memo(GameHUD);
```

Add `import { memo } from 'react'` to each file (or add `memo` to the existing React import).

**Important**: For `React.memo` to be effective, the parent (GamePage) must ensure stable prop references. Check that callbacks passed to these components are wrapped in `useCallback` (most already are based on the audit). If any prop is an inline object/array literal, extract it to a `useMemo`.

**Priority order** (by re-render impact):
1. `GameHUD` — renders every frame, receives many props
2. `TerritoryPanel` — re-renders on territory selection changes
3. `GameChat` — re-renders on every message
4. `BuildingPanel` — re-renders during build interactions
5. The remaining 6 components (lower-frequency renders)

---

## Implementation Order

The tasks are ordered by dependency and risk:

| # | Task | Depends On | Risk | Time Estimate |
|---|------|-----------|------|---------------|
| **Phase 1** | | | | |
| 1.1 | Path traversal fix | — | Critical security | Small |
| 1.2 | Campaign auth fix | — | Critical bug | Trivial |
| 1.3 | CI pipeline | — | Process | Small |
| 1.4 | Sentry monitoring | — | Observability | Small |
| 1.5 | Database backups | — | Data safety | Small |
| 1.6 | Guest user cleanup | — | Data hygiene | Small |
| 1.7 | Matchmaking validation | — | Input safety | Small |
| **Phase 2** | | | | |
| 2.1 | Extract socket handlers | 1.1 (mapId fix) | High (refactor) | Large |
| 2.2 | Socket payload validation | 2.1 (extracted handlers) | Medium | Medium |
| 2.3 | Structured logging | — | Low | Medium |
| 2.4 | Frontend tests | — | Low | Medium |
| 2.5 | Bundle size optimization | — | Low | Small |
| 2.6 | React.memo components | — | Low | Small |

**Phase 1** items are all independent and can be done in any order (or in parallel by different developers). **Phase 2** items 2.1 and 2.2 are sequential; the rest are independent.

After completing both phases, run the full verification:

```bash
# Backend
pnpm run test:backend
pnpm run validate:maps
pnpm -C backend exec tsc --noEmit

# Frontend
pnpm -C frontend run test
pnpm -C frontend exec tsc --noEmit
pnpm -C frontend run build

# Smoke test (if deployed)
./scripts/smoke-production.sh http://localhost:3001
```
