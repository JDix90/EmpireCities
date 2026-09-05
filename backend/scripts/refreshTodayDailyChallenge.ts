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
import { connectPostgres, pgPool } from '../src/db/postgres/index';
import { regenerateDailyChallengeForToday } from '../src/game-engine/daily/dailyPuzzleService';

async function main(): Promise<void> {
  await connectPostgres();

  // The same path the admin "Regenerate daily" action takes.
  const { row, deleted_games, deleted_rows } = await regenerateDailyChallengeForToday();
  console.log(`[refresh-daily] Deleted ${deleted_games} unfinished daily game(s) for UTC ${row.challenge_date}`);
  console.log(`[refresh-daily] Deleted ${deleted_rows} row(s) for UTC ${row.challenge_date}`);
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
