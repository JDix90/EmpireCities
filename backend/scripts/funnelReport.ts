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
import { connectPostgres, pgPool, query } from '../src/db/postgres';
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

  // The pooled rate above mixes two populations that behave nothing alike, so
  // on its own it mostly reports the guest/account mix. This is the split.
  console.log('RETENTION BY ACCOUNT TYPE');
  console.log(`  ${'cohort'.padEnd(10)} ${'D1'.padStart(11)} ${'D7'.padStart(11)}`);
  for (const c of r.retention_by_cohort) {
    const d1 = `${c.d1}/${c.d1_cohort} ${pct(c.d1, c.d1_cohort)}`;
    const d7 = `${c.d7}/${c.d7_cohort} ${pct(c.d7, c.d7_cohort)}`;
    console.log(`  ${c.cohort.padEnd(10)} ${d1.padStart(11)} ${d7.padStart(11)}`);
  }
  console.log(
    '  NOTE: guests cannot sign back in, so a guest returning on another device'
    + '\n  is counted as a NEW signup, never a return — cross-device returns are'
    + '\n  invisible for guests and visible for accounts. Guests who never joined a'
    + '\n  game are deleted after 48h and leave BOTH columns, so the guest row omits'
    + '\n  the fastest bouncers and reads higher than the true rate, not lower.\n',
  );

  // Whether the first thing a new player is shown actually lands. Both ends are
  // server-side events, so neither can be inflated by a client.
  console.log('TUTORIAL COMPLETION (by account type, started in window)');
  console.log(`  ${'cohort'.padEnd(10)} ${'started'.padStart(9)} ${'completed'.padStart(14)}`);
  for (const t of r.tutorial) {
    const done = `${t.completed}/${t.started} ${pct(t.completed, t.started)}`;
    console.log(`  ${t.cohort.padEnd(10)} ${String(t.started).padStart(9)} ${done.padStart(14)}`);
  }
  console.log(
    "  NOTE: 'account' is the same test the retention split uses — registered"
    + '\n  directly or upgraded from guest at any point — so a guest who finishes the'
    + '\n  tutorial and then signs up is counted on the account row.\n',
  );

  const g = r.completion;
  console.log('GAME COMPLETIONS (per human, in window)');
  console.log(`  finishes ${g.finishes} · wins ${g.wins} · tutorial ${g.tutorial_finishes}`);
  console.log(`  avg length ${g.avg_minutes ?? '—'} min · avg ${g.avg_turns ?? '—'} turns\n`);

  console.log('ACQUISITION BY CHANNEL (first-touch, new users in window)');
  if (r.acquisition_channels.length === 0) {
    console.log('  (no attributed signups in window)');
  } else {
    const total = r.acquisition_channels.reduce((n, c) => n + c.signups, 0);
    console.log(
      `  ${'channel'.padEnd(22)} ${'signups'.padStart(8)} ${'share'.padStart(7)}`
      + ` ${'accounts'.padStart(9)} ${'activated'.padStart(10)}`,
    );
    for (const c of r.acquisition_channels) {
      console.log(
        `  ${c.label.padEnd(22)} ${String(c.signups).padStart(8)} ${pct(c.signups, total).padStart(7)}`
        + ` ${String(c.accounts).padStart(9)} ${String(c.activated).padStart(10)}`,
      );
      console.log(`  ${''.padEnd(22)} ${c.sources.slice(0, 6).join(', ')}`);
    }
    // Without this caveat the table reads as a measurement of the AI channel.
    // It isn't: it's a floor, and the gap is sitting in the row below it.
    console.log(
      '\n  NOTE: assistants that send no referrer (desktop/mobile apps, several web\n'
      + '  assistants) are indistinguishable from a typed URL and land in Direct, so\n'
      + '  "AI assistants" is a FLOOR. Google\'s AI Overviews refer as google.com and\n'
      + '  count as Search. Read AI assistants and Direct together, and trust the\n'
      + '  referral survey (referral_survey_answered) over both.',
    );
  }
  console.log('');

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

  // Self-reported attribution — the only signal that sees referrer-less
  // assistant traffic at all. Low N by nature; read it as anecdote with a
  // denominator, not as a channel split.
  const survey = await query<{ answer: string; n: number }>(
    `SELECT COALESCE(NULLIF(properties->>'answer', ''), 'unknown') AS answer, COUNT(*)::int AS n
     FROM analytics_events
     WHERE event = 'referral_survey_answered'
       AND created_at >= NOW() - make_interval(days => $1::int)
     GROUP BY answer
     ORDER BY n DESC`,
    [DAYS],
  );
  console.log('REFERRAL SURVEY ("how did you hear about us?", self-reported)');
  if (survey.length === 0) {
    console.log('  (no answers yet — the prompt ships behind referral_survey_enabled, default OFF)');
  } else {
    const total = survey.reduce((n, row) => n + Number(row.n), 0);
    for (const row of survey) {
      console.log(`  ${row.answer.padEnd(22)} ${String(row.n).padStart(6)}  ${pct(Number(row.n), total).padStart(6)}`);
    }
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
