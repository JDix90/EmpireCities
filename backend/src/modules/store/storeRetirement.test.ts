/**
 * Migration 044: store items that do nothing leave the catalog and their
 * buyers get back what they paid, once; items handed out without being paid
 * for or earned are taken back; nobody keeps wearing what they don't own; and
 * rewards nothing can grant stop being advertised.
 *
 * Migrations run once, before the tests, so this replays the migration's SQL
 * against fixtures inside a transaction that is always rolled back, then a
 * second time on top, to show a re-run pays nothing more.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/store/storeRetirement.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

/** The catalog rows 044 acts on, as seeds 001/002 and migration 014 created them. */
const CATALOG: Array<[id: string, type: string, name: string, price: number, earnedOnly: boolean]> = [
  ['roman_legionary', 'unit_skin', 'Roman Legionary', 300, false],
  ['wwii_sherman', 'unit_skin', 'Sherman Tank', 350, false],
  ['parchment_theme', 'map_theme', 'Parchment & Ink', 600, false],
  ['radar_theme', 'map_theme', 'Radar Screen', 600, false],
  ['default_unit', 'unit_skin', 'Standard Infantry', 0, false],
  ['default_dice', 'dice_skin', 'Classic Dice', 0, false],
  ['default_banner', 'profile_banner', 'Recruit Banner', 0, false],
  ['bone_dice', 'dice_skin', 'Ancient Bone Dice', 200, false],
  ['holo_dice', 'dice_skin', 'Holographic Dice', 250, false],
  ['general_banner', 'profile_banner', 'General Banner', 150, false],
  ['emperor_title', 'profile_banner', 'Emperor Title', 200, false],
  ['frame_bronze', 'profile_frame', 'Bronze Commander', 0, true],
  ['frame_silver', 'profile_frame', 'Silver Strategist', 0, true],
  ['frame_gold', 'profile_frame', 'Gold Conqueror', 0, true],
  ['frame_warlord', 'profile_frame', 'Warlord Frame', 0, true],
  ['marker_emperor', 'map_marker', 'Emperor Marker', 0, true],
  ['frame_prestige_1', 'profile_frame', 'Prestige I Frame', 0, true],
  ['frame_prestige_2', 'profile_frame', 'Prestige II Frame', 0, true],
  ['badge_rival', 'profile_banner', 'Rival Badge', 0, true],
  ['badge_nemesis', 'profile_banner', 'Nemesis Badge', 0, true],
];
const RETIRED = [
  'roman_legionary', 'wwii_sherman', 'parchment_theme', 'radar_theme',
  'default_unit', 'default_dice', 'default_banner',
];
const UNREACHABLE = [
  'frame_warlord', 'marker_emperor', 'frame_prestige_1', 'frame_prestige_2', 'badge_rival', 'badge_nemesis',
];

describe.runIf(enabled)('migration 044: store retirement (Postgres)', () => {
  let pgPool: Pool;
  let migration: string;

  beforeAll(async () => {
    ({ pgPool } = (await import('../../db/postgres')) as unknown as { pgPool: Pool });
    migration = readFileSync(join(__dirname, '../../../../database/migrations/044_store_retirement.sql'), 'utf8');
  });

  it('refunds what buyers paid once, takes back what was never paid for or earned, and unequips it', async () => {
    const client: PoolClient = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const sql = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows;

      for (const [id, type, name, price, earnedOnly] of CATALOG) {
        await sql(
          `INSERT INTO cosmetics (cosmetic_id, type, name, description, price_gems, is_premium, earned_only)
           VALUES ($1, $2, $3, 'fixture', $4, $5, $6)
           ON CONFLICT (cosmetic_id) DO NOTHING`,
          [id, type, name, price, price > 0, earnedOnly],
        );
      }
      for (const id of ['first_blood', 'conqueror']) {
        await sql(
          `INSERT INTO achievements (achievement_id, name, description, xp_reward)
           VALUES ($1, $1, 'fixture', 0) ON CONFLICT (achievement_id) DO NOTHING`,
          [id],
        );
      }
      const user = async () => {
        const id = uuidv4();
        const name = `retire_${id.slice(0, 8)}`;
        await sql(
          `INSERT INTO users (user_id, username, email, password_hash, gold) VALUES ($1, $2, $3, 'x', 100)`,
          [id, name, `${name}@test.local`],
        );
        return id;
      };
      const own = async (userId: string, ...ids: string[]) => {
        for (const id of ids) await sql('INSERT INTO user_cosmetics (user_id, cosmetic_id) VALUES ($1, $2)', [userId, id]);
      };
      const paid = (userId: string, name: string, price: number) =>
        sql('INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)', [userId, -price, `Purchased: ${name}`]);
      const wear = (userId: string, slot: 'frame' | 'marker' | 'dice', id: string) =>
        sql(`UPDATE users SET equipped_${slot} = $2 WHERE user_id = $1`, [userId, id]);

      // Bought two retired items; wears two free starters.
      const buyer = await user();
      await own(buyer, 'radar_theme', 'wwii_sherman', 'default_dice', 'default_banner');
      await paid(buyer, 'Radar Screen', 600);
      await paid(buyer, 'Sherman Tank', 350);
      await wear(buyer, 'dice', 'default_dice');
      await wear(buyer, 'frame', 'default_banner');
      // Got a retired item from a 402, with no purchase row.
      const unpaidRetired = await user();
      await own(unpaidRetired, 'radar_theme');
      // Paid for and wears Bone Dice; got Holographic Dice from a 402.
      const keeper = await user();
      await own(keeper, 'bone_dice', 'holo_dice');
      await paid(keeper, 'Ancient Bone Dice', 200);
      await wear(keeper, 'dice', 'bone_dice');
      // Wears Bone Dice from a 402.
      const freeloader = await user();
      await own(freeloader, 'bone_dice');
      await wear(freeloader, 'dice', 'bone_dice');
      // Claimed Gold Conqueror free; earned Bronze Commander; holds Silver Strategist.
      const medals = await user();
      await own(medals, 'frame_gold', 'frame_bronze', 'frame_silver');
      await sql(`INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, 'first_blood')`, [medals]);
      await wear(medals, 'frame', 'frame_gold');
      // Somehow owns an unreachable reward.
      const rival = await user();
      await own(rival, 'badge_rival');
      await wear(rival, 'frame', 'badge_rival');

      const state = async (userId: string) => {
        const [u] = await sql('SELECT gold, equipped_frame, equipped_dice FROM users WHERE user_id = $1', [userId]);
        const owned = await sql('SELECT cosmetic_id FROM user_cosmetics WHERE user_id = $1 ORDER BY cosmetic_id', [userId]);
        const refunds = await sql(
          `SELECT amount, reason FROM gold_transactions WHERE user_id = $1 AND amount > 0 ORDER BY reason`,
          [userId],
        );
        return { ...u, owned: owned.map((r) => r.cosmetic_id), refunds };
      };

      await client.query(migration);

      expect(await state(buyer)).toEqual({
        gold: 100 + 600 + 350,
        equipped_frame: null,
        equipped_dice: null,
        owned: [],
        refunds: [
          { amount: 600, reason: 'Refund: Radar Screen (retired from the store)' },
          { amount: 350, reason: 'Refund: Sherman Tank (retired from the store)' },
        ],
      });
      expect(await state(unpaidRetired)).toMatchObject({ gold: 100, owned: [], refunds: [] });
      expect(await state(keeper)).toMatchObject({ gold: 100, owned: ['bone_dice'], equipped_dice: 'bone_dice' });
      expect(await state(freeloader)).toMatchObject({ gold: 100, owned: [], equipped_dice: null });
      expect(await state(medals)).toMatchObject({ owned: ['frame_bronze', 'frame_silver'], equipped_frame: null });
      expect(await state(rival)).toMatchObject({ owned: ['badge_rival'], equipped_frame: 'badge_rival' });

      const catalog = (await sql(
        'SELECT cosmetic_id FROM cosmetics WHERE cosmetic_id = ANY($1) ORDER BY cosmetic_id',
        [[...RETIRED, ...UNREACHABLE]],
      )).map((r) => r.cosmetic_id);
      expect(catalog).toEqual(['badge_rival']);

      // A second run finds nothing left to refund or take.
      const before = await Promise.all([buyer, keeper, medals, rival].map(state));
      await client.query(migration);
      expect(await Promise.all([buyer, keeper, medals, rival].map(state))).toEqual(before);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
});
