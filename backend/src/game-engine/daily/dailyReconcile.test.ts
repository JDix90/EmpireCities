/**
 * The authored calendar has to be able to change its mind.
 *
 * A daily row is written the first time its date is served, so a day authored
 * (or corrected) after that point used to be a silent no-op: the stored spec
 * won forever and nothing said so. These cover the two halves of the fix —
 * the comparison that detects the drift, and the read path that repairs it
 * without ever swapping a board out from under recorded scores.
 *
 * The Postgres half is gated on PG_TEST=1 (migrated schema):
 *   PG_TEST=1 POSTGRES_HOST=/tmp POSTGRES_PORT=5499 POSTGRES_USER=$USER \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/game-engine/daily/dailyReconcile.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { specsDiffer } from './dailyPuzzleService';
import { DAILY_CALENDAR } from '../../content/dailyCalendar';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

const AUTHORED_DATE = Object.keys(DAILY_CALENDAR).sort()[0];

describe('specsDiffer', () => {
  const authored = DAILY_CALENDAR[AUTHORED_DATE];

  it('is blind to key order, which a JSONB round-trip does not preserve', () => {
    const shuffled = Object.fromEntries(
      Object.entries(authored).reverse(),
    ) as unknown as DailyPuzzleSpec;
    expect(specsDiffer(authored, shuffled)).toBe(false);
  });

  it('is blind to key order inside a starting_board too', () => {
    const board = authored.starting_board;
    expect(board).toBeDefined();
    const reordered = {
      ...authored,
      starting_board: Object.fromEntries(Object.entries(board!).reverse()),
    } as DailyPuzzleSpec;
    expect(specsDiffer(authored, reordered)).toBe(false);
  });

  it('catches a changed title, a changed clock and a changed garrison', () => {
    expect(specsDiffer(authored, { ...authored, title: 'Something Else' })).toBe(true);
    expect(specsDiffer(authored, { ...authored, max_turns: authored.max_turns + 1 })).toBe(true);
    const [first] = Object.keys(authored.starting_board!);
    expect(
      specsDiffer(authored, {
        ...authored,
        starting_board: {
          ...authored.starting_board!,
          [first]: { ...authored.starting_board![first], unit_count: 99 },
        },
      }),
    ).toBe(true);
  });

  it('separates two different authored days', () => {
    const dates = Object.keys(DAILY_CALENDAR).sort();
    expect(specsDiffer(DAILY_CALENDAR[dates[0]], DAILY_CALENDAR[dates[1]])).toBe(true);
  });
});

describe.runIf(process.env.PG_TEST === '1')('authored reconciliation on read (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let ensureDailyChallengeForDate: (date: string) => Promise<{ spec: DailyPuzzleSpec }>;
  const userIds: string[] = [];

  /** A stored row that is deliberately NOT what the calendar says for this date. */
  const staleSpec: DailyPuzzleSpec = {
    archetype: 'economy_build',
    title: 'Daily Economy — Foundations',
    intro: 'Stale generated spec, written before the day was authored.',
    goal: 'Construct a Production (tier 1) building in any territory you control.',
    era_id: 'ancient',
    map_id: 'era_ancient',
    seed: 1,
    player_count: 2,
    max_turns: 18,
    dice_queue_seed: 1,
  };

  async function seedStaleRow(): Promise<void> {
    await query('DELETE FROM daily_challenges WHERE challenge_date = $1::date', [AUTHORED_DATE]);
    await query(
      `INSERT INTO daily_challenges (challenge_date, era_id, map_id, seed, player_count, kind, spec_json)
       VALUES ($1::date, $2, $3, $4, $5, 'puzzle', $6::jsonb)`,
      [AUTHORED_DATE, staleSpec.era_id, staleSpec.map_id, staleSpec.seed, staleSpec.player_count,
        JSON.stringify(staleSpec)],
    );
  }

  const storedTitle = async (): Promise<string> =>
    ((await query(`SELECT spec_json->>'title' AS title FROM daily_challenges WHERE challenge_date = $1::date`,
      [AUTHORED_DATE])) as Array<{ title: string }>)[0].title;

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ ensureDailyChallengeForDate } = await import('./dailyPuzzleService'));
  }, 30_000);

  afterAll(async () => {
    await query('DELETE FROM daily_challenges WHERE challenge_date = $1::date', [AUTHORED_DATE]).catch(() => {});
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('rewrites a stale stored spec with the authored one', async () => {
    await seedStaleRow();

    const row = await ensureDailyChallengeForDate(AUTHORED_DATE);
    expect(row.spec.title).toBe(DAILY_CALENDAR[AUTHORED_DATE].title);
    // Persisted, not just returned — the next reader must see it too.
    expect(await storedTitle()).toBe(DAILY_CALENDAR[AUTHORED_DATE].title);

    // And it is stable: a second read is a no-op, not a second UPDATE.
    const again = await ensureDailyChallengeForDate(AUTHORED_DATE);
    expect(again.spec.title).toBe(DAILY_CALENDAR[AUTHORED_DATE].title);
  });

  it('refuses to swap the board once the day is in play', async () => {
    await seedStaleRow();
    const userId = uuidv4();
    userIds.push(userId);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash)
       VALUES ($1, $2, $3, 'x')`,
      [userId, `daily_recon_${userId.slice(0, 8)}`, `daily_recon_${userId.slice(0, 8)}@test.local`],
    );
    await query(
      `INSERT INTO daily_challenge_entries (challenge_date, user_id, won, turn_count)
       VALUES ($1::date, $2, true, 6)`,
      [AUTHORED_DATE, userId],
    );

    const row = await ensureDailyChallengeForDate(AUTHORED_DATE);
    expect(row.spec.title).toBe(staleSpec.title);
    expect(await storedTitle()).toBe(staleSpec.title);
  });
});
