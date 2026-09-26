/**
 * A gold reward is paid once, however many triggers race for it.
 *
 * Two faucets read "not rewarded yet" and then paid, with nothing tying the
 * payment to the claim, so two calls that both read before either wrote both
 * paid:
 *
 *  - **Onboarding quests.** `checkOnboardingQuests` is fired and forgotten from
 *    game end, build, research, ranked join, friend accept and async start, so
 *    two quick builds are two concurrent calls. Its `INSERT … ON CONFLICT DO
 *    NOTHING` claim never checked whether it inserted anything, and the gold,
 *    the ledger row and the XP were separate pooled queries after it.
 *  - **The referrer's reward.** `checkReferralCompletion` runs after every game
 *    the referee finishes. Two finishing together both read the referral as
 *    pending, and the completing UPDATE matched on id alone: the second waited
 *    for the first's row lock, then completed the referral again and paid again.
 *
 * Each case fires its trigger twice at once and counts the credit and the
 * ledger rows. `raceAtWrite` holds both calls at their write until both have
 * read, so the race happens every run instead of when the scheduler allows.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/game-engine/progression/goldRewardRaces.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ONBOARDING_QUESTS } from '@borderfall/shared';

const enabled = process.env.PG_TEST === '1';

/** `REFERRER_GOLD` in referralService.ts. */
const REFERRER_GOLD = 50;

function questDef(questId: string) {
  const quest = ONBOARDING_QUESTS.find((q) => q.quest_id === questId);
  if (!quest) throw new Error(`unknown quest ${questId}`);
  return quest;
}

describe.runIf(enabled)('gold rewards pay once when triggers race (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let pgPool: Pool;
  let checkOnboardingQuests: (
    userId: string,
    trigger: 'game_complete' | 'build',
  ) => Promise<{ quest_id: string } | null>;
  let checkReferralCompletion: (userId: string) => Promise<void>;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  async function seedUser(base: string): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash)
       VALUES ($1, $2, $3, 'x')`,
      [id, `${base}_${id.slice(0, 8)}`, `${base}_${id.slice(0, 8)}@test.local`],
    );
    return id;
  }

  /** A finished, non-tutorial game with the user seated at `finalRank`. */
  async function seedFinishedGame(userId: string, finalRank: number): Promise<void> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, is_ranked, ended_at)
       VALUES ($1, 'era_ancient', 'ancient', 'completed', '{"max_players": 2}'::jsonb, 'solo', false, NOW())`,
      [gameId],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, final_rank)
       VALUES ($1, $2, 0, '#e74c3c', false, $3)`,
      [gameId, userId, finalRank],
    );
  }

  /**
   * Run `calls` together while `table` refuses writes, and let them through
   * only once every call is waiting at its write.
   *
   * By then each call has done the read its write depends on, which is the
   * interleaving that paid twice. Left to the scheduler it often doesn't
   * happen: the second call reads after the first has committed, and the test
   * passes against the bug. SHARE mode blocks INSERT/UPDATE/DELETE but not
   * SELECT, so the reads go through and the writes queue behind the lock.
   */
  async function raceAtWrite<T>(
    table: 'user_quests' | 'referrals',
    calls: Array<() => Promise<T>>,
  ): Promise<T[]> {
    const gate = await pgPool.connect();
    let running: Promise<T[]> | undefined;
    let waiting = 0;
    try {
      await gate.query('BEGIN');
      await gate.query(`LOCK TABLE ${table} IN SHARE MODE`);
      const { rows } = await gate.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const gatePid = rows[0]!.pid;
      running = Promise.all(calls.map((call) => call()));
      running.catch(() => {}); // awaited below; don't report it unhandled meanwhile
      const deadline = Date.now() + 5_000;
      while (waiting < calls.length && Date.now() < deadline) {
        const [row] = await query(
          'SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
          [gatePid],
        );
        waiting = row!.n as number;
        if (waiting < calls.length) await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      await gate.query('COMMIT').catch(() => {});
      gate.release();
    }
    // Both calls were held at the write, so both had read first. (At least:
    // another suite's write to the same table can queue behind the lock too.)
    expect(waiting).toBeGreaterThanOrEqual(calls.length);
    return running!;
  }

  async function ledgerRows(userId: string, reason: string): Promise<number> {
    const rows = await query(
      'SELECT COUNT(*)::int AS n FROM gold_transactions WHERE user_id = $1 AND reason = $2',
      [userId, reason],
    );
    return rows[0]!.n as number;
  }

  async function balance(userId: string): Promise<{ gold: number; xp: number }> {
    const rows = await query('SELECT gold, xp FROM users WHERE user_id = $1', [userId]);
    return rows[0] as { gold: number; xp: number };
  }

  beforeAll(async () => {
    ({ query, pgPool } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
      pgPool: Pool;
    });
    ({ checkOnboardingQuests } = await import('./progressionService'));
    ({ checkReferralCompletion } = await import('./referralService'));
  }, 30_000);

  afterAll(async () => {
    if (gameIds.length) {
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    }
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('pays an onboarding quest once when two builds trigger it together', async () => {
    const user = await seedUser('quest_build');
    // first_building is the current quest once first_win is done.
    await query(
      `INSERT INTO user_quests (user_id, quest_id, completed_at) VALUES ($1, 'first_win', NOW())`,
      [user],
    );
    const quest = questDef('first_building');

    const results = await raceAtWrite('user_quests', [
      () => checkOnboardingQuests(user, 'build'),
      () => checkOnboardingQuests(user, 'build'),
    ]);

    // One call completes the quest; the other finds it already claimed.
    expect(results.filter((r) => r?.quest_id === 'first_building')).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(await ledgerRows(user, `Quest: ${quest.title}`)).toBe(1);
    expect((await balance(user)).gold).toBe(quest.reward_gold);
  });

  it('pays first_win gold and XP once when two game ends trigger it together', async () => {
    const user = await seedUser('quest_win');
    await seedFinishedGame(user, 1);
    const quest = questDef('first_win');

    const results = await raceAtWrite('user_quests', [
      () => checkOnboardingQuests(user, 'game_complete'),
      () => checkOnboardingQuests(user, 'game_complete'),
    ]);

    expect(results.filter((r) => r?.quest_id === 'first_win')).toHaveLength(1);
    expect(await ledgerRows(user, `Quest: ${quest.title}`)).toBe(1);
    expect(await balance(user)).toEqual({ gold: quest.reward_gold, xp: quest.reward_xp });
  });

  it("pays the referrer once when two of the referee's games finish together", async () => {
    const referrer = await seedUser('referrer');
    const referee = await seedUser('referee');
    await query('INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2)', [referrer, referee]);
    // REFERRAL_COMPLETION_GAMES finished games: the next check completes it.
    for (let i = 0; i < 3; i++) await seedFinishedGame(referee, 2);

    await raceAtWrite('referrals', [
      () => checkReferralCompletion(referee),
      () => checkReferralCompletion(referee),
    ]);

    expect(await ledgerRows(referrer, 'Referral reward')).toBe(1);
    expect((await balance(referrer)).gold).toBe(REFERRER_GOLD);
    const [referral] = await query(
      'SELECT status, reward_claimed FROM referrals WHERE referee_id = $1',
      [referee],
    );
    expect(referral).toEqual({ status: 'completed', reward_claimed: true });
  });
});
