/**
 * Migration 053: the Warlord Frame and Emperor Marker come back as earned-only
 * medals, and a player who already holds Warlord or Perfect Campaign gets the
 * reward. Migrations run once, before the tests, so this replays the SQL
 * against fixtures inside a transaction that is always rolled back, then a
 * second time on top, to show a re-run grants nothing twice.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/game-engine/achievements/earnedRewardsReturn.db.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('migration 053: earned rewards return (Postgres)', () => {
  let pgPool: Pool;
  let migration: string;

  beforeAll(async () => {
    ({ pgPool } = (await import('../../db/postgres')) as unknown as { pgPool: Pool });
    migration = readFileSync(join(__dirname, '../../../../database/migrations/053_earned_rewards_return.sql'), 'utf8');
  });

  it('gives each holder of Warlord or Perfect Campaign its reward, once, and sells neither', async () => {
    const [warlord, emperor, neither] = [uuidv4(), uuidv4(), uuidv4()];
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const id of [warlord, emperor, neither]) {
        const name = `reward_${id.slice(0, 8)}`;
        await client.query(
          `INSERT INTO users (user_id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
          [id, name, `${name}@test.local`],
        );
      }
      await client.query(
        `INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, 'ranked_warlord'), ($2, 'perfect_campaign')`,
        [warlord, emperor],
      );
      // A catalog as 044 left it: neither row, unless somebody owned one.
      await client.query(
        `DELETE FROM user_cosmetics WHERE cosmetic_id IN ('frame_warlord', 'marker_emperor') AND user_id = ANY($1)`,
        [[warlord, emperor, neither]],
      );

      await client.query(migration);
      await client.query(migration);

      const owned = await client.query<{ user_id: string; cosmetic_id: string }>(
        `SELECT user_id, cosmetic_id FROM user_cosmetics
         WHERE user_id = ANY($1) AND cosmetic_id IN ('frame_warlord', 'marker_emperor')
         ORDER BY cosmetic_id`,
        [[warlord, emperor, neither]],
      );
      expect(owned.rows).toEqual([
        { user_id: warlord, cosmetic_id: 'frame_warlord' },
        { user_id: emperor, cosmetic_id: 'marker_emperor' },
      ]);

      const catalog = await client.query(
        `SELECT cosmetic_id, type, earned_only, required_achievement, rarity, price_gems FROM cosmetics
         WHERE cosmetic_id IN ('frame_warlord', 'marker_emperor') ORDER BY cosmetic_id`,
      );
      expect(catalog.rows).toEqual([
        { cosmetic_id: 'frame_warlord', type: 'profile_frame', earned_only: true, required_achievement: 'ranked_warlord', rarity: 'legendary', price_gems: 0 },
        { cosmetic_id: 'marker_emperor', type: 'map_marker', earned_only: true, required_achievement: 'perfect_campaign', rarity: 'legendary', price_gems: 0 },
      ]);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
});
