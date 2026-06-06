/**
 * Compare authoritative Redis game state with latest Postgres backup row.
 * Used by the Redis migration staging gate (Phase 3/5 spot-check).
 */

import { queryOne } from '../../src/db/postgres';
import { getGameState } from '../../src/sockets/redisGameStore';
import type { GameState } from '../../src/types';

export interface StateCompareResult {
  ok: boolean;
  gameId: string;
  redisPresent: boolean;
  postgresPresent: boolean;
  redisTurn?: number;
  postgresTurn?: number;
  diffs: string[];
}

/** Fields that may legitimately differ briefly or are not persisted identically. */
const IGNORE_PATHS = new Set([
  'turn_started_at',
  'win_probability_history',
  'active_event_result',
  'last_rebellion_territories',
]);

function collectDiffs(a: unknown, b: unknown, path = ''): string[] {
  if (a === b) return [];
  if (a == null || b == null) {
    if (a == null && b == null) return [];
    return [`${path || '(root)'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
  }
  if (typeof a !== typeof b) {
    return [`${path}: type ${typeof a} vs ${typeof b}`];
  }
  if (typeof a !== 'object') {
    return [`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return [`${path}.length: ${a.length} vs ${b.length}`];
    }
    const out: string[] = [];
    for (let i = 0; i < a.length; i++) {
      out.push(...collectDiffs(a[i], b[i], `${path}[${i}]`));
    }
    return out;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  const out: string[] = [];
  for (const key of keys) {
    const childPath = path ? `${path}.${key}` : key;
    if (IGNORE_PATHS.has(key) || IGNORE_PATHS.has(childPath)) continue;
    out.push(...collectDiffs(aObj[key], bObj[key], childPath));
  }
  return out;
}

export async function waitForStoresInSync(
  gameId: string,
  timeoutMs = 5000,
): Promise<StateCompareResult> {
  const deadline = Date.now() + timeoutMs;
  let result = await compareGameStateStores(gameId);
  while (!result.ok && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    result = await compareGameStateStores(gameId);
  }
  return result;
}

export async function compareGameStateStores(
  gameId: string,
  options?: { waitForPostgresMs?: number },
): Promise<StateCompareResult> {
  if (options?.waitForPostgresMs && options.waitForPostgresMs > 0) {
    await new Promise((r) => setTimeout(r, options.waitForPostgresMs));
  }

  const redisState = await getGameState(gameId);
  const pgRow = await queryOne<{ turn_number: number; state_json: GameState }>(
    `SELECT turn_number, state_json FROM game_states
     WHERE game_id = $1 ORDER BY turn_number DESC, saved_at DESC LIMIT 1`,
    [gameId],
  );

  const result: StateCompareResult = {
    ok: false,
    gameId,
    redisPresent: !!redisState,
    postgresPresent: !!pgRow,
    redisTurn: redisState?.turn_number,
    postgresTurn: pgRow?.turn_number,
    diffs: [],
  };

  if (!redisState) {
    result.diffs.push('Redis state missing');
    return result;
  }
  if (!pgRow) {
    result.diffs.push('Postgres backup row missing');
    return result;
  }

  if (redisState.turn_number !== pgRow.turn_number) {
    result.diffs.push(`turn_number: redis=${redisState.turn_number} postgres=${pgRow.turn_number}`);
  }

  result.diffs.push(...collectDiffs(redisState, pgRow.state_json));
  result.ok = result.diffs.length === 0;
  return result;
}

export function formatCompareResult(result: StateCompareResult): string {
  const lines = [
    `[compare] game=${result.gameId} ok=${result.ok}`,
    `  redis=${result.redisPresent ? `turn ${result.redisTurn}` : 'missing'}`,
    `  postgres=${result.postgresPresent ? `turn ${result.postgresTurn}` : 'missing'}`,
  ];
  if (result.diffs.length > 0) {
    lines.push('  diffs:');
    for (const d of result.diffs.slice(0, 20)) lines.push(`    - ${d}`);
    if (result.diffs.length > 20) lines.push(`    ... and ${result.diffs.length - 20} more`);
  }
  return lines.join('\n');
}
