# Eras of Empire — Launch QA Remediation Roadmap

> Companion document to the pre-launch QA report. Describes the ordering, batching,
> and verification strategy for remediating each finding. One-shot implementation
> reference — not a living design doc.

## Strategy

1. **Critical first, without exception.** The ten Critical items are either cheat
   vectors, data-corruption risks, or game-stall bugs that can strand users mid-match.
   Every other finding waits until Criticals are done and verified.
2. **Server-authoritative fixes over client patches.** Where the same symptom can be
   addressed in both places, fix the server. Client fixes are belt-and-braces only.
3. **Idempotence & atomicity as recurring themes.** Several Critical/High items
   (C4, C7, C8, C9, C10, H6) boil down to the same class of bug: a read-then-write
   sequence without a lock. Unified remediation pattern: wrap in a transaction with
   `SELECT … FOR UPDATE` or use `INSERT … ON CONFLICT` + affected-rows check.
4. **No new infrastructure for launch.** Anything requiring a new external service
   (SMTP, object storage, age-verification provider) is implemented as a functional
   endpoint with an injectable transport; the transport can be swapped in before
   launch without code changes.
5. **Fail closed under uncertainty.** When a fix introduces a new branch (e.g.
   "phase mismatch" guard), return an explicit error to the client instead of
   silently ignoring the action.

## Execution order

| Phase | Items | Scope |
|---|---|---|
| 1 | Strategy + doc | This file |
| 2 | C1–C10 | Cheat prevention, data atomicity, game-stall recovery |
| 3 | H1–H10 | Game-rules correctness, auth hygiene, reconnect polish |
| 4 | M1–M18 | UX polish, schema tightening, pool sizing |
| 5 | L1–L12 | Lint-level polish; skip where infrastructure-dependent |

After each phase, run `pnpm run test:backend`, `pnpm run validate:maps`, and
TypeScript build on both packages. Address any regressions before moving on.

## Per-finding implementation notes

### Critical

**C1 — Fog-of-war bypass via `game:state_public`**
- Remove the `io.to(gameId).emit('game:state_public', …)` line.
- Verify the event has no listeners in the frontend.
- Fallback public broadcast (no tracked sockets) remains but emits `game:state`
  with `fogOfWar: false` — acceptable because that path only fires at game start
  when the room has not yet populated.

**C2 — AI draws multiple cards per turn**
- Introduce local `aiCardEarned` flag in `processAiTurn` (same semantics as
  human handler's `cardEarned`).
- Only call `drawCard` once per AI turn, after the first successful capture.

**C3 — AI leaves 0 units in a territory**
- Before accepting an AI fortify, validate `from.unit_count > units`.
- Before accepting an AI attack-move (post-capture move-in), the existing
  `Math.max(1, from.unit_count - to.unit_count)` already prevents 0, but add an
  assertion as a tripwire and remove the silent auto-correct in
  `broadcastState`.

**C4 — Store purchase race**
- Wrap gold check + deduct + grant + audit log in a single transaction.
- Change the UPDATE to `UPDATE users SET gold = gold - $1 WHERE user_id = $2
  AND gold >= $1 RETURNING gold`; abort if no row updated.
- Use `INSERT … ON CONFLICT (user_id, cosmetic_id) DO NOTHING` for the grant
  and treat zero affected rows as "already owned" (409).

**C5 — AI worker hard hang**
- Wrap the worker promise in `Promise.race([workerPromise, timeoutPromise])`.
- On timeout, `worker.terminate()` to guarantee thread cleanup.
- Attach `worker.on('exit', code => reject)` so silent crashes surface.
- Add an outer "total AI turn budget" as a socket-layer safety net.

**C6 — Victory check skipped on resign/elim**
- In the resign handler and in the attack handler's elimination branch,
  immediately call `checkVictory(state)` and, if a winner exists, transition
  `state.phase = 'game_over'` and emit `game:over` before any further
  `advanceToNextPlayer` call.

**C7 — Matchmaking race**
- Rewrite `attemptMatch` to wrap SELECT + DELETE inside `BEGIN; … FOR UPDATE
  SKIP LOCKED; … COMMIT`.
- Add a `UNIQUE` constraint on `ranked_queue.user_id` so parallel enqueues fail
  fast.

**C8 — Socket action idempotency**
- Add optional `action_id: string` field to every client-emitted action event.
- Server-side per-`(gameId,userId)` LRU of last 32 action_ids; discard
  duplicates silently (ack the original result).
- Frontend: generate `action_id` with `crypto.randomUUID()` on each action
  dispatch.

**C9 — Refresh-token rotation race**
- In the refresh handler: `BEGIN; SELECT … FOR UPDATE; UPDATE revoked=TRUE;
  INSERT new token; COMMIT;`.
- If `revoked` is already `TRUE` when read, abort and clear the client cookie
  (possible token theft — invalidate the user's whole chain).

**C10 — Lobby join race**
- Add composite `UNIQUE (game_id, player_index)` on `game_players` (verify if
  present).
- Compute next index inside a transaction with `SELECT … FOR UPDATE` on the
  games row; reject if `player_count >= max_players`.

### High

- **H1**: add `mission_progress` field to the player model; bitset of satisfied
  capture targets persisted across snapshots.
- **H2**: check `state.territories[player.capital].owner_id === player.player_id`
  before iterating opponents.
- **H3**: add `MISSION_SALT` env var; hash `${gameId}:secret_missions:${salt}`.
- **H4**: add `requirePhase(state, userId, phase)` helper and call it at the top
  of every action handler.
- **H5**: thread `state.settings.fog_of_war` to AI influence; filter targets
  to fog-visible territories using existing adjacency helper.
- **H6**: new table `rating_updates(game_id UNIQUE)`; `INSERT … ON CONFLICT DO
  NOTHING` gates the Glicko call.
- **H7**: replay endpoint — allow only `status='completed'` or spectator access
  to non-fog games; 403 otherwise.
- **H8**: re-key `connectedSockets` by `userId`; on reconnect, replace any
  existing socket for the user.
- **H9**: add `POST /auth/password/request-reset`, `POST /auth/password/reset`,
  `POST /auth/password/change`. Pluggable mailer with a console transport by
  default; wire to real SMTP via env var before launch. All revoke all refresh
  tokens on success.
- **H10**: add `MAX_CHAT_LEN`, `MAX_MAP_NAME_LEN`, etc. via zod schemas on both
  REST and socket chat handlers. Audit frontend for any
  `dangerouslySetInnerHTML` — remove or sanitize.

### Medium

Bundled in a single pass — each is a small localized change.

- M1: show explicit UTC-day label with rollover countdown in DailyChallengePage.
- M2: raise default pool max to 50; comment with scaling guidance.
- M3: per-socket token-bucket rate limiter (simple in-memory).
- M4: `<RequireNonGuest>` route wrapper in `App.tsx`.
- M5: reconnection banner bound to socket state in GamePage.
- M6: clamp replay seek; disable speed buttons when not ready.
- M7: widen modal close hit-areas; audit HUD for <44px targets.
- M8: WebGL probe with graceful degradation in GameMap.
- M9: disable buy button immediately on click in StorePage.
- M10: migration adding missing FK indexes.
- M11: graph connectivity check (BFS) in `mapConnections.ts`.
- M12: use `config.bcryptRounds` for guest hashes.
- M13: clamp Glicko inputs on read.
- M14: confirm pop=1 floor is intentional (add comment) or fix.
- M15: `beforeunload` guard in MapEditor when dirty.
- M16: 404 error boundaries for profile/game/replay direct links with bad ids.
- M17: purge Redis leaderboard key on user delete.
- M18: email verification — token table + `email_verified` column + endpoints.
  Stub transport.

### Low

Polish pass; skip items that depend on external services we don't have.

- L1: randomize dev JWT fallback per boot.
- L2: list-render `key` audit.
- L3: color contrast bump.
- L4: `prefers-reduced-motion` respect.
- L5: switch refresh-token storage to SHA-256 (faster; still irreversible).
- L6: LRU adjacency cache cap.
- L7: spectator buffer monotonic sequence.
- L8: client map-editor polygon count cap.
- L9: client chat length cap (server covered by H10).
- L10: pre-validate self-invite in friend route.
- L11: `GET /users/me/export` JSON dump.
- L12: `date_of_birth` + age gate on registration.

## Verification checklist after each phase

- `pnpm run test:backend`
- `pnpm run validate:maps`
- `pnpm -C backend tsc --noEmit`
- `pnpm -C frontend tsc --noEmit`
- Hand-trace each fix against the original bug scenario.
