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
 * The actual SQL lives in src/services/analyticsQueries.ts (shared with the
 * admin endpoint GET /api/admin/metrics/funnel). This is just the CLI shell.
 *
 * Read-only. Requires the normal backend Postgres env (DATABASE_URL / PG*).
 */
import { connectPostgres, pgPool } from '../src/db/postgres';
import { getAnalyticsReport } from '../src/services/analyticsQueries';

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

  const r = await getAnalyticsReport(DAYS);

  console.log(`\n=== Borderfall funnel — last ${DAYS} days ===`);
  console.log(`(total events ever recorded: ${r.total_events})\n`);
  if (r.total_events === 0) {
    console.log('No analytics events yet. Set ANALYTICS_EVENTS_ENABLED=true and play through a game.\n');
    await pgPool.end();
    return;
  }

  const f = r.funnel;
  const steps: Array<[string, number]> = [
    ['Signed up', f.signups],
    ['Created a game', f.created_game],
    ['Finished a game ★', f.finished_game],
  ];
  console.log('ACTIVATION FUNNEL (new users in window)');
  for (const [label, n] of steps) {
    console.log(
      `  ${label.padEnd(20)} ${String(n).padStart(6)}  ${pct(n, f.signups).padStart(6)}  ${bar(n, f.signups)}`,
    );
  }
  console.log(
    `  ${'Guest→account'.padEnd(20)} ${String(f.upgraded).padStart(6)}  ${pct(f.upgraded, f.signups).padStart(6)}\n`,
  );

  const ret = r.retention;
  console.log('RETENTION (returned with any activity)');
  console.log(`  D1  ${ret.d1}/${ret.d1_cohort}  ${pct(ret.d1, ret.d1_cohort)}`);
  console.log(`  D7  ${ret.d7}/${ret.d7_cohort}  ${pct(ret.d7, ret.d7_cohort)}\n`);

  const g = r.completion;
  console.log('GAME COMPLETIONS (per human, in window)');
  console.log(`  finishes ${g.finishes} · wins ${g.wins} · tutorial ${g.tutorial_finishes}`);
  console.log(`  avg length ${g.avg_minutes ?? '—'} min · avg ${g.avg_turns ?? '—'} turns\n`);

  console.log('ACQUISITION BY SOURCE (first-touch, new users in window)');
  if (r.acquisition.length === 0) {
    console.log('  (no signups in window)');
  } else {
    console.log(`  ${'source'.padEnd(20)} ${'signups'.padStart(8)} ${'accounts'.padStart(9)} ${'activated'.padStart(10)}`);
    for (const a of r.acquisition) {
      console.log(
        `  ${a.source.slice(0, 20).padEnd(20)} ${String(a.signups).padStart(8)} ${String(a.accounts).padStart(9)} ${String(a.activated).padStart(10)}`,
      );
    }
    console.log('  (sources are utm_source → referrer host → "direct"; attribution rides on the signup event)');
  }
  console.log('');

  console.log('EVENT VOLUME');
  for (const row of r.volume) console.log(`  ${row.event.padEnd(20)} ${String(row.n).padStart(6)}`);
  console.log('');

  await pgPool.end();
}

main().catch((err) => {
  console.error('[funnelReport] failed:', err);
  process.exit(1);
});
