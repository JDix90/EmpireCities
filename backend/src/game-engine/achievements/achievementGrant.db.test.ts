/**
 * The unlock writes against a real schema, the way the end of a game runs
 * them: one transaction, each player's unlocks under a savepoint of their own.
 * A player whose unlocks fail loses theirs, not everyone's, and an achievement
 * with no definition is skipped rather than failing the foreign key.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/game-engine/achievements/achievementGrant.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { AchievementId } from './achievementIds';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('grantAchievements (Postgres)', () => {
  let db: typeof import('../../db/postgres');
  let grantAchievements: typeof import('./achievementService').grantAchievements;
  const winner = uuidv4();
  const missing = uuidv4(); // no users row: their inserts fail the user foreign key

  beforeAll(async () => {
    db = await import('../../db/postgres');
    ({ grantAchievements } = await import('./achievementService'));
    const name = `unlocker_${winner.slice(0, 8)}`;
    await db.query(
      `INSERT INTO users (user_id, username, email, password_hash, xp, level) VALUES ($1, $2, $3, 'x', 0, 1)`,
      [winner, name, `${name}@test.local`],
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM users WHERE user_id = $1', [winner]).catch(() => {});
  });

  it('keeps one player\'s unlocks when another\'s fail, and skips an undefined achievement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unlocked: Record<string, string[]> = {};
    await db.withTransaction(async (client) => {
      for (const [userId, ids] of [
        [winner, ['first_blood', 'not_an_achievement', 'speed_demon']],
        [missing, ['first_blood']],
      ] as Array<[string, AchievementId[]]>) {
        await client.query('SAVEPOINT player_achievements');
        try {
          unlocked[userId] = await grantAchievements(client, userId, ids);
          await client.query('RELEASE SAVEPOINT player_achievements');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT player_achievements');
        }
      }
    });
    warn.mockRestore();

    expect(unlocked[winner]).toEqual(['first_blood', 'speed_demon']);
    expect(unlocked[missing]).toBeUndefined();

    const medals = await db.query<{ achievement_id: string }>(
      'SELECT achievement_id FROM user_achievements WHERE user_id = $1 ORDER BY achievement_id',
      [winner],
    );
    expect(medals.map((m) => m.achievement_id)).toEqual(['first_blood', 'speed_demon']);
    // XP for both (200 + 300), and the medal each one brings.
    const user = await db.queryOne<{ xp: number; level: number }>('SELECT xp, level FROM users WHERE user_id = $1', [winner]);
    expect(user).toEqual({ xp: 500, level: 2 });
    const cosmetics = await db.query<{ cosmetic_id: string }>(
      'SELECT cosmetic_id FROM user_cosmetics WHERE user_id = $1 ORDER BY cosmetic_id',
      [winner],
    );
    expect(cosmetics.map((c) => c.cosmetic_id)).toEqual(['frame_bronze', 'marker_skull']);
  });

  it('grants an achievement once', async () => {
    const again = await db.withTransaction((client) => grantAchievements(client, winner, ['first_blood']));
    expect(again).toEqual([]);
    const user = await db.queryOne<{ xp: number }>('SELECT xp FROM users WHERE user_id = $1', [winner]);
    expect(user?.xp).toBe(500);
  });
});
