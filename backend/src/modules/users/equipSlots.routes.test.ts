/**
 * Equip slots with the store overhaul (`store_v2_enabled`) on, and unchanged
 * with it off.
 *
 * Banners shared `equipped_frame` with frames, so wearing one took the frame
 * off, and nothing could be unequipped: the UPDATE was `COALESCE($1, column)`.
 * With the flag on, a banner has its own slot (migration 045), `null` takes an
 * item off, and a banner left in the frame slot from before reads as the
 * banner. With it off, the route and `/me` behave exactly as before.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/users/equipSlots.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
interface TestUser { id: string; name: string; guest: boolean }

describe.runIf(enabled)('PUT /api/users/me/cosmetics/equip (Postgres)', () => {
  let app: FastifyInstance;
  let query: Query;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  const userIds: string[] = [];
  const tag = uuidv4().slice(0, 8);
  const FRAME = `test_${tag}_frame`;
  const BANNER = `test_${tag}_banner`;
  const BANNER2 = `test_${tag}_banner2`;
  const DICE = `test_${tag}_dice`;

  function setFlag(on: boolean) {
    if (on) process.env.STORE_V2_ENABLED = 'true';
    else delete process.env.STORE_V2_ENABLED;
  }

  async function seedUser({ guest = false } = {}): Promise<TestUser> {
    const id = uuidv4();
    const name = `equip_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest) VALUES ($1, $2, $3, 'x', $4)`,
      [id, name, `${name}@test.local`, guest],
    );
    for (const cosmetic of [FRAME, BANNER, BANNER2, DICE]) {
      await query('INSERT INTO user_cosmetics (user_id, cosmetic_id) VALUES ($1, $2)', [id, cosmetic]);
    }
    return { id, name, guest };
  }

  const headers = (user: TestUser) => ({
    authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: user.guest })}`,
  });
  const equip = (user: TestUser, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/users/me/cosmetics/equip', headers: headers(user), payload });
  const me = async (user: TestUser) =>
    (await app.inject({ method: 'GET', url: '/api/users/me', headers: headers(user) })).json();
  const stored = async (user: TestUser) =>
    (await query(
      'SELECT equipped_frame, equipped_banner, equipped_marker, equipped_dice FROM users WHERE user_id = $1',
      [user.id],
    ))[0];

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
    // Earned-only like every unpriced item: the store's own tests run alongside
    // and assert that no free item is claimable.
    await query(
      `INSERT INTO cosmetics (cosmetic_id, type, name, price_gems, is_premium, earned_only) VALUES
         ($1, 'profile_frame', $1, 0, false, true),
         ($2, 'profile_banner', $2, 0, false, true),
         ($3, 'profile_banner', $3, 0, false, true),
         ($4, 'dice_skin', $4, 0, false, true)`,
      [FRAME, BANNER, BANNER2, DICE],
    );
  }, 30_000);

  afterEach(() => setFlag(false));

  afterAll(async () => {
    setFlag(false);
    if (app) await app.close();
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    await query('DELETE FROM cosmetics WHERE cosmetic_id = ANY($1)', [[FRAME, BANNER, BANNER2, DICE]]).catch(() => {});
  });

  describe('with store_v2_enabled on', () => {
    it('wears a banner and a frame together, each in its own slot', async () => {
      setFlag(true);
      const user = await seedUser();

      expect((await equip(user, { frame_id: FRAME })).statusCode).toBe(200);
      const res = await equip(user, { banner_id: BANNER });

      expect(res.json()).toEqual({ ok: true, equipped: { frame: FRAME, banner: BANNER, marker: null, dice: null } });
      expect(await stored(user)).toEqual({
        equipped_frame: FRAME, equipped_banner: BANNER, equipped_marker: null, equipped_dice: null,
      });
      expect(await me(user)).toMatchObject({ equipped_frame: FRAME, equipped_banner: BANNER });
    });

    it('takes an item off with null and keeps the slots left out', async () => {
      setFlag(true);
      const user = await seedUser();
      await equip(user, { frame_id: FRAME, banner_id: BANNER, dice_id: DICE });

      const res = await equip(user, { banner_id: null, dice_id: null });

      expect(res.json().equipped).toEqual({ frame: FRAME, banner: null, marker: null, dice: null });
      expect(await stored(user)).toMatchObject({ equipped_frame: FRAME, equipped_banner: null, equipped_dice: null });
    });

    it('puts each item only in its own slot, and only if owned', async () => {
      setFlag(true);
      const user = await seedUser();

      expect((await equip(user, { frame_id: BANNER })).statusCode).toBe(403);
      expect((await equip(user, { banner_id: FRAME })).statusCode).toBe(403);
      expect((await equip(user, { dice_id: `test_${tag}_missing` })).statusCode).toBe(403);
      expect((await equip(user, { frame_id: 42 })).statusCode).toBe(400);
      expect(await stored(user)).toMatchObject({ equipped_frame: null, equipped_banner: null, equipped_dice: null });
    });

    it('reads a banner left in the frame slot as the banner, and moves it when the frame changes', async () => {
      setFlag(true);
      const user = await seedUser();
      await query('UPDATE users SET equipped_frame = $2 WHERE user_id = $1', [user.id, BANNER]);

      expect(await me(user)).toMatchObject({ equipped_frame: null, equipped_banner: BANNER });
      const other = await seedUser();
      const profile = (await app.inject({ method: 'GET', url: `/api/users/${user.id}`, headers: headers(other) })).json();
      expect(profile).toMatchObject({ equipped_frame: null, equipped_banner: BANNER });
      expect(profile).not.toHaveProperty('equipped_frame_type');

      await equip(user, { frame_id: FRAME });

      expect(await stored(user)).toMatchObject({ equipped_frame: FRAME, equipped_banner: BANNER });
    });

    it('survives the flag going off and on: the banner last worn wins', async () => {
      setFlag(true);
      const user = await seedUser();
      await equip(user, { frame_id: FRAME, banner_id: BANNER });

      setFlag(false);
      await equip(user, { frame_id: BANNER2 }); // the old route: the banner takes the frame slot
      setFlag(true);

      expect(await me(user)).toMatchObject({ equipped_frame: null, equipped_banner: BANNER2 });
      const res = await equip(user, { dice_id: DICE });
      expect(res.json().equipped).toEqual({ frame: null, banner: BANNER2, marker: null, dice: DICE });
      expect(await stored(user)).toMatchObject({ equipped_frame: null, equipped_banner: BANNER2 });
    });

    it('still refuses guests', async () => {
      setFlag(true);
      const guest = await seedUser({ guest: true });
      expect((await equip(guest, { frame_id: FRAME })).statusCode).toBe(403);
    });
  });

  describe('with store_v2_enabled off', () => {
    it('equips exactly as before: a banner takes the frame slot and null changes nothing', async () => {
      const user = await seedUser();

      expect((await equip(user, { frame_id: BANNER })).json()).toEqual({ ok: true });
      expect(await stored(user)).toMatchObject({ equipped_frame: BANNER, equipped_banner: null });

      await equip(user, { frame_id: null });
      expect(await stored(user)).toMatchObject({ equipped_frame: BANNER });

      // The payload from before the overhaul: no banner slot, and the frame's
      // catalog type stays on the server.
      const body = await me(user);
      expect(body).toMatchObject({ equipped_frame: BANNER });
      expect(body).not.toHaveProperty('equipped_banner');
      expect(body).not.toHaveProperty('equipped_frame_type');
      const other = await seedUser();
      const profile = (await app.inject({ method: 'GET', url: `/api/users/${user.id}`, headers: headers(other) })).json();
      expect(profile).toMatchObject({ equipped_frame: BANNER });
      expect(profile).not.toHaveProperty('equipped_banner');
      expect(profile).not.toHaveProperty('equipped_frame_type');
    });
  });
});
