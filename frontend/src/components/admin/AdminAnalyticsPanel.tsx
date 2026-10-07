/**
 * Admin → Analytics: first-party funnel + retention, read from
 * GET /api/admin/metrics/funnel (shape mirrors backend analyticsQueries.ts).
 * Pure presentational — the page owns fetching + the window selector.
 */
import React from 'react';

export interface FunnelMetrics {
  signups: number;
  created_game: number;
  started_game: number;
  map_rendered: number;
  first_attack: number;
  first_capture: number;
  finished_game: number;
  upgraded: number;
}
export interface RetentionMetrics {
  d1_cohort: number;
  d1: number;
  d7_cohort: number;
  d7: number;
}
export interface RetentionCohortRow extends RetentionMetrics {
  cohort: 'account' | 'guest';
}
export interface TutorialCohortRow {
  cohort: 'account' | 'guest';
  started: number;
  completed: number;
}
export interface CompletionStats {
  finishes: number;
  wins: number;
  tutorial_finishes: number;
  avg_minutes: number | null;
  avg_turns: number | null;
}
export interface FirstMatchStats {
  started: number;
  finished: number;
  won: number;
  next_day_cohort: number;
  next_day: number;
}
/** Solo games (one human, bots) by where they came from and the game's highest bot. */
export interface SoloLevelRow {
  mode: 'tutorial' | 'first_match' | 'campaign' | 'daily' | 'other';
  level: 'tutorial' | 'easy' | 'medium' | 'hard' | 'expert';
  started: number;
  finished: number;
  won: number;
  abandoned: number;
  running: number;
  /** Finished games the round cap decided. */
  capped: number;
  /** Finished games the human won by accepting the bots' surrender. */
  surrendered: number;
  median_rounds: number | null;
  /**
   * Territories the bots took from other players in finished games that count
   * them, and how many were the human's, the leading rival's and the weakest
   * rival's as the bot's turn began.
   */
  bot_captures: number;
  bot_captures_from_human: number;
  bot_captures_from_leader: number;
  bot_captures_from_weakest: number;
}
export interface EventVolumeRow {
  event: string;
  n: number;
}
export interface VisitorFunnelMetrics {
  landed: number;
  clicked_play: number;
  signed_up: number;
}
export interface AnalyticsReport {
  window_days: number;
  total_events: number;
  /** Optional for rollout: older backends won't send it. */
  visitors?: VisitorFunnelMetrics;
  funnel: FunnelMetrics;
  retention: RetentionMetrics;
  /** Optional for rollout: older backends won't send it. */
  retention_by_cohort?: RetentionCohortRow[];
  /** Optional for rollout: older backends won't send it. */
  tutorial?: TutorialCohortRow[];
  completion: CompletionStats;
  /** Optional for rollout: older backends won't send it. */
  first_match?: FirstMatchStats;
  /** Optional for rollout: older backends won't send it. */
  solo_by_level?: SoloLevelRow[];
  volume: EventVolumeRow[];
}

const SOLO_MODE_LABELS: Record<SoloLevelRow['mode'], string> = {
  tutorial: 'Tutorial',
  first_match: 'First match',
  campaign: 'Campaign',
  daily: 'Daily challenge',
  other: 'Quick Match & custom',
};

function pctText(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(0)}%` : '—';
}

function FunnelStep({
  label,
  n,
  total,
  highlight,
}: {
  label: string;
  n: number;
  total: number;
  highlight?: boolean;
}) {
  const widthPct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 sm:w-44 shrink-0 text-sm text-bf-text">{label}</div>
      <div className="relative h-7 flex-1 overflow-hidden rounded-md border border-bf-border bg-bf-dark/60">
        <div
          className={highlight ? 'h-full bg-bf-gold/70' : 'h-full bg-bf-gold/30'}
          style={{ width: `${widthPct}%` }}
        />
        <div className="absolute inset-0 flex items-center px-2 text-xs text-bf-text tabular-nums">
          {n.toLocaleString()} · {pctText(n, total)}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
      <div className="text-xs uppercase tracking-wide text-bf-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-bf-text">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-bf-muted">{sub}</div>}
    </div>
  );
}

export default function AdminAnalyticsPanel({ data }: { data: AnalyticsReport | null }) {
  if (!data) {
    return <div className="text-sm text-bf-muted">Loading…</div>;
  }
  if (data.total_events === 0) {
    return (
      <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-6 text-center">
        <p className="font-medium text-bf-text">No analytics events yet.</p>
        <p className="mt-1 text-sm text-bf-muted">
          Set <code className="text-bf-gold">ANALYTICS_EVENTS_ENABLED=true</code> in prod and play
          through a game — the funnel fills in from there.
        </p>
      </div>
    );
  }

  const { funnel: f, retention: r, completion: c, volume } = data;
  const maxVol = Math.max(1, ...volume.map((v) => v.n));

  return (
    <div className="space-y-6">
      {data.visitors && data.visitors.landed > 0 && (
        <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold text-bf-text">Visitor funnel</p>
            <p className="text-xs text-bf-muted">anonymous sessions · last {data.window_days}d</p>
          </div>
          <div className="mt-3 space-y-2">
            <FunnelStep label="Landed" n={data.visitors.landed} total={data.visitors.landed} />
            <FunnelStep label="Clicked Play" n={data.visitors.clicked_play} total={data.visitors.landed} />
            <FunnelStep label="Signed up ★" n={data.visitors.signed_up} total={data.visitors.landed} highlight />
          </div>
          <p className="mt-2 text-xs text-bf-muted">
            Pre-signup sessions stitched to signups via the anonymous session id; visitors with
            storage blocked aren't counted here (they still appear below once signed up).
          </p>
        </section>
      )}

      <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-bf-text">Activation funnel</p>
          <p className="text-xs text-bf-muted">new users · last {data.window_days}d</p>
        </div>
        <div className="mt-3 space-y-2">
          <FunnelStep label="Signed up" n={f.signups} total={f.signups} />
          <FunnelStep label="Created a game" n={f.created_game} total={f.signups} />
          <FunnelStep label="Reached the map" n={f.map_rendered} total={f.signups} />
          <FunnelStep label="Made first attack" n={f.first_attack} total={f.signups} />
          <FunnelStep label="Captured a territory" n={f.first_capture} total={f.signups} />
          <FunnelStep label="Finished a game ★" n={f.finished_game} total={f.signups} highlight />
        </div>
        <p className="mt-2 text-xs text-bf-muted">
          Guest → account: {f.upgraded} ({pctText(f.upgraded, f.signups)})
        </p>
        <p className="mt-1 text-xs text-bf-muted">
          Admin and test accounts are left out of every cohort here; mark test accounts on the Users tab.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="D1 retention" value={pctText(r.d1, r.d1_cohort)} sub={`${r.d1}/${r.d1_cohort} returned`} />
        <Stat label="D7 retention" value={pctText(r.d7, r.d7_cohort)} sub={`${r.d7}/${r.d7_cohort} returned`} />
        <Stat
          label="Avg game length"
          value={c.avg_minutes != null ? `${c.avg_minutes}m` : '—'}
          sub={c.avg_turns != null ? `${c.avg_turns} turns` : undefined}
        />
        <Stat label="Games finished" value={c.finishes.toLocaleString()} sub={`${c.tutorial_finishes} tutorial`} />
      </div>

      {/* The two tiles above pool guests and accounts, which behave nothing
          alike — pooled, the rate mostly reports the guest/account mix rather
          than whether anyone came back. */}
      {data.retention_by_cohort && data.retention_by_cohort.length > 0 && (
        <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
          <p className="text-sm font-semibold text-bf-text">Retention by account type</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-bf-muted">
                <th className="pb-1 text-left font-normal">Cohort</th>
                <th className="pb-1 text-right font-normal">D1</th>
                <th className="pb-1 text-right font-normal">D7</th>
              </tr>
            </thead>
            <tbody>
              {data.retention_by_cohort.map((row) => (
                <tr key={row.cohort} className="border-t border-bf-border/50">
                  <td className="py-1.5 capitalize text-bf-text">{row.cohort}</td>
                  <td className="py-1.5 text-right tabular-nums text-bf-text">
                    {pctText(row.d1, row.d1_cohort)}{' '}
                    <span className="text-bf-muted">({row.d1}/{row.d1_cohort})</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-bf-text">
                    {pctText(row.d7, row.d7_cohort)}{' '}
                    <span className="text-bf-muted">({row.d7}/{row.d7_cohort})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-bf-muted">
            Guests cannot sign back in, so one returning on another device counts as a new
            signup and never as a return. Guests who never joined a game are deleted after
            48h and leave both columns, so the guest row omits the fastest bouncers and
            reads high rather than low.
          </p>
        </section>
      )}

      {/* Did the first thing a new player is shown actually land? Split guest
          vs account because they are the two audiences the tutorial serves and
          they drop off at very different rates. */}
      {data.tutorial && data.tutorial.length > 0 && (
        <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
          <p className="text-sm font-semibold text-bf-text">
            Tutorial completion{' '}
            <span className="text-xs font-normal text-bf-muted">· last {data.window_days}d</span>
          </p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-bf-muted">
                <th className="pb-1 text-left font-normal">Cohort</th>
                <th className="pb-1 text-right font-normal">Started</th>
                <th className="pb-1 text-right font-normal">Completed</th>
              </tr>
            </thead>
            <tbody>
              {data.tutorial.map((row) => (
                <tr key={row.cohort} className="border-t border-bf-border/50">
                  <td className="py-1.5 capitalize text-bf-text">{row.cohort}</td>
                  <td className="py-1.5 text-right tabular-nums text-bf-text">
                    {row.started.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-bf-text">
                    {pctText(row.completed, row.started)}{' '}
                    <span className="text-bf-muted">({row.completed}/{row.started})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-bf-muted">
            Both ends are server-side events (<span className="font-mono">tutorial_started</span> /
            {' '}<span className="font-mono">tutorial_completed</span>), so neither can be inflated by a
            client. &quot;Account&quot; is the same test the retention split uses — registered directly or
            upgraded from guest at any point — so a guest who finishes and then signs up counts
            as an account here too.
          </p>
        </section>
      )}

      {/* The easy first match (Admin → Config, "Easy first match"): did
          newcomers finish it, win it, and come back the next day? Shown once
          any have been played. */}
      {data.first_match && data.first_match.started > 0 && (
        <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
          <p className="text-sm font-semibold text-bf-text">
            First matches{' '}
            <span className="text-xs font-normal text-bf-muted">· last {data.window_days}d</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Started" value={data.first_match.started.toLocaleString()} />
            <Stat
              label="Finished"
              value={pctText(data.first_match.finished, data.first_match.started)}
              sub={`${data.first_match.finished}/${data.first_match.started} started`}
            />
            <Stat
              label="Won"
              value={pctText(data.first_match.won, data.first_match.finished)}
              sub={`${data.first_match.won}/${data.first_match.finished} finished`}
            />
            <Stat
              label="Back next day"
              value={pctText(data.first_match.next_day, data.first_match.next_day_cohort)}
              sub={`${data.first_match.next_day}/${data.first_match.next_day_cohort} finishers`}
            />
          </div>
          <p className="mt-2 text-xs text-bf-muted">
            A first match is a player&apos;s first Quick Match while &quot;Easy first match&quot; is on: one
            Easy bot on Great Britain 925. &quot;Back next day&quot; uses the D1 rule (any event the day
            after finishing) and counts only finishes from before today.
          </p>
        </section>
      )}

      {/* How each bot level plays out for a lone player: finished, won, how
          often the round cap rather than a conquest ended it, and whose
          territory the bots took. */}
      {data.solo_by_level && data.solo_by_level.length > 0 && (
        <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
          <p className="text-sm font-semibold text-bf-text">
            Solo games by bot level{' '}
            <span className="text-xs font-normal text-bf-muted">· started in the last {data.window_days}d</span>
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-bf-muted">
                  <th className="pb-1 text-left font-normal">Mode</th>
                  <th className="pb-1 text-left font-normal">Bots</th>
                  <th className="pb-1 text-right font-normal">Started</th>
                  <th className="pb-1 text-right font-normal">Finished</th>
                  <th className="pb-1 text-right font-normal">Won</th>
                  <th className="pb-1 text-right font-normal">Round cap</th>
                  <th className="pb-1 text-right font-normal">Surrendered</th>
                  <th className="pb-1 text-right font-normal">Left</th>
                  <th className="pb-1 text-right font-normal">Rounds</th>
                  <th className="pb-1 text-right font-normal">From you</th>
                  <th className="pb-1 text-right font-normal">From leader</th>
                  <th className="pb-1 text-right font-normal">From weakest</th>
                </tr>
              </thead>
              <tbody>
                {data.solo_by_level.map((row) => (
                  <tr key={`${row.mode}:${row.level}`} className="border-t border-bf-border/50">
                    <td className="py-1.5 text-bf-text">{SOLO_MODE_LABELS[row.mode] ?? row.mode}</td>
                    <td className="py-1.5 capitalize text-bf-text">{row.level}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">
                      {row.started.toLocaleString()}
                      {row.running > 0 && <span className="text-bf-muted"> ({row.running} on)</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.finished, row.started)}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.won, row.finished)}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.capped, row.finished)}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.surrendered, row.finished)}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.abandoned, row.started)}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{row.median_rounds ?? '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.bot_captures_from_human, row.bot_captures)}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.bot_captures_from_leader, row.bot_captures)}</td>
                    <td className="py-1.5 text-right tabular-nums text-bf-text">{pctText(row.bot_captures_from_weakest, row.bot_captures)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-bf-muted">
            One human against bots, by the game&apos;s highest bot. Finished and Left are shares of
            the games started; Won and Round cap are shares of those finished, and Round cap is a
            game the turn limit decided. Rounds is the median length of a finished game.
          </p>
          <p className="mt-1 text-xs text-bf-muted">
            From you, From leader and From weakest are shares of the territories the bots took from
            players in finished games, counted since this column was added: the human&apos;s, and
            those of the rival holding the most and the fewest territories as each bot&apos;s turn
            began. Ties count for every tied rival, so a capture can count in both, and with one
            rival left it always does.
          </p>
        </section>
      )}

      <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
        <p className="text-sm font-semibold text-bf-text">
          Event volume{' '}
          <span className="text-xs font-normal text-bf-muted">
            · last {data.window_days}d · {data.total_events.toLocaleString()} all-time
          </span>
        </p>
        <div className="mt-3 space-y-1.5">
          {volume.map((v) => (
            <div key={v.event} className="flex items-center gap-3">
              <div className="w-40 shrink-0 font-mono text-xs text-bf-muted">{v.event}</div>
              <div className="h-4 flex-1 overflow-hidden rounded bg-bf-dark/60">
                <div className="h-full bg-bf-gold/40" style={{ width: `${Math.round((v.n / maxVol) * 100)}%` }} />
              </div>
              <div className="w-12 text-right text-xs tabular-nums text-bf-text">{v.n.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
