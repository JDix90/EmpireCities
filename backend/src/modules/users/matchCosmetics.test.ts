/**
 * What players wear into a match: the loadout snapshot a game takes when it
 * starts, with store_v2_enabled on, and nothing at all with it off.
 *
 * The Postgres part is gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/users/matchCosmetics.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { loadMatchCosmetics, playerCosmetics } from './matchCosmetics';

describe('playerCosmetics', () => {
  it('keeps the slots that are filled', () => {
    expect(playerCosmetics({ frame: 'frame_gold', banner: null, marker: 'marker_crown', dice: null }))
      .toEqual({ frame: 'frame_gold', marker: 'marker_crown' });
  });

  it('is nothing for a player wearing nothing', () => {
    expect(playerCosmetics({ frame: null, banner: null, marker: null, dice: null })).toBeUndefined();
  });
});

describe('loadMatchCosmetics with store_v2_enabled off', () => {
  afterEach(() => {
    delete process.env.STORE_V2_ENABLED;
  });

  it('reads nothing', async () => {
    process.env.STORE_V2_ENABLED = 'false';
    // No database here: with the flag off it must not query at all.
    expect(await loadMatchCosmetics([uuidv4()])).toEqual(new Map());
  });
});

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(process.env.PG_TEST === '1')('loadMatchCosmetics (Postgres)', () => {
  let query: Query;
  const userIds: string[] = [];
  const tag = uuidv4().slice(0, 8);
  const FRAME = `test_${tag}_frame`;
  const BANNER = `test_${tag}_banner`;
  const MARKER = `test_${tag}_marker`;
  const DICE = `test_${tag}_dice`;

  async function seedUser(worn: Record<string, string | null>): Promise<string> {
    const id = uuidv4();
    const name = `worn_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, equipped_frame, equipped_banner, equipped_marker, equipped_dice)
       VALUES ($1, $2, $3, 'x', $4, $5, $6, $7)`,
      [id, name, `${name}@test.local`, worn.frame ?? null, worn.banner ?? null, worn.marker ?? null, worn.dice ?? null],
    );
    return id;
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    // Earned-only like every unpriced item: the store's tests run alongside.
    await query(
      `INSERT INTO cosmetics (cosmetic_id, type, name, price_gems, is_premium, earned_only) VALUES
         ($1, 'profile_frame', $1, 0, false, true),
         ($2, 'profile_banner', $2, 0, false, true),
         ($3, 'map_marker', $3, 0, false, true),
         ($4, 'dice_skin', $4, 0, false, true)`,
      [FRAME, BANNER, MARKER, DICE],
    );
  });
  afterEach(() => {
    delete process.env.STORE_V2_ENABLED;
  });
  afterAll(async () => {
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    await query('DELETE FROM cosmetics WHERE cosmetic_id = ANY($1)', [[FRAME, BANNER, MARKER, DICE]]).catch(() => {});
  });

  it('takes what each player wears, reading a banner in the frame slot as the banner', async () => {
    process.env.STORE_V2_ENABLED = 'true';
    const dressed = await seedUser({ frame: FRAME, banner: BANNER, marker: MARKER, dice: DICE });
    const oldStyle = await seedUser({ frame: BANNER });
    const plain = await seedUser({});

    const worn = await loadMatchCosmetics([dressed, oldStyle, plain]);

    expect(worn.get(dressed)).toEqual({ frame: FRAME, banner: BANNER, marker: MARKER, dice: DICE });
    expect(worn.get(oldStyle)).toEqual({ banner: BANNER });
    expect(worn.has(plain)).toBe(false);
  });

  it('takes nothing with the flag off', async () => {
    process.env.STORE_V2_ENABLED = 'false';
    const dressed = await seedUser({ frame: FRAME });
    expect(await loadMatchCosmetics([dressed])).toEqual(new Map());
  });
});
