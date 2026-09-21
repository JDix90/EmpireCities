/**
 * Public pages for the settled Daily archive: an index at /daily/archive and
 * one page per past day at /daily/YYYY-MM-DD.
 *
 * Both are deliberately OUTSIDE PrivateRoute. They read only the public
 * `/api/daily/archive*` endpoints, which never expose a live puzzle — the
 * server refuses any date that is not strictly in the past, so a visitor
 * cannot read tomorrow's answer out of this page.
 *
 * Crawlers do not reach this component at all: nginx routes crawler
 * user-agents to the server-rendered shell in
 * `backend/src/modules/daily/dailyArchivePreview.ts`, which renders the same
 * content from the same API. If you change what a day's page says, change it
 * in both places — the parity is what keeps this from being cloaking.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, Trophy } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import { useNoindex } from '../hooks/useNoindex';
import { api } from '../services/api';

interface ArchiveLeader {
  username: string;
  won: boolean;
  puzzle_score: number | null;
  turn_count: number | null;
  territory_count: number | null;
}

interface ArchiveEntry {
  challenge_date: string;
  kind: string;
  spec: {
    archetype: string;
    title: string;
    intro: string;
    goal: string;
    era_id: string;
    era_label: string;
    map_id: string;
    player_count: number;
    max_turns: number;
    par_turns: number | null;
    ai_difficulty: string | null;
  };
  results: {
    attempts: number;
    wins: number;
    win_rate: number | null;
    best_score: number | null;
    median_winning_turns: number | null;
    leaderboard: ArchiveLeader[];
  };
}

interface ArchiveSummary {
  challenge_date: string;
  title: string;
  archetype: string;
  era_label: string;
  attempts: number;
  wins: number;
}

const ARCHETYPE_LABELS: Record<string, string> = {
  domination: 'Domination',
  military_capture: 'Capture',
  hold_territory: 'Hold',
  control_region: 'Region control',
  capture_chain: 'Capture chain',
  economy_build: 'Economy',
  tech_research: 'Research',
};

function archetypeLabel(a: string): string {
  return ARCHETYPE_LABELS[a] ?? 'Puzzle';
}

/** UTC so the label always names the same day as `challenge_date` itself. */
function prettyDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Keep the document title/description in step with the client-rendered page.
 * The crawler never runs this (it gets the server shell), but a human who
 * shares from their address bar, or a browser that re-reads the title, should
 * not see the generic landing copy.
 */
function useDocumentMeta(title: string, description?: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    const tag = description ? document.querySelector('meta[name="description"]') : null;
    const previousDescription = tag?.getAttribute('content') ?? null;
    if (tag && description) tag.setAttribute('content', description);
    return () => {
      document.title = previous;
      if (tag && previousDescription !== null) tag.setAttribute('content', previousDescription);
    };
  }, [title, description]);
}

/* ─── Index: /daily/archive ───────────────────────────────────────────────── */

export function DailyArchiveIndexPage() {
  const [days, setDays] = useState<ArchiveSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useDocumentMeta(
    'Borderfall Daily Challenge Archive — Every Past Puzzle',
    'Every past Borderfall Daily Challenge: the puzzle, the objective, how many commanders '
    + 'solved it, and in how many turns. A new one is set each day, free in your browser.',
  );

  useEffect(() => {
    let cancelled = false;
    api.get<{ days: ArchiveSummary[] }>('/daily/archive')
      .then((res) => { if (!cancelled) setDays(res.data.days ?? []); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <SubpageShell
      titleAs="div"
      title="DAILY ARCHIVE"
      icon={CalendarDays}
      maxWidth="2xl"
      backHref="/"
      backLabel="Borderfall"
      headerLeft={<BrandWordmark to="/" className="text-xl" />}
      contentClassName="space-y-6 pb-12"
    >
      <article className="space-y-4">
        <h1 className="font-display text-3xl text-bf-gold">Daily Challenge Archive</h1>
        <p className="text-bf-muted italic">One puzzle a day, and how everyone did on it.</p>
        <p className="text-sm text-bf-muted leading-relaxed">
          Borderfall sets a new Daily Challenge every day — a hand-built position on a world map
          with a single objective, the same puzzle for every player, usually solvable in a few
          minutes. This is the record of the ones already settled: what the puzzle asked, how many
          commanders solved it, and how long it took them.
        </p>
        <Link to="/daily" className="inline-block text-bf-gold hover:underline">
          Play today&rsquo;s challenge →
        </Link>
      </article>

      <section className="space-y-2">
        <h2 className="font-display text-lg text-bf-gold">Past challenges</h2>
        {failed && <p className="text-sm text-bf-muted">The archive is briefly unavailable.</p>}
        {!failed && days === null && <p className="text-sm text-bf-muted">Loading…</p>}
        {days?.length === 0 && (
          <p className="text-sm text-bf-muted">The first archived challenge will appear here tomorrow.</p>
        )}
        <ul className="space-y-2">
          {days?.map((d) => (
            <li key={d.challenge_date}>
              <Link
                to={`/daily/${d.challenge_date}`}
                className="block rounded-lg border border-bf-border px-4 py-3 hover:bg-bf-surface transition-colors"
              >
                <span className="text-bf-text">{d.title}</span>
                <span className="block text-xs text-bf-muted mt-1">
                  {d.challenge_date} · {archetypeLabel(d.archetype)} · {d.era_label}
                  {d.attempts > 0 && ` · ${d.wins}/${d.attempts} solved`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </SubpageShell>
  );
}

/* ─── One day: /daily/:date ───────────────────────────────────────────────── */

export default function DailyArchivePage() {
  const { date = '' } = useParams<{ date: string }>();
  const [entry, setEntry] = useState<ArchiveEntry | null>(null);
  const [missing, setMissing] = useState(false);

  useDocumentMeta(
    entry
      ? `${entry.spec.title} — Borderfall Daily Challenge, ${entry.challenge_date}`
      : 'Borderfall Daily Challenge Archive',
    entry ? `${entry.spec.goal || entry.spec.intro} A free turn-based strategy puzzle you play in your browser.` : undefined,
  );

  // A date with nothing archived renders "No archived challenge for that
  // date" under an HTTP 200, which a crawler reads as a soft 404. Well-formed
  // dates are redirected to the archive before they reach here (see the
  // crawler block in docker/nginx.prod.conf); this covers the shapes that are
  // not, such as /daily/not-a-date. Called before the early return below.
  useNoindex(missing);

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setMissing(false);
    api.get<ArchiveEntry>(`/daily/archive/${encodeURIComponent(date)}`)
      .then((res) => { if (!cancelled) setEntry(res.data); })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [date]);

  if (missing) {
    return (
      <SubpageShell
        titleAs="div"
        title="DAILY ARCHIVE"
        icon={CalendarDays}
        maxWidth="2xl"
        backHref="/daily/archive"
        backLabel="Archive"
        headerLeft={<BrandWordmark to="/" className="text-xl" />}
        contentClassName="space-y-4 pb-12"
      >
        <h1 className="font-display text-2xl text-bf-gold">No archived challenge for that date</h1>
        <p className="text-sm text-bf-muted">
          Only settled days are published — today&rsquo;s puzzle stays unspoiled until it closes.
        </p>
        <Link to="/daily/archive" className="inline-block text-bf-gold hover:underline">
          Browse the archive →
        </Link>
      </SubpageShell>
    );
  }

  if (!entry) {
    return (
      // This transient state renders no heading of its own, so the banner
      // stays the page h1 rather than opting out like the states below.
      <SubpageShell
        title="DAILY ARCHIVE"
        icon={CalendarDays}
        maxWidth="2xl"
        backHref="/daily/archive"
        backLabel="Archive"
        headerLeft={<BrandWordmark to="/" className="text-xl" />}
      >
        <p className="text-sm text-bf-muted">Loading…</p>
      </SubpageShell>
    );
  }

  const { spec, results } = entry;
  const facts: Array<[string, string]> = [
    ['Date', prettyDate(entry.challenge_date)],
    ['Puzzle type', archetypeLabel(spec.archetype)],
    ['Era', spec.era_label],
    ['Opponents', `${Math.max(0, spec.player_count - 1)} AI${spec.ai_difficulty ? ` (${spec.ai_difficulty})` : ''}`],
    ['Turn limit', spec.max_turns > 0 ? `${spec.max_turns} turns` : 'None'],
  ];
  if (spec.par_turns != null) facts.push(['Par', `${spec.par_turns} turns`]);

  return (
    <SubpageShell
      titleAs="div"
      title="DAILY ARCHIVE"
      icon={CalendarDays}
      maxWidth="2xl"
      backHref="/daily/archive"
      backLabel="Archive"
      headerLeft={<BrandWordmark to="/" className="text-xl" />}
      contentClassName="space-y-6 pb-12"
    >
      <article className="space-y-4">
        <h1 className="font-display text-3xl text-bf-gold">{spec.title}</h1>
        <p className="text-bf-muted italic">
          Borderfall Daily Challenge — {prettyDate(entry.challenge_date)}
        </p>
        {spec.intro && <p className="text-sm text-bf-muted leading-relaxed">{spec.intro}</p>}
        {spec.goal && (
          <p className="text-sm text-bf-muted leading-relaxed">
            <span className="text-bf-text">Objective:</span> {spec.goal}
          </p>
        )}
        <p className="text-sm text-bf-muted leading-relaxed">
          {results.attempts === 0
            ? 'No registered commander logged a result on this one.'
            : `${results.wins} of ${results.attempts} registered commander${results.attempts === 1 ? '' : 's'} solved it`
              + `${results.win_rate != null ? ` (${results.win_rate}%)` : ''}`
              + `${results.median_winning_turns != null ? `, taking a median of ${results.median_winning_turns} turns` : ''}.`}
        </p>
      </article>

      <section className="space-y-2">
        <h2 className="font-display text-lg text-bf-gold">The setup</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-bf-muted">{k}</dt>
              <dd className="text-bf-text">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </section>

      {results.leaderboard.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg text-bf-gold flex items-center gap-2">
            <Trophy className="w-4 h-4" /> Results
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-bf-muted text-xs uppercase tracking-wide">
                  <th className="text-left py-2 pr-3">#</th>
                  <th className="text-left py-2 pr-3">Commander</th>
                  <th className="text-left py-2 pr-3">Outcome</th>
                  <th className="text-left py-2 pr-3">Score</th>
                  <th className="text-left py-2">Turns</th>
                </tr>
              </thead>
              <tbody>
                {results.leaderboard.map((l, i) => (
                  <tr key={`${l.username}-${i}`} className="border-t border-bf-border">
                    <td className="py-2 pr-3 text-bf-muted">{i + 1}</td>
                    <td className="py-2 pr-3 text-bf-text">{l.username}</td>
                    <td className="py-2 pr-3">{l.won ? 'Solved' : 'Failed'}</td>
                    <td className="py-2 pr-3">{l.puzzle_score ?? '—'}</td>
                    <td className="py-2">{l.turn_count ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg text-bf-gold">Play today&rsquo;s challenge</h2>
        <p className="text-sm text-bf-muted leading-relaxed">
          Borderfall sets a new puzzle every day: a hand-built position on a world map, the same one
          for everyone, solvable in a few minutes. It is free, runs in the browser, and you can play
          as a guest without making an account.
        </p>
        <div className="flex gap-4 flex-wrap text-sm">
          <Link to="/daily" className="text-bf-gold hover:underline">Today&rsquo;s challenge →</Link>
          <Link to="/daily/archive" className="text-bf-gold hover:underline">Past challenges</Link>
          <Link to="/how-to-play" className="text-bf-gold hover:underline">How to play</Link>
        </div>
      </section>
    </SubpageShell>
  );
}
