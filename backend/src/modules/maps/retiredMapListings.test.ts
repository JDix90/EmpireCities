/**
 * Retired curated maps (RETIRED_COMMUNITY_MAP_IDS) stay out of the Map Hub's
 * community listing and the Map of the Week. The 14 Nations and the Strait of
 * Hormuz were seeded as community maps; after their rebuilds took new ids, the
 * old rows still listed with their old copy, and their "Play This Map" met
 * "That theater map is not available in the lobby".
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/maps/retiredMapListings.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { RETIRED_COMMUNITY_MAP_IDS } from '../../game-engine/lobby/lobbyMapChange';

const enabled = process.env.PG_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('retired curated maps leave the community listings (Postgres)', { timeout: 20_000 }, () => {
  let app: FastifyInstance;
  let query: Query;
  let listFeaturedCandidates: typeof import('../../db/postgres/mapsRepository').listFeaturedCandidates;
  const listed = `test_listed_${uuidv4().slice(0, 8)}`;
  /** Rows this test inserted; a database that already has the seeded rows keeps them. */
  const inserted: string[] = [];

  async function insertApproved(mapId: string, name: string): Promise<void> {
    await query(
      `INSERT INTO maps (map_id, creator_id, name, description, era_theme, territories, connections, regions,
                         is_public, is_moderated, moderation_status, rating, rating_count)
       VALUES ($1, 'jmd', $2, 'test', 'custom', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true, 'approved', 5, 1)
       ON CONFLICT (map_id) DO NOTHING`,
      [mapId, name],
    );
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    ({ listFeaturedCandidates } = await import('../../db/postgres/mapsRepository'));
    for (const id of RETIRED_COMMUNITY_MAP_IDS) {
      const have = await query('SELECT 1 FROM maps WHERE map_id = $1', [id]);
      if (have.length === 0) {
        await insertApproved(id, `retired ${id}`);
        inserted.push(id);
      }
    }
    await insertApproved(listed, 'A listed community map');
    inserted.push(listed);
    const { registerErrorHandler } = await import('../../errorHandler');
    const { mapsRoutes } = await import('./maps.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(mapsRoutes, { prefix: '/api/maps' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (inserted.length) await query('DELETE FROM maps WHERE map_id = ANY($1)', [inserted]).catch(() => {});
  });

  it('leaves them out of the community listing, and lists the rest', async () => {
    const ids: string[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const res = await app.inject({ method: 'GET', url: `/api/maps/public?sort=new&page=${page}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { maps: { map_id: string }[]; pages: number };
      ids.push(...body.maps.map((m) => m.map_id));
      if (page >= body.pages) break;
    }
    expect(ids).toContain(listed);
    for (const id of RETIRED_COMMUNITY_MAP_IDS) expect(ids).not.toContain(id);
  });

  it('never makes one the Map of the Week', async () => {
    // The rows qualify on their own (public, approved, not a system map): the
    // exclusion is what keeps them out of the pool the week's pick comes from.
    const all = (await listFeaturedCandidates(500)).map((r) => r.map_id);
    for (const id of RETIRED_COMMUNITY_MAP_IDS) expect(all).toContain(id);
    const pool = (await listFeaturedCandidates(500, RETIRED_COMMUNITY_MAP_IDS)).map((r) => r.map_id);
    for (const id of RETIRED_COMMUNITY_MAP_IDS) expect(pool).not.toContain(id);
    expect(pool).toContain(listed);
  });
});
