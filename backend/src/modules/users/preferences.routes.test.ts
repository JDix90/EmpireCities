/**
 * Turn emails have their own switch, and unsubscribing stops them.
 *
 * `email_notifications` is the marketing opt-in from the signup checkbox
 * ("streak reminders and comeback bonuses"). It used to gate the "it's your
 * turn" email as well, so anyone who declined marketing at signup silently
 * declined turn alerts they were never offered. Migration 041 gives turn
 * emails their own transactional, default-on column. The contract pinned
 * here: the preferences routes expose and persist it independently, and the
 * one-click unsubscribe — whose link is identical on a marketing email and a
 * turn email — clears BOTH, so a recipient who clicks it on a turn email is
 * not still sent the next one.
 *
 * Also the "Send test" route: it counts the account's registered devices
 * (FCM is unconfigured here, so nothing is accepted) and refuses guests, who
 * cannot register a device in the first place.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/users/preferences.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

interface Prefs {
  push_enabled: boolean;
  email_notifications: boolean;
  turn_emails_enabled: boolean;
}

describe.runIf(enabled)('notification preferences — turn emails are their own switch (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  let signUnsubscribeToken: (userId: string) => string;
  const userIds: string[] = [];

  async function seedUser(base: string): Promise<{ id: string; name: string }> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash)
       VALUES ($1, $2, $3, 'x')`,
      [id, name, `${name}@test.local`],
    );
    return { id, name };
  }

  const auth = (u: { id: string; name: string }) => ({
    authorization: `Bearer ${signAccessToken({ sub: u.id, username: u.name, guest: false })}`,
  });
  const getPrefs = async (u: { id: string; name: string }) =>
    (await app.inject({ method: 'GET', url: '/api/users/me/preferences', headers: auth(u) })).json() as Prefs;

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    ({ signUnsubscribeToken } = await import('../../utils/unsubscribeToken'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('a fresh account gets turn emails ON and marketing OFF — service is not promotion', async () => {
    const u = await seedUser('prefs_fresh');
    const prefs = await getPrefs(u);
    expect(prefs.turn_emails_enabled).toBe(true);
    expect(prefs.email_notifications).toBe(false);
  });

  it('turning turn emails off leaves the marketing opt-in exactly as it was', async () => {
    const u = await seedUser('prefs_split');
    // Opted into marketing at signup.
    await query(
      `INSERT INTO user_preferences (user_id, email_notifications) VALUES ($1, true)
       ON CONFLICT (user_id) DO UPDATE SET email_notifications = true`,
      [u.id],
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/preferences',
      headers: auth(u),
      payload: { turn_emails_enabled: false },
    });
    expect(res.statusCode).toBe(200);

    const prefs = await getPrefs(u);
    expect(prefs.turn_emails_enabled).toBe(false);
    expect(prefs.email_notifications).toBe(true);
  });

  it('the one-click unsubscribe clears both switches — it is the same link on a turn email', async () => {
    const u = await seedUser('prefs_unsub');
    await query(
      `INSERT INTO user_preferences (user_id, email_notifications, turn_emails_enabled) VALUES ($1, true, true)
       ON CONFLICT (user_id) DO UPDATE SET email_notifications = true, turn_emails_enabled = true`,
      [u.id],
    );

    // Deliberately unauthenticated: the recipient may be logged out.
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/unsubscribe',
      payload: { token: signUnsubscribeToken(u.id) },
    });
    expect(res.statusCode).toBe(200);

    const prefs = await getPrefs(u);
    expect(prefs.email_notifications).toBe(false);
    expect(prefs.turn_emails_enabled).toBe(false);
  });

  it('unsubscribe creates the row when none exists yet, so a first-ever click still sticks', async () => {
    const u = await seedUser('prefs_unsub_norow');
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/unsubscribe',
      payload: { token: signUnsubscribeToken(u.id) },
    });
    expect(res.statusCode).toBe(200);
    const prefs = await getPrefs(u);
    expect(prefs.turn_emails_enabled).toBe(false);
    expect(prefs.email_notifications).toBe(false);
  });

  it('the test-notification route reports the registered device count and sends nothing to an account with none', async () => {
    const u = await seedUser('prefs_pushtest');
    const call = () =>
      app.inject({ method: 'POST', url: '/api/users/me/push-tokens/test', headers: auth(u), payload: { delay_ms: 0 } });

    let res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ registered: 0, delay_ms: 0, accepted: 0 });

    await query('INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)', [u.id, `tok-${u.id}`, 'web']);
    res = await call();
    expect(res.statusCode).toBe(200);
    // FCM is not configured in the test environment, so the device is
    // registered but nothing accepts the message.
    expect(res.json()).toEqual({ registered: 1, delay_ms: 0, accepted: 0 });
  });

  it('the test-notification route rejects a delay above the cap and refuses guests', async () => {
    const u = await seedUser('prefs_pushtest_bad');
    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/users/me/push-tokens/test',
      headers: auth(u),
      payload: { delay_ms: 60_000 },
    });
    expect(tooLong.statusCode).toBe(400);

    const guest = await app.inject({
      method: 'POST',
      url: '/api/users/me/push-tokens/test',
      headers: { authorization: `Bearer ${signAccessToken({ sub: u.id, username: u.name, guest: true })}` },
      payload: {},
    });
    expect(guest.statusCode).toBe(403);
  });
});

