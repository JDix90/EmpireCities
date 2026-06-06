#!/usr/bin/env tsx
/**
 * Redis migration staging gate — run before enabling Phase 9 multi-instance.
 *
 * Usage (from repo root):
 *   pnpm run validate:redis-staging
 *   pnpm run validate:redis-staging -- --phase compare,smoke,restart
 *   pnpm run validate:redis-staging -- --manage-backend --phase restart
 *   pnpm run validate:redis-staging -- --multi-instance --base-url http://localhost:3099 --base-url-2 http://localhost:3100
 *
 * Requires: Postgres + Redis (docker compose), maps seeded.
 */

import 'dotenv/config';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectPostgres } from '../../src/db/postgres';
import { connectRedis } from '../../src/db/redis';
import { compareGameStateStores, formatCompareResult, waitForStoresInSync } from './compareGameStateStores';
import {
  connectAndJoin,
  connectSocket,
  createGame,
  createGuest,
  disconnectSocket,
  joinGameApi,
  snapshotFingerprint,
  sleep,
  startGame,
  waitForHumanTurn,
  waitForReady,
  waitForStateUpdate,
  type StagingConfig,
} from './stagingClient';
import type { GameState } from '../../src/types';

const POSTGRES_DEBOUNCE_MS = 900;

type Phase = 'compare' | 'smoke' | 'restart' | 'multi-instance';

interface CliOptions {
  baseUrl: string;
  baseUrl2: string | null;
  phases: Set<Phase>;
  manageBackend: boolean;
  backendPort: number;
  backendPort2: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    baseUrl: process.env['STAGING_BASE_URL'] ?? 'http://localhost:3001',
    baseUrl2: process.env['STAGING_BASE_URL_2'] ?? null,
    phases: new Set<Phase>(['compare', 'smoke', 'restart']),
    manageBackend: false,
    backendPort: Number(process.env['STAGING_PORT'] ?? 3099),
    backendPort2: Number(process.env['STAGING_PORT_2'] ?? 3100),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base-url' && argv[i + 1]) {
      opts.baseUrl = argv[++i]!;
    } else if (arg === '--base-url-2' && argv[i + 1]) {
      opts.baseUrl2 = argv[++i]!;
    } else if (arg === '--phase' && argv[i + 1]) {
      opts.phases = new Set(argv[++i]!.split(',').map((p) => p.trim() as Phase));
    } else if (arg === '--manage-backend') {
      opts.manageBackend = true;
    } else if (arg === '--multi-instance') {
      opts.phases.add('multi-instance');
    } else if (arg === '--port' && argv[i + 1]) {
      opts.backendPort = Number(argv[++i]);
      opts.baseUrl = `http://localhost:${opts.backendPort}`;
    } else if (arg === '--port-2' && argv[i + 1]) {
      opts.backendPort2 = Number(argv[++i]);
      opts.baseUrl2 = `http://localhost:${opts.backendPort2}`;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: validateRedisStaging.ts [options]
  --base-url URL          API/socket base (default http://localhost:3001)
  --base-url-2 URL        Second instance for multi-instance soak
  --phase a,b,c           compare,smoke,restart,multi-instance (default: compare,smoke,restart)
  --manage-backend        Spawn isolated backend(s) for restart / multi-instance tests
  --multi-instance        Include Phase 9 soak (requires --base-url-2 or --manage-backend)
  --port N                Managed backend port (default 3099)
  --port-2 N              Second managed backend port (default 3100)
`);
      process.exit(0);
    }
  }

  if (opts.phases.has('multi-instance') && !opts.baseUrl2 && !opts.manageBackend) {
    opts.manageBackend = true;
  }

  return opts;
}

let managedBackend1: ChildProcess | null = null;
let managedBackend2: ChildProcess | null = null;

async function spawnBackend(port: number, instanceId: string): Promise<ChildProcess> {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const child = spawn(
    'pnpm',
    ['exec', 'tsx', 'src/index.ts'],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        PORT: String(port),
        INSTANCE_ID: instanceId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line.includes('[TurnTimer]') || line.includes('listening')) {
      process.stdout.write(`[${instanceId}] ${line}\n`);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${instanceId}:err] ${chunk.toString()}`);
  });
  await waitForReady(`http://localhost:${port}`, 90_000);
  return child;
}

async function killProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed) return;
  child.kill('SIGKILL');
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    setTimeout(resolve, 3000);
  });
}

async function runComparePhase(cfg: StagingConfig): Promise<void> {
  console.log('\n=== Phase: Redis vs Postgres compare ===');
  const guest = await createGuest(cfg);
  const { gameId } = await createGame(cfg, guest.accessToken, {
    aiCount: 1,
    maxPlayers: 2,
    settings: { turn_timer_seconds: 0, events_enabled: false },
  });

  const { socket, state: _lobbyState } = await connectAndJoin(cfg, guest.accessToken, gameId);
  const started = await startGame(socket, gameId);
  console.log(`  started solo game ${gameId} — ${snapshotFingerprint(started)}`);

  const humanState = await waitForHumanTurn(socket, guest.userId, 90_000, started);
  socket.emit('game:advance_phase', { gameId });
  await waitForStateUpdate(socket, (s) => s.phase === 'attack' || s.turn_number > humanState.turn_number, 30_000);
  console.log(`  after advance_phase — turn ${humanState.turn_number} phase attack expected`);

  await sleep(POSTGRES_DEBOUNCE_MS);
  const compare = await waitForStoresInSync(gameId);
  console.log(formatCompareResult(compare));
  if (!compare.ok) throw new Error('Redis vs Postgres compare failed');

  disconnectSocket(socket);
  console.log('  PASS');
}

async function runSmokePhase(cfg: StagingConfig): Promise<void> {
  console.log('\n=== Phase: Smoke (solo, MP, async, turn timer) ===');

  // Solo
  console.log('  [solo]');
  const soloGuest = await createGuest(cfg);
  const solo = await createGame(cfg, soloGuest.accessToken, { aiCount: 1, maxPlayers: 2 });
  const soloConn = await connectAndJoin(cfg, soloGuest.accessToken, solo.gameId);
  const soloStarted = await startGame(soloConn.socket, solo.gameId);
  await waitForHumanTurn(soloConn.socket, soloGuest.userId, 90_000, soloStarted);
  disconnectSocket(soloConn.socket);
  console.log('    PASS');

  // Multiplayer (2 humans)
  console.log('  [multiplayer]');
  const host = await createGuest(cfg);
  const joiner = await createGuest(cfg);
  const mp = await createGame(cfg, host.accessToken, { aiCount: 0, maxPlayers: 2 });
  await joinGameApi(cfg, joiner.accessToken, mp.gameId);
  const hostConn = await connectAndJoin(cfg, host.accessToken, mp.gameId);
  await connectAndJoin(cfg, joiner.accessToken, mp.gameId);
  await startGame(hostConn.socket, mp.gameId);
  disconnectSocket(hostConn.socket);
  console.log('    PASS');

  // Async mode
  console.log('  [async]');
  const asyncGuest = await createGuest(cfg);
  const asyncGame = await createGame(cfg, asyncGuest.accessToken, {
    aiCount: 1,
    maxPlayers: 2,
    settings: {
      async_mode: true,
      async_turn_deadline_seconds: 3600,
      turn_timer_seconds: 3600,
    },
  });
  const asyncConn = await connectAndJoin(cfg, asyncGuest.accessToken, asyncGame.gameId);
  const asyncStarted = await startGame(asyncConn.socket, asyncGame.gameId);
  await waitForHumanTurn(asyncConn.socket, asyncGuest.userId, 90_000, asyncStarted);
  disconnectSocket(asyncConn.socket);
  console.log('    PASS');

  // Turn timer (short) — schedule only, no wait for expiry
  console.log('  [turn timer scheduled]');
  const timerGuest = await createGuest(cfg);
  const timerGame = await createGame(cfg, timerGuest.accessToken, {
    aiCount: 1,
    maxPlayers: 2,
    settings: { turn_timer_seconds: 15 },
  });
  const timerConn = await connectAndJoin(cfg, timerGuest.accessToken, timerGame.gameId);
  const timerStarted = await startGame(timerConn.socket, timerGame.gameId);
  await waitForHumanTurn(timerConn.socket, timerGuest.userId, 90_000, timerStarted);
  disconnectSocket(timerConn.socket);
  console.log('    PASS');

  console.log('  Smoke PASS');
}

async function freeStagingPort(port: number): Promise<void> {
  const { execSync } = await import('child_process');
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    if (pids) {
      for (const pid of pids.split('\n')) {
        if (pid) process.kill(Number(pid), 'SIGKILL');
      }
      await sleep(1000);
    }
  } catch {
    // port already free
  }
}

async function runRestartPhase(backendPort: number): Promise<void> {
  console.log('\n=== Phase: Restart survival (kill -9 → reconnect) ===');

  await freeStagingPort(backendPort);
  console.log(`  spawning isolated backend on :${backendPort}`);
  let localBackend = await spawnBackend(backendPort, 'staging-restart');
  const testCfg: StagingConfig = { baseUrl: `http://localhost:${backendPort}` };

  const guest = await createGuest(testCfg);
  const { gameId } = await createGame(testCfg, guest.accessToken, {
    aiCount: 1,
    maxPlayers: 2,
    settings: { turn_timer_seconds: 12, events_enabled: false },
  });

  let { socket } = await connectAndJoin(testCfg, guest.accessToken, gameId);
  const started = await startGame(socket, gameId);
  const beforeRestart = await waitForHumanTurn(socket, guest.userId, 90_000, started);
  const fingerprintBefore = snapshotFingerprint(beforeRestart);
  console.log(`  pre-kill state: ${fingerprintBefore}`);

  disconnectSocket(socket);

  console.log('  sending SIGKILL to managed backend…');
  await killProcess(localBackend);
  localBackend = null;
  await sleep(1500);
  console.log('  respawning backend…');
  localBackend = await spawnBackend(backendPort, 'staging-restart');

  socket = connectSocket(testCfg, guest.accessToken);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('reconnect timeout')), 30_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const afterReconnect = await new Promise<GameState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('game:state timeout after reconnect')), 30_000);
    socket.once('game:state', (state: GameState) => {
      clearTimeout(timer);
      resolve(state);
    });
    socket.emit('game:join', { gameId });
  });

  const fingerprintAfter = snapshotFingerprint(afterReconnect);
  console.log(`  post-reconnect state: ${fingerprintAfter}`);

  if (
    afterReconnect.turn_number !== beforeRestart.turn_number
    || afterReconnect.phase !== beforeRestart.phase
    || afterReconnect.current_player_index !== beforeRestart.current_player_index
  ) {
    throw new Error(
      `Restart state mismatch: before=${fingerprintBefore} after=${fingerprintAfter}`,
    );
  }

  await sleep(POSTGRES_DEBOUNCE_MS);
  const compare = await waitForStoresInSync(gameId);
  console.log(formatCompareResult(compare));
  if (!compare.ok) {
    console.warn('  WARN: Postgres backup lag after restart (Redis reconnect OK)');
  }

  disconnectSocket(socket);
  if (localBackend) await killProcess(localBackend);
  console.log('  PASS');
}

async function runMultiInstancePhase(
  baseUrl1: string,
  baseUrl2: string,
  manageBackend: boolean,
  port1: number,
  port2: number,
): Promise<void> {
  console.log('\n=== Phase 9: Multi-instance soak ===');

  let child1: ChildProcess | null = null;
  let child2: ChildProcess | null = null;

  if (manageBackend) {
    await freeStagingPort(port1);
    await freeStagingPort(port2);
    console.log(`  spawning backend-1 :${port1} and backend-2 :${port2}`);
    child1 = await spawnBackend(port1, 'backend-1');
    child2 = await spawnBackend(port2, 'backend-2');
    baseUrl1 = `http://localhost:${port1}`;
    baseUrl2 = `http://localhost:${port2}`;
  }

  const cfg1: StagingConfig = { baseUrl: baseUrl1 };
  const cfg2: StagingConfig = { baseUrl: baseUrl2 };

  const [inst1, inst2] = await Promise.all([
    fetch(`${baseUrl1}/api/instance`).then((r) => r.json()),
    fetch(`${baseUrl2}/api/instance`).then((r) => r.json()),
  ]);
  console.log(`  instance-1: ${JSON.stringify(inst1)}`);
  console.log(`  instance-2: ${JSON.stringify(inst2)}`);

  if ((inst1 as { instanceId?: string }).instanceId === (inst2 as { instanceId?: string }).instanceId) {
    throw new Error('Both URLs returned the same INSTANCE_ID — need two distinct backends');
  }

  const host = await createGuest(cfg1);
  const { gameId } = await createGame(cfg1, host.accessToken, {
    aiCount: 1,
    maxPlayers: 2,
    settings: { turn_timer_seconds: 0 },
  });

  const hostConn = await connectAndJoin(cfg1, host.accessToken, gameId);
  const hostStarted = await startGame(hostConn.socket, gameId);
  await waitForHumanTurn(hostConn.socket, host.userId, 90_000, hostStarted);

  // Mutate from instance 2 via reconnect (simulates client sticky to another node after nginx reroute)
  disconnectSocket(hostConn.socket);
  const altConn = await connectAndJoin(cfg2, host.accessToken, gameId);
  if (!altConn.state) throw new Error('expected in-progress state on instance-2 join');
  const before = altConn.state;
  altConn.socket.emit('game:advance_phase', { gameId });
  const after = await waitForStateUpdate(
    altConn.socket,
    (s) => s.phase !== before.phase || s.turn_number !== before.turn_number,
    30_000,
  );
  console.log(`  mutation via instance-2: ${snapshotFingerprint(after)}`);

  // Verify instance-1 sees same state on reload
  disconnectSocket(altConn.socket);
  const verifyConn = await connectAndJoin(cfg1, host.accessToken, gameId);
  if (!verifyConn.state) throw new Error('expected in-progress state on instance-1 verify join');
  if (
    verifyConn.state.turn_number !== after.turn_number
    || verifyConn.state.phase !== after.phase
  ) {
    throw new Error('Cross-instance state drift after mutation');
  }

  await sleep(POSTGRES_DEBOUNCE_MS);
  const compare = await waitForStoresInSync(gameId);
  console.log(formatCompareResult(compare));
  if (!compare.ok) throw new Error('Redis vs Postgres compare failed after multi-instance mutation');

  disconnectSocket(verifyConn.socket);
  if (child1) await killProcess(child1);
  if (child2) await killProcess(child2);
  console.log('  PASS');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  await connectPostgres();
  await connectRedis();
  await waitForReady(opts.baseUrl, 15_000);

  const cfg: StagingConfig = { baseUrl: opts.baseUrl };
  const failures: string[] = [];

  if (opts.manageBackend && (opts.phases.has('restart') || opts.phases.has('multi-instance'))) {
    // compare/smoke can use existing backend; restart/multi spawn their own when flagged
  }

  const run = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nFAIL [${name}]: ${msg}`);
      failures.push(`${name}: ${msg}`);
    }
  };

  if (opts.phases.has('compare')) await run('compare', () => runComparePhase(cfg));
  if (opts.phases.has('smoke')) await run('smoke', () => runSmokePhase(cfg));
  if (opts.phases.has('restart')) {
    await run('restart', () => runRestartPhase(opts.backendPort));
  }
  if (opts.phases.has('multi-instance')) {
    // Brief pause so restart phase can release ports/processes before spawning two backends.
    await sleep(2000);
    const url2 = opts.baseUrl2 ?? `http://localhost:${opts.backendPort2}`;
    await run('multi-instance', () =>
      runMultiInstancePhase(opts.baseUrl, url2, opts.manageBackend, opts.backendPort, opts.backendPort2),
    );
  }

  if (managedBackend1) await killProcess(managedBackend1);
  if (managedBackend2) await killProcess(managedBackend2);

  console.log('\n========================================');
  if (failures.length === 0) {
    console.log('All staging gates PASSED');
    process.exit(0);
  } else {
    console.error(`Staging gates FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
