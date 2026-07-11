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
export interface CompletionStats {
  finishes: number;
  wins: number;
  tutorial_finishes: number;
  avg_minutes: number | null;
  avg_turns: number | null;
}
export interface EventVolumeRow {
  event: string;
  n: number;
}
export interface AnalyticsReport {
  window_days: number;
  total_events: number;
  funnel: FunnelMetrics;
  retention: RetentionMetrics;
  completion: CompletionStats;
  volume: EventVolumeRow[];
}

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
