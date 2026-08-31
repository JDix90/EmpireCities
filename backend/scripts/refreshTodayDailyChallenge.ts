/**
 * One-off / dev utility: delete today's daily_challenges row and regenerate via
 * ensureDailyChallengeForToday() — the deliberate override for the one case the
 * service refuses to reconcile on its own (a day already in play).
 *
 * ON DELETE CASCADE removes daily_challenge_entries for that date, and any
 * unfinished game for it is deleted too: a daily game carries a copy of the
 * spec in settings_json, so a surviving one would resume the OLD puzzle and
 * then score against the new day.
 */
import 'dotenv/config';
import { connectPostgres, query, pgPool } from '../src/db/postgres/index';
import {
  dailyChallengeDate,
  ensureDailyChallengeForToday,
} from '../src/game-engine/daily/dailyPuzzleService';

async function main(): Promise<void> {
  await connectPostgres();
  const today = dailyChallengeDate();

  const games = await query<{ game_id: string }>(
    `DELETE FROM games
     WHERE (settings_json->>'daily_challenge_date')::date = $1::date
       AND status IN ('waiting', 'in_progress')
     RETURNING game_id`,
    [today],
  );
  console.log(`[refresh-daily] Deleted ${games.length} unfinished daily game(s) for UTC ${today}`);

  const deleted = await query<{ challenge_date: string }>(
    'DELETE FROM daily_challenges WHERE challenge_date = $1::date RETURNING challenge_date',
    [today],
  );
  console.log(`[refresh-daily] Deleted ${deleted.length} row(s) for UTC ${today}`);

  const row = await ensureDailyChallengeForToday();
  console.log(
    `[refresh-daily] Regenerated: kind=${row.kind} archetype=${row.spec.archetype} map=${row.map_id} title="${row.spec.title}"`,
  );
  await pgPool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[refresh-daily] Failed:', err);
  process.exit(1);
});
