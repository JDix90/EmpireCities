import { Pool, PoolClient } from 'pg';
import { config } from '../../config';

// Pool sizing: a busy game server does many concurrent short queries from
// socket handlers (snapshot writes, rating updates, matchmaking sweeps).
// 50 is a sensible default for single-node deploys; scale via PG_POOL_MAX
// when running behind PgBouncer or across multiple instances.
const POOL_MAX = Math.max(10, parseInt(process.env.PG_POOL_MAX || '50', 10));

/**
 * Per-statement cap (ms) — a runaway query (bad admin filter, full-table
 * recompute under cache miss, unindexed migration probe) won't pin a Postgres
 * backend and starve the rest of the pool. Long-running ops (migrations,
 * heavy admin reports) can `SET LOCAL statement_timeout` inside a transaction
 * to bypass for that one query. Override at deploy time with
 * `PG_STATEMENT_TIMEOUT_MS=…` if you need a different ceiling.
 */
const STATEMENT_TIMEOUT_MS = Math.max(
  500,
  parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '8000', 10),
);

export const pgPool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  user: config.postgres.user,
  password: config.postgres.password,
  database: config.postgres.database,
  max: POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Belt-and-suspenders cancellation: cap the time a TCP connection can sit
  // mid-query without progress (defends against half-open NAT/proxy idle
  // resets that leave the client thinking a query is still running).
  statement_timeout: STATEMENT_TIMEOUT_MS,
  query_timeout: STATEMENT_TIMEOUT_MS + 1_000,
});

pgPool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected error on idle client:', err);
});

export async function connectPostgres(): Promise<void> {
  const client = await pgPool.connect();
  console.log(`[PostgreSQL] Connected successfully (statement_timeout=${STATEMENT_TIMEOUT_MS}ms)`);
  client.release();
}

/**
 * Execute a parameterized query against PostgreSQL.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pgPool.query(text, params);
  return result.rows as T[];
}

/**
 * Execute a query and return a single row or null.
 */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a set of queries inside a single transaction on a pooled client.
 * Rolls back on any thrown error; always releases the client.
 *
 * Use this for read-then-write flows where correctness depends on the read
 * and the write being applied against the same snapshot (store purchases,
 * refresh-token rotation, lobby joins, matchmaking dequeue, rating writes).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow — original err is more informative
    }
    throw err;
  } finally {
    client.release();
  }
}
