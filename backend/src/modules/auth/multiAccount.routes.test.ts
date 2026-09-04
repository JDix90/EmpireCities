/**
 * One email address, several accounts (migration 040).
 *
 * The UNIQUE constraint on users.email meant a player who wanted to start over
 * under a new name had to find a second address. Dropping it makes two lookups
 * ambiguous — login and password reset both resolve accounts BY EMAIL — so the
 * point of these tests is that neither one picks an arbitrary row.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=/tmp POSTGRES_PORT=5499 POSTGRES_USER=$USER \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/auth/multiAccount.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('multiple accounts per email (Postgres)', () => {
  let app: FastifyInstance;
  let usersApp: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let MAX_ACCOUNTS_PER_EMAIL: number;
  const emails: string[] = [];

  /** Run-unique so a previous run's rows can never satisfy or block a case. */
  const stamp = () => uuidv4().slice(0, 8);
  const PASSWORD = 'Fortress!Wall72';

  async function register(username: string, email: string, password = PASSWORD) {
    return app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username, email, password },
    });
  }
  async function login(identifier: string, password = PASSWORD) {
    return app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: identifier, password },
    });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    const { registerErrorHandler } = await import('../../errorHandler');
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { config } = await import('../../config');
    const mod = await import('./auth.routes');
    MAX_ACCOUNTS_PER_EMAIL = mod.MAX_ACCOUNTS_PER_EMAIL;
    app = Fastify();
    registerErrorHandler(app);
    // The routes set the refresh cookie, so the app under test needs the same
    // plugin the real server registers.
    await app.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await app.register(mod.authRoutes, { prefix: '/api/auth' });
    await app.ready();

    const { usersRoutes } = await import('../users/users.routes');
    usersApp = Fastify();
    registerErrorHandler(usersApp);
    await usersApp.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await usersApp.register(usersRoutes, { prefix: '/api/users' });
    await usersApp.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (usersApp) await usersApp.close();
    if (emails.length) {
      await query(
        `DELETE FROM users WHERE LOWER(TRIM(BOTH FROM email)) = ANY($1)`,
        [emails.map((e) => e.toLowerCase())],
      ).catch(() => {});
    }
  });

  it('lets one address hold a second account under a new name', async () => {
    const email = `restart_${stamp()}@test.local`;
    emails.push(email);

    const first = await register(`first_${stamp()}`, email);
    expect(first.statusCode).toBe(201);
    const second = await register(`second_${stamp()}`, email);
    expect(second.statusCode, second.body).toBe(201);

    const rows = await query(
      `SELECT user_id FROM users WHERE LOWER(TRIM(BOTH FROM email)) = $1`,
      [email.toLowerCase()],
    );
    expect(rows).toHaveLength(2);
  });

  it('still refuses a duplicate username — that is the public identity', async () => {
    const email = `dupname_${stamp()}@test.local`;
    emails.push(email);
    const name = `taken_${stamp()}`;

    expect((await register(name, email)).statusCode).toBe(201);
    const clash = await register(name, `other_${stamp()}@test.local`);
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ error: expect.stringMatching(/username is taken/i) });
    emails.push(`other_${stamp()}@test.local`);
  });

  it('caps how many accounts one address may hold', async () => {
    const email = `capped_${stamp()}@test.local`;
    emails.push(email);

    for (let i = 0; i < MAX_ACCOUNTS_PER_EMAIL; i++) {
      expect((await register(`cap${i}_${stamp()}`, email)).statusCode).toBe(201);
    }
    const overflow = await register(`over_${stamp()}`, email);
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json()).toMatchObject({ error: expect.stringMatching(/already has/i) });
  });

  it('frees a slot when an account is deleted, so a capped address can start again', async () => {
    // The two features have to compose: hitting the cap must not be a dead end
    // for someone who deletes an old identity to make room. Account deletion is
    // a hard DELETE (users.routes.ts), so the row stops counting.
    const email = `freeslot_${stamp()}@test.local`;
    emails.push(email);

    const names: string[] = [];
    for (let i = 0; i < MAX_ACCOUNTS_PER_EMAIL; i++) {
      const name = `slot${i}_${stamp()}`;
      names.push(name);
      expect((await register(name, email)).statusCode).toBe(201);
    }
    expect((await register(`blocked_${stamp()}`, email)).statusCode).toBe(409);

    // Delete the oldest through the real route, password and all.
    const session = await login(email);
    expect(session.statusCode).toBe(200);
    const token = (session.json() as { accessToken: string }).accessToken;
    const deleted = await usersApp.inject({
      method: 'DELETE', url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: PASSWORD },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);

    // The slot is free, and the freed username is available again too.
    expect((await register(`after_${stamp()}`, email)).statusCode).toBe(201);
    expect((await register(names[0], `elsewhere_${stamp()}@test.local`)).statusCode).toBe(201);
    emails.push(`elsewhere_${stamp()}@test.local`);
  });

  it('signs in to the account whose password matches, not an arbitrary row', async () => {
    const email = `bypw_${stamp()}@test.local`;
    emails.push(email);
    const older = `older_${stamp()}`;
    const newer = `newer_${stamp()}`;
    const newerPassword = 'Ramparts!Deep31';

    expect((await register(older, email)).statusCode).toBe(201);
    expect((await register(newer, email, newerPassword)).statusCode).toBe(201);

    // Same email, two different passwords: each one resolves its own account.
    const asOlder = await login(email);
    expect(asOlder.statusCode).toBe(200);
    expect(asOlder.json()).toMatchObject({ user: { username: older } });

    const asNewer = await login(email, newerPassword);
    expect(asNewer.statusCode).toBe(200);
    expect(asNewer.json()).toMatchObject({ user: { username: newer } });
  });

  it('lets the username name an account explicitly when both share a password', async () => {
    const email = `samepw_${stamp()}@test.local`;
    emails.push(email);
    const older = `dup_older_${stamp()}`;
    const newer = `dup_newer_${stamp()}`;

    expect((await register(older, email)).statusCode).toBe(201);
    expect((await register(newer, email)).statusCode).toBe(201);

    // The email is ambiguous, so it resolves deterministically to the oldest…
    const byEmail = await login(email);
    expect(byEmail.statusCode).toBe(200);
    expect(byEmail.json()).toMatchObject({ user: { username: older } });

    // …and the username always reaches the account it names.
    const byName = await login(newer);
    expect(byName.statusCode).toBe(200);
    expect(byName.json()).toMatchObject({ user: { username: newer } });
  });

  it('rejects a wrong password rather than falling through to another account', async () => {
    const email = `wrongpw_${stamp()}@test.local`;
    emails.push(email);
    expect((await register(`solo_${stamp()}`, email)).statusCode).toBe(201);

    const bad = await login(email, 'Definitely!Wrong99');
    expect(bad.statusCode).toBe(401);
  });

  it('issues a reset token for every account on the address, not one of them', async () => {
    const email = `reset_${stamp()}@test.local`;
    emails.push(email);
    const a = `reset_a_${stamp()}`;
    const b = `reset_b_${stamp()}`;
    expect((await register(a, email)).statusCode).toBe(201);
    expect((await register(b, email)).statusCode).toBe(201);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email },
    });
    expect(res.statusCode).toBe(200);

    const tokens = await query(
      `SELECT t.user_id FROM password_reset_tokens t
       JOIN users u ON u.user_id = t.user_id
       WHERE LOWER(TRIM(BOTH FROM u.email)) = $1 AND t.used_at IS NULL`,
      [email.toLowerCase()],
    );
    // One live token per account — a single arbitrary reset is the bug.
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens.map((t) => t.user_id)).size).toBe(2);
  });
});
