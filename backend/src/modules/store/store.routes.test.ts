/**
 * The store's buy route: the server checks price, ownership and balance; the
 * grant and the charge commit together or not at all; each purchase writes one
 * ledger row; earned, legendary and guest purchases are refused.
 *
 * The short balance is the case that mattered. The purchase transaction
 * inserted the grant, found the balance short and *returned*, and
 * withTransaction commits whatever its callback returns: the player saw 402
 * "Insufficient gold" and kept the item.
 *
 * The seeds block covers the other way items leaked. SQL seeds run after
 * migrations, so migration 030's earned-only UPDATE never saw the medals seed
 * 002 inserts, and the store handed them out as "Get Free".
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/store/store.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';
const DATABASE_DIR = join(__dirname, '../../../../database');

/** The seed-002 medals: earned in play, never sold. */
const MEDALS = ['frame_bronze', 'frame_silver', 'frame_gold', 'frame_champion', 'marker_skull', 'marker_crown'];

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
interface TestUser { id: string; name: string; guest: boolean }

describe.runIf(enabled)('POST /api/store/buy (Postgres)', () => {
  let app: FastifyInstance;
  let query: Query;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  const userIds: string[] = [];

  // This run's own catalog rows, so real items and parallel suites are untouched.
  const tag = uuidv4().slice(0, 8);
  const PRICE = 300;
  const item = (kind: string) => ({ id: `test_${tag}_${kind}`, name: `Test ${kind} ${tag}` });
  const BANNER = item('banner');
  const DICE = item('dice');
  const LEGENDARY = item('legendary');
  const EARNED = item('earned');
  /** Priced at 0 but not earned-only: what the retired starters were. */
  const UNPRICED = item('unpriced');

  async function seedUser(gold: number, { guest = false } = {}): Promise<TestUser> {
    const id = uuidv4();
    const name = `store_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, gold, is_guest)
       VALUES ($1, $2, $3, 'x', $4, $5)`,
      [id, name, `${name}@test.local`, gold, guest],
    );
    return { id, name, guest };
  }

  const buy = (user: TestUser, cosmeticId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/store/buy',
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: user.guest })}`,
      },
      payload: { cosmetic_id: cosmeticId },
    });

  async function owns(user: TestUser, cosmeticId: string): Promise<boolean> {
    const rows = await query('SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2', [user.id, cosmeticId]);
    return rows.length > 0;
  }

  async function goldOf(user: TestUser): Promise<number> {
    const rows = await query('SELECT gold FROM users WHERE user_id = $1', [user.id]);
    return rows[0]!.gold as number;
  }

  async function ledgerOf(user: TestUser): Promise<Array<{ amount: number; reason: string }>> {
    return (await query(
      'SELECT amount, reason FROM gold_transactions WHERE user_id = $1 ORDER BY created_at',
      [user.id],
    )) as Array<{ amount: number; reason: string }>;
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { storeRoutes } = await import('./store.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(storeRoutes, { prefix: '/api/store' });
    await app.ready();

    await query(
      `INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium, rarity, earned_only)
       VALUES ($1, 'profile_banner', $2, 'test', $11, true, 'common', false),
              ($3, 'dice_skin', $4, 'test', $11, true, 'common', false),
              ($5, 'profile_frame', $6, 'test', $11, true, 'legendary', false),
              ($7, 'profile_frame', $8, 'test', 0, true, 'common', true),
              ($9, 'dice_skin', $10, 'test', 0, false, 'common', false)`,
      [
        BANNER.id, BANNER.name, DICE.id, DICE.name, LEGENDARY.id, LEGENDARY.name,
        EARNED.id, EARNED.name, UNPRICED.id, UNPRICED.name, PRICE,
      ],
    );
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
    await query('DELETE FROM cosmetics WHERE cosmetic_id = ANY($1)', [
      [BANNER.id, DICE.id, LEGENDARY.id, EARNED.id, UNPRICED.id],
    ]).catch(() => {});
  });

  const catalogFor = (user: TestUser) =>
    app.inject({
      method: 'GET',
      url: '/api/store/catalog',
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: user.guest })}`,
      },
    });

  it("refuses a purchase the balance can't cover, and grants nothing", async () => {
    const user = await seedUser(PRICE - 1);

    const res = await buy(user, BANNER.id);

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ required: PRICE, balance: PRICE - 1 });
    expect(await owns(user, BANNER.id)).toBe(false);
    expect(await goldOf(user)).toBe(PRICE - 1);
    expect(await ledgerOf(user)).toEqual([]);
  });

  it('charges, grants and writes one ledger row', async () => {
    const user = await seedUser(PRICE + 50);

    const res = await buy(user, BANNER.id);

    expect(res.statusCode).toBe(200);
    expect(res.json().new_balance).toBe(50);
    expect(await owns(user, BANNER.id)).toBe(true);
    expect(await goldOf(user)).toBe(50);
    expect(await ledgerOf(user)).toEqual([{ amount: -PRICE, reason: `Purchased: ${BANNER.name}` }]);
  });

  it('does not sell an item twice or charge for the second try', async () => {
    const user = await seedUser(PRICE * 2);

    expect((await buy(user, BANNER.id)).statusCode).toBe(200);
    expect((await buy(user, BANNER.id)).statusCode).toBe(409);

    expect(await goldOf(user)).toBe(PRICE);
    expect(await ledgerOf(user)).toHaveLength(1);
  });

  it('with gold for one of two items bought at once, grants exactly one', async () => {
    const user = await seedUser(PRICE);

    const statuses = (await Promise.all([buy(user, BANNER.id), buy(user, DICE.id)]))
      .map((r) => r.statusCode)
      .sort();

    expect(statuses).toEqual([200, 402]);
    expect([await owns(user, BANNER.id), await owns(user, DICE.id)].filter(Boolean)).toHaveLength(1);
    expect(await goldOf(user)).toBe(0);
    expect(await ledgerOf(user)).toHaveLength(1);
  });

  it('charges once when one item is bought twice at once', async () => {
    const user = await seedUser(PRICE * 2);

    const statuses = (await Promise.all([buy(user, DICE.id), buy(user, DICE.id)]))
      .map((r) => r.statusCode)
      .sort();

    expect(statuses).toEqual([200, 409]);
    expect(await goldOf(user)).toBe(PRICE);
    expect(await ledgerOf(user)).toHaveLength(1);
  });

  it('refuses earned, legendary, unknown and guest purchases without touching gold', async () => {
    const user = await seedUser(PRICE * 4);
    const guest = await seedUser(PRICE * 4, { guest: true });

    expect((await buy(user, EARNED.id)).statusCode).toBe(403);
    expect((await buy(user, LEGENDARY.id)).statusCode).toBe(403);
    expect((await buy(user, `test_${tag}_missing`)).statusCode).toBe(404);
    expect((await buy(guest, BANNER.id)).statusCode).toBe(403);

    for (const who of [user, guest]) {
      expect(await goldOf(who)).toBe(PRICE * 4);
      expect(await ledgerOf(who)).toEqual([]);
    }
    expect(await owns(user, EARNED.id)).toBe(false);
    expect(await owns(user, LEGENDARY.id)).toBe(false);
    expect(await owns(guest, BANNER.id)).toBe(false);
  });

  it('refuses an unpriced item instead of handing it out, and lists it as locked', async () => {
    const user = await seedUser(0);

    const res = await buy(user, UNPRICED.id);

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('This item is not sold in the store');
    expect(await owns(user, UNPRICED.id)).toBe(false);
    const listed = (await catalogFor(user)).json().catalog
      .find((c: { cosmetic_id: string }) => c.cosmetic_id === UNPRICED.id);
    expect(listed).toMatchObject({ owned: false, locked: true });
  });

  it("returns the player's retirement refunds for the store's notice, and nothing else from the ledger", async () => {
    const user = await seedUser(0);
    // The reason format is migration 044's.
    await query(
      `INSERT INTO gold_transactions (user_id, amount, reason, created_at) VALUES
         ($1, 600, 'Refund: Radar Screen (retired from the store)', '2026-09-27T03:00:00Z'),
         ($1, 350, 'Refund: Sherman Tank (retired from the store)', '2026-09-27T03:00:00Z'),
         ($1, -600, 'Purchased: Radar Screen', '2026-09-01T00:00:00Z'),
         ($1, 20, 'Game win', '2026-09-02T00:00:00Z')`,
      [user.id],
    );

    const res = await catalogFor(user);

    expect(res.statusCode).toBe(200);
    expect(res.json().refunds).toEqual([
      { item: 'Radar Screen', gold: 600, refunded_at: '2026-09-27T03:00:00.000Z' },
      { item: 'Sherman Tank', gold: 350, refunded_at: '2026-09-27T03:00:00.000Z' },
    ]);
  });
});

describe.runIf(enabled)('earned medals stay out of the store (Postgres)', () => {
  let pgPool: Pool;

  /** Run `fn` in a transaction that is always rolled back: nothing it writes lands. */
  async function inRolledBackTransaction(fn: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }

  const sqlFile = (...parts: string[]) => readFileSync(join(DATABASE_DIR, ...parts), 'utf8');

  beforeAll(async () => {
    ({ pgPool } = (await import('../../db/postgres')) as unknown as { pgPool: Pool });
  });

  it('seeds applied after the migrations leave every free item earned-only', async () => {
    await inRolledBackTransaction(async (client) => {
      // A fresh database gets its seeds after every migration has run.
      const seeds = readdirSync(join(DATABASE_DIR, 'seeds')).filter((f) => f.endsWith('.sql')).sort();
      for (const seed of seeds) await client.query(sqlFile('seeds', seed));

      const { rows } = await client.query<{ cosmetic_id: string }>(
        `SELECT cosmetic_id FROM cosmetics
         WHERE COALESCE(price_gems, 0) = 0 AND NOT COALESCE(earned_only, false)`,
      );
      expect(rows.map((r) => r.cosmetic_id)).toEqual([]);
    });
  });

  it('migration 043 marks medals a seed inserted without the flag', async () => {
    await inRolledBackTransaction(async (client) => {
      // The rows as a migrate-then-seed database held them before the fix.
      for (const id of MEDALS) {
        await client.query(
          `INSERT INTO cosmetics (cosmetic_id, type, name, price_gems, is_premium, earned_only)
           VALUES ($1, $2, $1, 0, false, false)
           ON CONFLICT (cosmetic_id) DO UPDATE SET earned_only = false`,
          [id, id.startsWith('marker_') ? 'map_marker' : 'profile_frame'],
        );
      }

      await client.query(sqlFile('migrations', '043_seed_medals_earned_only.sql'));

      const { rows } = await client.query<{ cosmetic_id: string; earned_only: boolean }>(
        'SELECT cosmetic_id, earned_only FROM cosmetics WHERE cosmetic_id = ANY($1) ORDER BY cosmetic_id',
        [MEDALS],
      );
      expect(rows).toEqual([...MEDALS].sort().map((cosmetic_id) => ({ cosmetic_id, earned_only: true })));
    });
  });
});
