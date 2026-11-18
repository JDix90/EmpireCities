/**
 * Ops utility: mark past tutorials the player ended themselves, so the admin
 * dashboard's "Completed" counts them as it counts every one ended from now on.
 *
 * `DELETE /games/:gameId/abandon` now stamps a tutorial with `tutorial_exited`
 * (game-engine/tutorial/tutorialGames.ts). Tutorials abandoned before that
 * carry no stamp, and the game row alone cannot tell a player who pressed
 * "Exit Tutorial" from one who closed the tab (the stale-game sweep abandons
 * that one days later). The `tutorial_exited` analytics event can: the client
 * posts it as the player leaves, just before the abandon call. A past tutorial
 * is stamped when its player posted one between the game's creation and a few
 * minutes after it ended.
 *
 * Tutorials left from before that event existed, or with analytics off, stay
 * as they are: unknown is not counted.
 *
 * Usage:
 *   pnpm -C backend exec tsx scripts/backfillTutorialExits.ts          # preview
 *   pnpm -C backend exec tsx scripts/backfillTutorialExits.ts --apply  # write
 */
import 'dotenv/config';
import { connectPostgres, query, pgPool } from '../src/db/postgres/index';
import { notTutorialSql, TUTORIAL_EXITED_KEY } from '../src/game-engine/tutorial/tutorialGames';

const APPLY = process.argv.includes('--apply');

const CANDIDATES_SQL = `
  SELECT g.game_id
  FROM games g
  WHERE g.status = 'abandoned'
    AND NOT (${notTutorialSql('g')})
    AND g.settings_json ->> '${TUTORIAL_EXITED_KEY}' IS NULL
    AND g.ended_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM game_players gp
      JOIN analytics_events e ON e.user_id = gp.user_id
      WHERE gp.game_id = g.game_id
        AND NOT gp.is_ai
        AND e.event = 'tutorial_exited'
        AND e.created_at BETWEEN g.created_at AND g.ended_at + INTERVAL '5 minutes'
    )`;

async function main(): Promise<void> {
  await connectPostgres();

  const [totals] = await query<{ abandoned: string; stamped: string }>(
    `SELECT COUNT(*)::text AS abandoned,
            COUNT(*) FILTER (WHERE g.settings_json ->> '${TUTORIAL_EXITED_KEY}' = 'true')::text AS stamped
     FROM games g
     WHERE g.status = 'abandoned' AND NOT (${notTutorialSql('g')})`,
  );
  const candidates = await query<{ game_id: string }>(CANDIDATES_SQL);

  console.log(`[tutorial-exits] Abandoned tutorials: ${totals?.abandoned ?? 0}, already stamped: ${totals?.stamped ?? 0}.`);
  console.log(`[tutorial-exits] Left by the player (a tutorial_exited event in the game's lifetime), unstamped: ${candidates.length}.`);

  if (!APPLY) {
    console.log('[tutorial-exits] Preview only. Run with --apply to stamp them.');
    await pgPool.end();
    return;
  }
  if (candidates.length === 0) {
    console.log('[tutorial-exits] Nothing to stamp.');
    await pgPool.end();
    return;
  }

  const stamped = await query<{ game_id: string }>(
    `UPDATE games
     SET settings_json = settings_json || jsonb_build_object($1::text, true)
     WHERE game_id IN (${CANDIDATES_SQL})
     RETURNING game_id`,
    [TUTORIAL_EXITED_KEY],
  );
  console.log(`[tutorial-exits] Stamped ${stamped.length} tutorial(s).`);
  await pgPool.end();
}

main().catch(async (err) => {
  console.error('[tutorial-exits] Failed:', err);
  await pgPool.end().catch(() => {});
  process.exit(1);
});
