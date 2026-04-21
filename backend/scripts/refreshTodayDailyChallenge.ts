/**
 * One-off / dev utility: delete today's daily_challenges row and regenerate via ensureDailyChallengeForToday().
 * Note: ON DELETE CASCADE removes daily_challenge_entries for that date.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectPostgres, query, pgPool } from '../src/db/postgres/index';
import { connectMongo } from '../src/db/mongo/index';
import { ensureDailyChallengeForToday } from '../src/game-engine/daily/dailyPuzzleService';

async function main(): Promise<void> {
  await connectPostgres();
  await connectMongo();
  const today = new Date().toISOString().slice(0, 10);

  const deleted = await query<{ challenge_date: string }>(
    'DELETE FROM daily_challenges WHERE challenge_date = $1::date RETURNING challenge_date',
    [today],
  );
  console.log(`[refresh-daily] Deleted ${deleted.length} row(s) for UTC ${today}`);

  const row = await ensureDailyChallengeForToday();
  console.log(`[refresh-daily] Regenerated: kind=${row.kind} archetype=${row.spec.archetype} map=${row.map_id}`);
  await mongoose.connection.close();
  await pgPool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[refresh-daily] Failed:', err);
  process.exit(1);
});
