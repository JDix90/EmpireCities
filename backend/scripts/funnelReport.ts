/**
 * Funnel + retention report over the first-party `analytics_events` table.
 *
 *   cd backend && pnpm exec tsx scripts/funnelReport.ts [days]
 *
 * `days` is the trailing window for acquisition/volume (default 30). Cohorts are
 * defined by each user's first `guest_created`/`user_registered` event, so the
 * funnel only covers signups that happened AFTER analytics was switched on
 * (ANALYTICS_EVENTS_ENABLED=true) — there's no retroactive history, by design.
 *
 * Read-only. Requires the normal backend Postgres env (DATABASE_URL / PG*).
 */
import { connectPostgres, query, pgPool } from '../src/db/postgres';

const DAYS = Math.max(1, Number(process.argv[2]) || 30);

function pct(n: number, d: number): string {
  if (!d) return '  —  ';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function bar(n: number, d: number, width = 24): string {
  if (!d) return '';
  const filled = Math.round((n / d) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function main(): Promise<void> {
  await connectPostgres();

  // Sanity: is the table populated at all?
  const [{ total }] = await query<{ total: string }>(
    `SELECT COUNT(*)::int AS total FROM analytics_events`,
  );
  console.log(`\n=== Borderfall funnel — last ${DAYS} days ===`);
  console.log(`(total events ever recorded: ${total})\n`);
  if (Number(total) === 0) {
    console.log('No analytics events yet. Set ANALYTICS_EVENTS_ENABLED=true and play through a game.\n');
    await pgPool.end();
    return;
  }

  // ── Acquisition → activation funnel (per-user, windowed cohort) ───────────
  const [funnel] = await query<{
    signups: number;
    created_game: number;
    started_game: number;
    finished_game: number;
    upgraded: number;
  }>(
    `WITH signups AS (
       SELECT user_id, MIN(created_at) AS signed_up_at
       FROM analytics_events
       WHERE event IN ('guest_created', 'user_registered') AND user_id IS NOT NULL
         AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY user_id
     )
     SELECT
       COUNT(*)::int AS signups,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_created'))::int AS created_game,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_started'))::int AS started_game,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'game_finished'))::int AS finished_game,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.event = 'guest_upgraded'))::int AS upgraded
     FROM signups s`,
    [DAYS],
  );

  const steps: Array<[string, number]> = [
    ['Signed up', funnel.signups],
    ['Created a game', funnel.created_game],
    ['Finished a game ★', funnel.finished_game],
  ];
  console.log('ACTIVATION FUNNEL (new users in window)');
  for (const [label, n] of steps) {
    console.log(
      `  ${label.padEnd(20)} ${String(n).padStart(6)}  ${pct(n, funnel.signups).padStart(6)}  ${bar(n, funnel.signups)}`,
    );
  }
  console.log(
    `  ${'Guest→account'.padEnd(20)} ${String(funnel.upgraded).padStart(6)}  ${pct(funnel.upgraded, funnel.signups).padStart(6)}\n`,
  );

  // ── Retention: D1 / D7 (any activity on the day after / a week after) ─────
  const [ret] = await query<{ d1_cohort: number; d1: number; d7_cohort: number; d7: number }>(
    `WITH signups AS (
       SELECT user_id, MIN(created_at)::date AS d0
       FROM analytics_events
       WHERE event IN ('guest_created', 'user_registered') AND user_id IS NOT NULL
       GROUP BY user_id
     )
     SELECT
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 1)::int AS d1_cohort,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 1 AND EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.created_at::date = s.d0 + 1))::int AS d1,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 7)::int AS d7_cohort,
       COUNT(*) FILTER (WHERE d0 <= CURRENT_DATE - 7 AND EXISTS (
         SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.created_at::date = s.d0 + 7))::int AS d7
     FROM signups s`,
  );
  console.log('RETENTION (returned with any activity)');
  console.log(`  D1  ${ret.d1}/${ret.d1_cohort}  ${pct(ret.d1, ret.d1_cohort)}`);
  console.log(`  D7  ${ret.d7}/${ret.d7_cohort}  ${pct(ret.d7, ret.d7_cohort)}\n`);

  // ── Game-completion stats ─────────────────────────────────────────────────
  const [g] = await query<{
    finishes: number;
    wins: number;
    tutorial_finishes: number;
    avg_minutes: string | null;
    avg_turns: string | null;
  }>(
    `SELECT
       COUNT(*)::int AS finishes,
       COUNT(*) FILTER (WHERE (properties->>'won')::boolean)::int AS wins,
       COUNT(*) FILTER (WHERE (properties->>'is_tutorial')::boolean)::int AS tutorial_finishes,
       ROUND(AVG((properties->>'duration_ms')::numeric) / 60000, 1) AS avg_minutes,
       ROUND(AVG((properties->>'turn_count')::numeric), 1) AS avg_turns
     FROM analytics_events
     WHERE event = 'game_finished' AND created_at >= NOW() - ($1 || ' days')::interval`,
    [DAYS],
  );
  console.log('GAME COMPLETIONS (per human, in window)');
  console.log(`  finishes ${g.finishes} · wins ${g.wins} · tutorial ${g.tutorial_finishes}`);
  console.log(`  avg length ${g.avg_minutes ?? '—'} min · avg ${g.avg_turns ?? '—'} turns\n`);

  // ── Raw event volume (sanity) ─────────────────────────────────────────────
  const vol = await query<{ event: string; n: number }>(
    `SELECT event, COUNT(*)::int AS n
     FROM analytics_events
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY event ORDER BY n DESC`,
    [DAYS],
  );
  console.log('EVENT VOLUME');
  for (const row of vol) console.log(`  ${row.event.padEnd(20)} ${String(row.n).padStart(6)}`);
  console.log('');

  await pgPool.end();
}

main().catch((err) => {
  console.error('[funnelReport] failed:', err);
  process.exit(1);
});
