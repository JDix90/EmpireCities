/**
 * Load test: a burst of N concurrent solo quick matches, each driven by a
 * passive socket player that advances through its phases and lets the AI
 * seats fight. Surfaces redlock contention, Redis persistence failures, and
 * turn-loop stalls that single-game testing can't.
 *
 * Usage:
 *   pnpm -C backend exec tsx scripts/loadTestSoloBurst.ts [games] [turns] [baseUrl]
 * Defaults: 12 games, 8 turns each, http://localhost:3001
 *
 * Reads /metrics/json before and after to report lock/persistence failure
 * deltas. Exits non-zero if any game stalled or hard-failed.
 */

import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';

const GAMES = Number(process.argv[2] ?? 12);
const MAX_TURNS = Number(process.argv[3] ?? 8);
const BASE = process.argv[4] ?? 'http://localhost:3001';
/** No state broadcast for this long while in-progress = the game is stuck. */
const STALL_MS = 45_000;

interface GameResult {
  index: number;
  gameId: string | null;
  turnsReached: number;
  actionsSent: number;
  latencies: number[];
  errors: Array<{ code?: string; message: string }>;
  stalled: boolean;
  finished: boolean;
  failure: string | null;
}

interface ClientGameState {
  phase: string;
  turn_number: number;
  current_player_index: number;
  players: Array<{ player_id: string; is_ai: boolean }>;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function metricsSnapshot(): Promise<Record<string, unknown> | null> {
  try {
    return await fetchJson<Record<string, unknown>>('/metrics/json');
  } catch {
    return null; // endpoint disabled — deltas just won't be reported
  }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

async function runGame(index: number): Promise<GameResult> {
  const result: GameResult = {
    index,
    gameId: null,
    turnsReached: 0,
    actionsSent: 0,
    latencies: [],
    errors: [],
    stalled: false,
    finished: false,
    failure: null,
  };

  let socket: Socket | null = null;
  try {
    const guest = await fetchJson<{ accessToken: string; user: { user_id: string } }>(
      '/api/auth/guest',
      { method: 'POST', body: '{}' },
    );
    const myId = guest.user.user_id;

    const created = await fetchJson<{ game_id: string }>('/api/games', {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.accessToken}` },
      body: JSON.stringify({
        era_id: 'ancient',
        map_id: 'era_ancient',
        max_players: 4,
        ai_count: 3,
        ai_difficulty: 'medium',
        auto_start: true,
        settings: {
          turn_timer_seconds: 300,
          allowed_victory_conditions: ['domination'],
          initial_unit_count: 3,
          card_set_escalating: true,
          diplomacy_enabled: true,
          max_turns: 150,
        },
      }),
    });
    result.gameId = created.game_id;

    await new Promise<void>((resolve) => {
      const s = io(BASE, { auth: { token: guest.accessToken }, transports: ['websocket'] });
      socket = s;

      let lastStateAt = Date.now();
      let pendingEmitAt = 0;
      let lastAdvanceKey = '';
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(stallTimer);
        s.disconnect();
        resolve();
      };

      const stallTimer = setInterval(() => {
        if (Date.now() - lastStateAt > STALL_MS) {
          result.stalled = true;
          result.failure = `no state broadcast for ${STALL_MS / 1000}s (turn ${result.turnsReached})`;
          finish();
        }
      }, 5_000);

      s.on('connect', () => s.emit('game:join', { gameId: created.game_id }));
      s.on('connect_error', (err) => {
        result.failure = `socket connect_error: ${err.message}`;
        finish();
      });

      s.on('error', (payload: { message?: string; code?: string }) => {
        result.errors.push({ code: payload?.code, message: payload?.message ?? 'unknown' });
      });

      s.on('game:state', (state: ClientGameState) => {
        lastStateAt = Date.now();
        if (pendingEmitAt) {
          result.latencies.push(Date.now() - pendingEmitAt);
          pendingEmitAt = 0;
        }
        result.turnsReached = Math.max(result.turnsReached, state.turn_number);

        if (state.phase === 'game_over') {
          result.finished = true;
          return finish();
        }
        if (state.turn_number > MAX_TURNS) {
          return finish(); // played enough — leave the AI seats to their war
        }

        const current = state.players[state.current_player_index];
        if (!current || current.player_id !== myId) return;
        if (!['draft', 'attack', 'fortify'].includes(state.phase)) return;

        // One advance per (turn, phase): a re-broadcast of the same state
        // (e.g. another client action) must not double-fire.
        const key = `${state.turn_number}:${state.phase}`;
        if (lastAdvanceKey === key) return;
        lastAdvanceKey = key;

        // Small human-ish delay so 12 games don't act in perfect lockstep.
        setTimeout(() => {
          if (settled) return;
          pendingEmitAt = Date.now();
          result.actionsSent++;
          s.emit('game:advance_phase', { gameId: created.game_id, action_id: randomUUID() });
        }, 100 + Math.floor(Math.random() * 400));
      });
    });
  } catch (err) {
    result.failure = result.failure ?? (err instanceof Error ? err.message : String(err));
  } finally {
    (socket as Socket | null)?.disconnect();
  }
  return result;
}

async function main(): Promise<void> {
  console.log(`Load test: ${GAMES} concurrent solo games × ${MAX_TURNS} turns against ${BASE}\n`);
  const before = await metricsSnapshot();

  const startedAt = Date.now();
  // Stagger starts slightly: 12 simultaneous bcrypt hashes + game inits in
  // the same tick is a thundering herd no real lobby produces.
  const runs = Array.from({ length: GAMES }, (_, i) =>
    new Promise<GameResult>((resolve) => {
      setTimeout(() => runGame(i).then(resolve), i * 150);
    }),
  );
  const results = await Promise.all(runs);
  const wallSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  const after = await metricsSnapshot();

  const allLatencies = results.flatMap((r) => r.latencies).sort((a, b) => a - b);
  const errors = results.flatMap((r) => r.errors);
  const stalled = results.filter((r) => r.stalled);
  const failed = results.filter((r) => r.failure && !r.stalled);
  const totalActions = results.reduce((s, r) => s + r.actionsSent, 0);

  console.log('── Results ───────────────────────────────────────────');
  console.log(`wall time: ${wallSeconds}s`);
  console.log(`games: ${results.length}, reached ≥${MAX_TURNS} turns or game_over: ${results.filter((r) => r.turnsReached >= MAX_TURNS || r.finished).length}`);
  console.log(`actions sent: ${totalActions}`);
  console.log(`action→state latency ms: p50=${quantile(allLatencies, 0.5)} p95=${quantile(allLatencies, 0.95)} max=${allLatencies.at(-1) ?? 0}`);
  console.log(`socket errors: ${errors.length}${errors.length ? ' — ' + JSON.stringify(errors.slice(0, 5)) : ''}`);
  console.log(`stalled games: ${stalled.length}${stalled.length ? ' — ' + stalled.map((r) => `#${r.index}(${r.failure})`).join(', ') : ''}`);
  console.log(`hard failures: ${failed.length}${failed.length ? ' — ' + failed.map((r) => `#${r.index}: ${r.failure}`).join('; ') : ''}`);

  if (before && after) {
    const b = before.redis_migration as Record<string, number> | undefined;
    const a = after.redis_migration as Record<string, number> | undefined;
    if (b && a) {
      console.log('── Server metric deltas ──────────────────────────────');
      for (const k of Object.keys(a)) {
        const delta = (a[k] ?? 0) - (b[k] ?? 0);
        if (delta !== 0) console.log(`  ${k}: +${delta}`);
      }
      if (Object.keys(a).every((k) => (a[k] ?? 0) - (b[k] ?? 0) === 0)) {
        console.log('  no lock/persistence failures recorded');
      }
    }
    console.log(`  active_game_rooms: ${before.active_game_rooms} → ${after.active_game_rooms}`);
    const rssMb = (n: unknown) => Math.round(Number(n) / 1024 / 1024);
    console.log(`  rss: ${rssMb(before.rss_bytes)}MB → ${rssMb(after.rss_bytes)}MB`);
  }

  const ok = stalled.length === 0 && failed.length === 0;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

void main();
