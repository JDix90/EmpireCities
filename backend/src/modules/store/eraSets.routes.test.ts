/**
 * The era sets (migration 046): sold on the price ladder, and only with
 * store_v2_enabled on. With it off the store lists and sells exactly what it
 * did before, and an era set's item doesn't exist for it.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/store/eraSets.routes.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { COSMETIC_SETS } from '@borderfall/shared';

const enabled = process.env.PG_TEST === '1';

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
interface TestUser { id: string; name: string }

/** The ladder: common 200–250 gold, uncommon 450, rare 1,000; legendary and mythic never sold. */
const LADDER: Record<string, [min: number, max: number]> = {
  common: [200, 250],
  uncommon: [450, 450],
  rare: [1000, 1000],
};

describe.runIf(enabled)('era sets (Postgres)', () => {
  let app: FastifyInstance;
  let query: Query;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  const userIds: string[] = [];
  const TEMPLE = 'marker_imperium_temple';

  const setFlag = (on: boolean) => {
    process.env.STORE_V2_ENABLED = on ? 'true' : 'false';
  };
  const resetFlag = () => {
    delete process.env.STORE_V2_ENABLED;
  };

  async function seedUser(gold: number): Promise<TestUser> {
    const id = uuidv4();
    const name = `sets_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, gold) VALUES ($1, $2, $3, 'x', $4)`,
      [id, name, `${name}@test.local`, gold],
    );
    return { id, name };
  }

  const auth = (user: TestUser) => ({
    authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name })}`,
  });
  const catalogOf = async (user: TestUser) =>
    (await app.inject({ method: 'GET', url: '/api/store/catalog', headers: auth(user) })).json().catalog as Array<Record<string, unknown>>;
  const buy = (user: TestUser, cosmeticId: string) =>
    app.inject({ method: 'POST', url: '/api/store/buy', headers: auth(user), payload: { cosmetic_id: cosmeticId } });
  const goldOf = async (user: TestUser) =>
    (await query('SELECT gold FROM users WHERE user_id = $1', [user.id]))[0]!.gold as number;

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { storeRoutes } = await import('./store.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(storeRoutes, { prefix: '/api/store' });
    await app.ready();
  }, 30_000);

  afterEach(resetFlag);

  afterAll(async () => {
    resetFlag();
    if (app) await app.close();
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('prices every set item on the ladder, four items a set, one of each type', async () => {
    const rows = await query(
      `SELECT cosmetic_id, type, rarity, price_gems, earned_only, cosmetic_set FROM cosmetics
       WHERE cosmetic_set IS NOT NULL ORDER BY cosmetic_set, type`,
    );
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      const band = LADDER[row.rarity as string];
      expect(band, `${row.cosmetic_id}: ${row.rarity} is not sold`).toBeDefined();
      expect(row.price_gems, String(row.cosmetic_id)).toBeGreaterThanOrEqual(band![0]);
      expect(row.price_gems, String(row.cosmetic_id)).toBeLessThanOrEqual(band![1]);
      expect(row.earned_only).toBe(false);
    }
    const sets = [...new Set(rows.map((r) => r.cosmetic_set as string))];
    expect(sets.sort()).toEqual(Object.keys(COSMETIC_SETS).sort());
    for (const set of sets) {
      expect(rows.filter((r) => r.cosmetic_set === set).map((r) => r.type).sort())
        .toEqual(['dice_skin', 'map_marker', 'profile_banner', 'profile_frame']);
    }
  });

  it('prices no legendary or mythic item for sale', async () => {
    // Other test files' fixtures (`test_…`) include a priced legendary on
    // purpose: the buy route must refuse it all the same.
    const sold = await query(
      `SELECT cosmetic_id FROM cosmetics
       WHERE rarity IN ('legendary', 'mythic') AND COALESCE(price_gems, 0) > 0 AND NOT COALESCE(earned_only, false)
         AND cosmetic_id NOT LIKE 'test\\_%'`,
    );
    expect(sold).toEqual([]);
  });

  describe('with store_v2_enabled off', () => {
    beforeEach(() => setFlag(false));

    it('lists the old catalog exactly: no set items and no set field', async () => {
      const user = await seedUser(5000);
      const catalog = await catalogOf(user);
      expect(catalog.some((row) => String(row.cosmetic_id).includes('_imperium_'))).toBe(false);
      expect(catalog.every((row) => !('cosmetic_set' in row))).toBe(true);
    });

    it('does not sell a set item, and takes no gold', async () => {
      const user = await seedUser(5000);
      const res = await buy(user, TEMPLE);
      expect(res.statusCode).toBe(404);
      expect(await goldOf(user)).toBe(5000);
    });
  });

  describe('with store_v2_enabled on', () => {
    it('lists each set item with its set', async () => {
      setFlag(true);
      const user = await seedUser(5000);
      const temple = (await catalogOf(user)).find((row) => row.cosmetic_id === TEMPLE);
      expect(temple).toMatchObject({ cosmetic_set: 'imperium', price_gems: 450, rarity: 'uncommon', locked: false, owned: false });
    });

    it('sells a set item at its price', async () => {
      setFlag(true);
      const user = await seedUser(500);
      const res = await buy(user, TEMPLE);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ cosmetic_id: TEMPLE, new_balance: 50 });
      expect(await goldOf(user)).toBe(50);
    });
  });
});
