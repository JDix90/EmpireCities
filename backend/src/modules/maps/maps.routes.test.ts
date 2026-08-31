/**
 * Integration coverage for the map moderation state machine (migration 039):
 *
 *   draft ──publish──▶ pending ──approve──▶ approved ──edit──▶ pending
 *     ▲                                        │
 *     └────────────── (409 on publish) ◀───────┘
 *   rejected ──publish──▶ pending   (a rejected map is explicitly resubmittable)
 *
 * plus the publish-quality gate: the same validators `validate:maps` holds the
 * built-in maps to block a broken map from entering review, while saves attach
 * the identical list as warnings.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=/tmp POSTGRES_PORT=5499 POSTGRES_USER=$USER \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/maps/maps.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';
process.env.MAP_EDITOR_ENABLED = 'true';

/** A minimal valid map body: 7 territories in a ring, 7 connections, 1 region. */
function validMapBody(name: string) {
  const territories = Array.from({ length: 7 }, (_, i) => ({
    territory_id: `t${i}`,
    name: `T${i}`,
    polygon: [[0, 0], [1, 0], [1, 1]],
    center_point: [0.5, 0.5],
    region_id: 'r1',
  }));
  const connections = territories.map((_, i) => ({
    from: `t${i}`,
    to: `t${(i + 1) % 7}`,
    type: 'land' as const,
  }));
  return {
    name,
    description: 'test map',
    era_theme: 'ancient',
    territories,
    connections,
    regions: [{ region_id: 'r1', name: 'Ring', bonus: 3 }],
  };
}

describe.runIf(enabled)('map moderation state machine (Postgres)', () => {
  let app: FastifyInstance;
  let adminApp: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean; admin?: boolean }) => string;
  const userIds: string[] = [];
  const mapIds: string[] = [];

  async function seedUser(base: string, admin = false): Promise<{ id: string; name: string }> {
    const id = uuidv4();
    // Run-unique names: a prior run's cleanup can be blocked by FK rows
    // (map_ratings), and the username column is unique.
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_admin)
       VALUES ($1, $2, $3, 'x', $4)`,
      [id, name, `${name}@test.local`, admin],
    );
    return { id, name };
  }

  const auth = (userId: string, username: string, admin = false) => ({
    authorization: `Bearer ${signAccessToken({ sub: userId, username, guest: false, admin })}`,
  });

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { mapsRoutes } = await import('./maps.routes');
    const { adminRoutes } = await import('../admin/admin.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(mapsRoutes, { prefix: '/api/maps' });
    await app.ready();
    adminApp = Fastify();
    registerErrorHandler(adminApp);
    await adminApp.register(adminRoutes, { prefix: '/api/admin' });
    await adminApp.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (adminApp) await adminApp.close();
    if (mapIds.length) {
      await query('DELETE FROM map_ratings WHERE map_id = ANY($1)', [mapIds]).catch(() => {});
      await query('DELETE FROM maps WHERE map_id = ANY($1)', [mapIds]).catch(() => {});
    }
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('walks the full lifecycle: draft → pending → approved → edit demotes → re-approve; rejected resubmits', async () => {
    const { id: author, name: authorName } = await seedUser('author1');
    const { id: admin, name: adminName } = await seedUser('admin1', true);

    // Create: born a draft, with a warnings array attached.
    const created = await app.inject({
      method: 'POST', url: '/api/maps', headers: auth(author, authorName), payload: validMapBody('Lifecycle Map'),
    });
    expect(created.statusCode).toBe(201);
    const { map_id, warnings } = created.json() as { map_id: string; warnings: string[] };
    mapIds.push(map_id);
    expect(warnings).toEqual([]);
    const status = async () =>
      ((await query('SELECT moderation_status, is_public, moderation_reason FROM maps WHERE map_id = $1', [map_id])) as
        Array<{ moderation_status: string; is_public: boolean; moderation_reason: string | null }>)[0];
    expect((await status()).moderation_status).toBe('draft');

    // Publish: draft → pending.
    const published = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/publish`, headers: auth(author, authorName),
    });
    expect(published.statusCode).toBe(200);
    expect((await status()).moderation_status).toBe('pending');

    // Publishing again while pending is a benign no-op.
    const republished = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/publish`, headers: auth(author, authorName),
    });
    expect(republished.statusCode).toBe(200);
    expect((republished.json() as { message: string }).message).toMatch(/already under review/i);

    // Admin queue lists it, with the validator summary clean.
    const queue = await adminApp.inject({
      method: 'GET', url: '/api/admin/maps?status=pending', headers: auth(admin, adminName, true),
    });
    expect(queue.statusCode).toBe(200);
    const listed = (queue.json() as { maps: Array<{ map_id: string; validation_errors: string[] }> }).maps
      .find((m) => m.map_id === map_id);
    expect(listed).toBeDefined();
    expect(listed!.validation_errors).toEqual([]);

    // Approve: listed and public.
    const approved = await adminApp.inject({
      method: 'POST', url: `/api/admin/maps/${map_id}/actions/approve`, headers: auth(admin, adminName, true),
    });
    expect(approved.statusCode).toBe(200);
    expect(await status()).toMatchObject({ moderation_status: 'approved', is_public: true });

    // Publishing an approved map is a conflict.
    const overPublish = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/publish`, headers: auth(author, authorName),
    });
    expect(overPublish.statusCode).toBe(409);

    // Editing the approved map demotes it to pending and unlists it —
    // "approved" may never cover content the moderator has not seen.
    const edited = await app.inject({
      method: 'PUT', url: `/api/maps/${map_id}`, headers: auth(author, authorName),
      payload: { ...validMapBody('Lifecycle Map v2'), era_theme: 'medieval' },
    });
    expect(edited.statusCode).toBe(200);
    expect((edited.json() as { message: string }).message).toMatch(/unlisted/i);
    expect(await status()).toMatchObject({ moderation_status: 'pending', is_public: false });

    // era_theme survives the PUT (it used to be silently dropped).
    const theme = (await query('SELECT era_theme FROM maps WHERE map_id = $1', [map_id])) as Array<{ era_theme: string }>;
    expect(theme[0].era_theme).toBe('medieval');

    // Reject with a reason the owner sees in /maps/me…
    const rejected = await adminApp.inject({
      method: 'POST', url: `/api/admin/maps/${map_id}/actions/reject`, headers: auth(admin, adminName, true),
      payload: { reason: 'Territory names need work' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(await status()).toMatchObject({ moderation_status: 'rejected', moderation_reason: 'Territory names need work' });

    const mine = await app.inject({ method: 'GET', url: '/api/maps/me', headers: auth(author, authorName) });
    const mineRow = (mine.json() as Array<{ map_id: string; moderation_status: string; moderation_reason: string | null }>)
      .find((m) => m.map_id === map_id);
    expect(mineRow).toMatchObject({ moderation_status: 'rejected', moderation_reason: 'Territory names need work' });

    // …and a rejected map is explicitly resubmittable (the old route 403'd here).
    const resubmit = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/publish`, headers: auth(author, authorName),
    });
    expect(resubmit.statusCode).toBe(200);
    expect((await status()).moderation_status).toBe('pending');
  });

  it('publish blocks on validation errors; save only warns', async () => {
    const { id: author, name: authorName } = await seedUser('author2');

    // An orphan territory: t6 loses both its ring edges, leaving 5 connections
    // — above the schema floor, so the SAVE succeeds and only review blocks.
    const body = validMapBody('Broken Map');
    body.connections = body.connections.filter((c) => c.from !== 't6' && c.to !== 't6');

    const created = await app.inject({
      method: 'POST', url: '/api/maps', headers: auth(author, authorName), payload: body,
    });
    expect(created.statusCode).toBe(201); // saving never blocks…
    const { map_id, warnings } = created.json() as { map_id: string; warnings: string[] };
    mapIds.push(map_id);
    expect(warnings.length).toBeGreaterThan(0); // …but it tells the author

    const published = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/publish`, headers: auth(author, authorName),
    });
    expect(published.statusCode).toBe(400);
    const payload = published.json() as { errors: string[] };
    expect(payload.errors.length).toBeGreaterThan(0);

    const status = (await query('SELECT moderation_status FROM maps WHERE map_id = $1', [map_id])) as
      Array<{ moderation_status: string }>;
    expect(status[0].moderation_status).toBe('draft'); // never entered review
  });

  it('flags an empty region on publish', async () => {
    const { id: author, name: authorName } = await seedUser('author3');
    const body = validMapBody('Ghost Region Map');
    body.regions.push({ region_id: 'r_ghost', name: 'Ghost', bonus: 5 });

    const created = await app.inject({
      method: 'POST', url: '/api/maps', headers: auth(author, authorName), payload: body,
    });
    const { map_id } = created.json() as { map_id: string };
    mapIds.push(map_id);

    const published = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/publish`, headers: auth(author, authorName),
    });
    expect(published.statusCode).toBe(400);
    expect((published.json() as { errors: string[] }).errors.join(' ')).toMatch(/Ghost/);
  });

  it('rating returns the recomputed aggregate, not the caller’s star', async () => {
    const { id: author, name: authorName } = await seedUser('author4');
    const { id: raterA, name: raterAName } = await seedUser('rater_a');
    const { id: raterB, name: raterBName } = await seedUser('rater_b');

    const created = await app.inject({
      method: 'POST', url: '/api/maps', headers: auth(author, authorName), payload: validMapBody('Rated Map'),
    });
    const { map_id } = created.json() as { map_id: string };
    mapIds.push(map_id);
    // Make it visible to raters.
    await query(`UPDATE maps SET moderation_status = 'approved', is_public = true WHERE map_id = $1`, [map_id]);

    const first = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/rate`, headers: auth(raterA, raterAName), payload: { rating: 5 },
    });
    expect(first.json()).toMatchObject({ rating: 5, rating_count: 1 });

    const second = await app.inject({
      method: 'POST', url: `/api/maps/${map_id}/rate`, headers: auth(raterB, raterBName), payload: { rating: 2 },
    });
    // The aggregate (3.5), which the client must display — not the 2.
    expect(second.json()).toMatchObject({ rating: 3.5, rating_count: 2 });
  });
});
