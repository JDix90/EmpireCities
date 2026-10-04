/**
 * Admin → Galactic Age: finished games and their analytics, from
 * GET /api/admin/metrics/galaxy (shapes mirror backend modules/admin/galaxyReport.ts).
 *
 * Win rates read per seat against the seat's fair share of its game, 1 / sides,
 * the way the balance sim reads them (backend/scripts/GALAXY-BALANCE.md), each
 * with its 95% interval: a handful of playtests reads nothing like 1,260 sim
 * games, and the interval says so. The panel owns its filters and fetching; the
 * page's Refresh bumps `refreshKey`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, Trophy } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';

export type GalaxyGameMode = 'colonies' | 'home_worlds' | '2v2' | 'partial_schism' | 'schism' | 'scattered';
export type GalaxySeatRole = 'home' | 'rival' | 'alone' | 'ally' | 'whole' | 'scattered';
export type GalaxyRelations = 'concord' | 'civil_war' | 'allied';

export interface GalaxyReportSeat {
  seat: number;
  user_id: string | null;
  username: string | null;
  is_ai: boolean;
  ai_difficulty: string | null;
  faction_id: string | null;
  world_id: string | null;
  house: string | null;
  role: GalaxySeatRole;
  side: string | null;
  reinforce_bonus: number | null;
  won: boolean;
  eliminated: boolean;
  resigned: boolean;
  territories: number;
}

export interface GalaxyReportGame {
  game_id: string;
  finished_at: string;
  started_at: string | null;
  ended_at: string | null;
  seats: number;
  mode: GalaxyGameMode;
  relations: GalaxyRelations | null;
  board: string | null;
  victory: string | null;
  turns: number;
  first_seat: number | null;
  humans: number;
  seat_results: GalaxyReportSeat[];
}

export interface GalaxyRate {
  key: string;
  seats: number;
  wins: number;
  expected: number;
  rate: number;
  expected_rate: number;
  low: number;
  high: number;
}

export interface GalaxyAnalytics {
  games: number;
  decisive: number;
  avg_turns: number | null;
  median_minutes: number | null;
  modes: Array<{ mode: GalaxyGameMode; seats: number; relations: GalaxyRelations | null; games: number; avg_turns: number }>;
  endings: Array<{ victory: string; games: number }>;
  factions: GalaxyRate[];
  roles: GalaxyRate[];
  houses: Array<GalaxyRate & { house: string; role: GalaxySeatRole }>;
  players: GalaxyRate[];
  first_seat: GalaxyRate | null;
  by_day: Array<{ day: string; games: number }>;
}

export interface GalaxyReport {
  filters: { days: number | null; seats: number | null; mode: GalaxyGameMode | null; relations: GalaxyRelations | null };
  total_games: number;
  truncated: boolean;
  /** Finished Galactic Age games in the window with no record. */
  unrecorded_games: number;
  /** Of those, the ones whose game-over board is still saved. Optional for rollout: older backends won't send it. */
  recoverable_games?: number;
  analytics: GalaxyAnalytics;
  games: GalaxyReportGame[];
}

/** What POST /admin/actions/galaxy-backfill did (backend modules/admin/galaxyBackfill.ts). */
export interface GalaxyBackfillResult {
  checked: number;
  recorded: number;
  skipped: { no_saved_board: number; not_finished: number; no_winner: number; not_recorded: number };
  more: boolean;
}

interface Filters {
  /** 0 reads all time. */
  days: number;
  seats: number | null;
  mode: GalaxyGameMode | null;
  relations: GalaxyRelations | null;
}

/**
 * The one mark hue: the dataviz reference palette's dark slot 1, validated on
 * this page's surface (#0f1117: lightness band, chroma and 3:1 contrast pass).
 * Every chart here is a single series, so it needs no other.
 */
const MARK = '#3987e5';
/** Chart chrome: the admin page's hairline and muted ink. */
const GRID = '#2d3448';
const AXIS_INK = '#9aa3b5';
const SURFACE = '#0f1117';

/** The balance gate's band around a fair share (GALAXY-BALANCE.md: within ±28%). */
const GATE = 0.28;

const WORLD_NAMES: Record<string, string> = { sol: 'Sol', verdan: 'Verdan', rust: 'Rust', nexus_station: 'Nexus' };
const RING = ['sol', 'verdan', 'rust', 'nexus_station'];
const FACTION_NAMES: Record<string, string> = {
  stellar_mandate: 'Stellar Mandate (Sol)',
  helion_navigators: 'Helion Navigators (Verdan)',
  forge_syndicate: 'Forge Syndicate (Rust)',
  void_custodians: 'Void Custodians (Nexus)',
};
const MODE_NAMES: Record<GalaxyGameMode, string> = {
  colonies: 'Colonies',
  home_worlds: 'Home worlds',
  '2v2': '2v2',
  partial_schism: 'Partial Schism',
  schism: 'Schism',
  scattered: 'No home worlds',
};
const RELATION_NAMES: Record<GalaxyRelations, string> = { concord: 'Concord', civil_war: 'Civil War', allied: 'Allied' };
const ROLE_NAMES: Record<GalaxySeatRole, string> = {
  home: 'Home world',
  rival: 'House with a rival',
  alone: 'House alone',
  ally: 'Allied house',
  whole: 'Whole world (Allied)',
  scattered: 'No home world',
};
const ENDING_NAMES: Record<string, string> = {
  threshold: 'Territory threshold',
  domination: 'Domination',
  lane_sovereignty: 'Lane Sovereignty',
  last_standing: 'Last standing',
  capital: 'Capital capture',
  secret_mission: 'Secret mission',
  alliance_victory: 'Alliance victory',
  turn_limit: 'Turn limit',
  resignation: 'Resignation',
  surrender: 'Surrender',
  humans_eliminated: 'Every human out',
  abandoned: 'Abandoned',
  unknown: 'Unknown',
};

const WINDOWS = [
  { days: 0, label: 'All time' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
];

type Breakdown = 'factions' | 'roles' | 'houses' | 'players';
const BREAKDOWNS: Array<{ key: Breakdown; label: string }> = [
  { key: 'factions', label: 'Factions' },
  { key: 'roles', label: 'Roles' },
  { key: 'houses', label: 'Schism houses' },
  { key: 'players', label: 'Humans & AI' },
];

/** 0.125 → "12.5%", 0.25 → "25%". */
export function pct(x: number): string {
  return `${(x * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function countOf(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Whether the unrecorded games can still be recorded: only from their final, game-over board. */
export function savedBoardsNote(unrecorded: number, recoverable: number): string {
  const kept = 'Saved boards are kept for 7 days after a game ends, by default.';
  if (recoverable <= 0) {
    return `${unrecorded === 1 ? "Its final board isn't saved, so it" : "Their final boards aren't saved, so they"} can't be recovered. ${kept}`;
  }
  if (recoverable >= unrecorded) {
    return `${unrecorded === 1 ? 'Its final board is still saved, so it' : 'Their final boards are still saved, so they'} can be recorded now. ${kept}`;
  }
  return `${countOf(recoverable, 'of them still has its final board saved, so it', 'of them still have their final boards saved, so those')} can be recorded now. ${kept}`;
}

/** What a backfill did, in a sentence. */
export function backfillSummary(r: GalaxyBackfillResult): string {
  const notes = ([
    [r.skipped.no_saved_board, 'had no saved board left'],
    [r.skipped.not_finished, 'never saved a game-over board'],
    [r.skipped.no_winner, 'named no winner'],
    [r.skipped.not_recorded, 'could not be recorded'],
  ] as const)
    .filter(([n]) => n > 0)
    .map(([n, why]) => `${countOf(n, 'game', 'games')} ${why}`);
  return `Recovered ${countOf(r.recorded, 'game', 'games')}${notes.length ? `; ${notes.join(', ')}` : ''}.`
    + (r.more ? ' More remain: recover again.' : '');
}

function worldList(key: string): string {
  const worlds = key.split('+');
  return RING.filter((w) => worlds.includes(w)).map((w) => WORLD_NAMES[w] ?? w).join(' + ');
}

function boardLabel(game: Pick<GalaxyReportGame, 'mode' | 'seats' | 'relations' | 'board'>): string {
  const parts = [MODE_NAMES[game.mode] ?? game.mode, `${game.seats} seats`];
  if (game.relations) parts.push(RELATION_NAMES[game.relations] ?? game.relations);
  if (game.board) parts.push(`${worldList(game.board)} split`);
  return parts.join(' · ');
}

function playerLabel(key: string): string {
  return key === 'human' ? 'Humans' : `AI · ${key.slice(3)}`;
}

function seatName(seat: GalaxyReportSeat): string {
  if (seat.is_ai) return `AI (${seat.ai_difficulty ?? '?'})`;
  return seat.username ?? 'Deleted account';
}

function seatDetail(seat: GalaxyReportSeat): string {
  const world = seat.world_id ? WORLD_NAMES[seat.world_id] ?? seat.world_id : null;
  const where = seat.house ?? world ?? (seat.faction_id ? FACTION_NAMES[seat.faction_id] ?? seat.faction_id : null);
  const role = seat.role === 'home' || seat.role === 'scattered' ? null : ROLE_NAMES[seat.role].toLowerCase();
  return [where, role].filter(Boolean).join(' · ');
}

function duration(game: GalaxyReportGame): string {
  if (!game.started_at || !game.ended_at) return '—';
  const minutes = Math.round((Date.parse(game.ended_at) - Date.parse(game.started_at)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
}

/**
 * Games per UTC day from the first day with a game to the last, gaps filled with
 * zero; past 60 days, per week from Monday.
 */
export function seriesByDay(byDay: GalaxyAnalytics['by_day']): { points: Array<{ day: string; games: number }>; weekly: boolean } {
  if (!byDay.length) return { points: [], weekly: false };
  const counts = new Map(byDay.map((d) => [d.day, d.games]));
  const start = Date.parse(`${byDay[0]!.day}T00:00:00Z`);
  const end = Date.parse(`${byDay[byDay.length - 1]!.day}T00:00:00Z`);
  const DAY = 86_400_000;
  const daily: Array<{ day: string; games: number }> = [];
  for (let t = start; t <= end; t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    daily.push({ day, games: counts.get(day) ?? 0 });
  }
  if (daily.length <= 60) return { points: daily, weekly: false };
  const weeks = new Map<string, number>();
  for (const d of daily) {
    const t = Date.parse(`${d.day}T00:00:00Z`);
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    weeks.set(monday, (weeks.get(monday) ?? 0) + d.games);
  }
  return { points: [...weeks.entries()].map(([day, games]) => ({ day, games })), weekly: true };
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

function rateStat(rate: GalaxyRate | null | undefined): { value: string; sub?: string } {
  if (!rate || !rate.seats) return { value: '—' };
  return { value: pct(rate.rate), sub: `fair share ${pct(rate.expected_rate)} · ${rate.wins} of ${rate.seats}` };
}

/**
 * One row of the range plot: the win rate (dot), its 95% interval (band), the
 * fair share (tick) and the gate's ±28% around it (faint). Its numbers are
 * printed beside it, so the row is its own table view.
 */
function RateRow({ label, rate }: { label: string; rate: GalaxyRate }) {
  const share = rate.expected_rate;
  const gateLow = Math.max(0, share * (1 - GATE));
  const gateHigh = Math.min(1, share * (1 + GATE));
  const above = rate.low > share;
  const below = rate.high < share;
  const at = (x: number) => `${Math.min(100, Math.max(0, x * 100))}%`;
  return (
    <div
      className="group relative grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-x-3 gap-y-1 rounded-md px-1 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-bf-gold sm:grid-cols-[minmax(0,13rem)_1fr_12rem]"
      role="group"
      tabIndex={0}
      aria-label={`${label}: won ${rate.wins} of ${rate.seats} seats, ${pct(rate.rate)}; fair share ${pct(share)}; 95% interval ${pct(rate.low)} to ${pct(rate.high)}`}
    >
      <div className="truncate text-sm text-bf-text" title={label}>{label}</div>
      <div className="relative h-6" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((g) => (
          <div key={g} className="absolute inset-y-0 w-px" style={{ left: at(g), background: GRID }} />
        ))}
        <div className="absolute inset-y-1 rounded-sm bg-white/5" style={{ left: at(gateLow), width: at(gateHigh - gateLow) }} />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ left: at(rate.low), width: at(rate.high - rate.low), background: MARK, opacity: 0.35 }}
        />
        <div className="absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-bf-text/80" style={{ left: at(share) }} />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: at(rate.rate), background: MARK, boxShadow: `0 0 0 2px ${SURFACE}` }}
        />
      </div>
      <div className="col-span-2 flex items-baseline justify-between gap-2 text-xs sm:col-span-1 sm:block sm:text-right">
        <span className="tabular-nums text-bf-text">
          {pct(rate.rate)} <span className="text-bf-muted">· {rate.wins}/{rate.seats}</span>
        </span>
        <span className="block tabular-nums text-bf-muted">
          {above && <ArrowUp className="mr-0.5 inline h-3 w-3" aria-hidden="true" />}
          {below && <ArrowDown className="mr-0.5 inline h-3 w-3" aria-hidden="true" />}
          {above ? 'above share · ' : below ? 'below share · ' : ''}share {pct(share)}
        </span>
      </div>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden w-64 -translate-x-1/2 rounded-lg border border-bf-border bg-bf-surface px-3 py-2 text-xs shadow-lg group-hover:block group-focus:block"
      >
        <div className="font-semibold tabular-nums text-bf-text">{pct(rate.rate)} won</div>
        <div className="text-bf-muted">{label}</div>
        <div className="mt-1 tabular-nums text-bf-muted">
          {rate.wins} of {rate.seats} seats · {rate.expected.toFixed(1)} at a fair share
        </div>
        <div className="tabular-nums text-bf-muted">95% interval {pct(rate.low)}–{pct(rate.high)}</div>
        <div className="tabular-nums text-bf-muted">gate {pct(gateLow)}–{pct(gateHigh)}</div>
      </div>
    </div>
  );
}

function RateKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-bf-muted" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: MARK }} /> win rate
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-5 rounded-full" style={{ background: MARK, opacity: 0.35 }} /> 95% interval
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-0.5 rounded-full bg-bf-text/80" /> fair share (1 / sides)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm bg-white/5" /> gate, ±28% of the share
      </span>
    </div>
  );
}

function rateRows(analytics: GalaxyAnalytics, breakdown: Breakdown): Array<{ key: string; label: string; rate: GalaxyRate }> {
  switch (breakdown) {
    case 'factions':
      return analytics.factions.map((r) => ({ key: r.key, label: FACTION_NAMES[r.key] ?? r.key, rate: r }));
    case 'roles':
      return analytics.roles.map((r) => ({ key: r.key, label: ROLE_NAMES[r.key as GalaxySeatRole] ?? r.key, rate: r }));
    case 'houses':
      return analytics.houses.map((r) => ({ key: r.key, label: `${r.house} · ${ROLE_NAMES[r.role].toLowerCase()}`, rate: r }));
    case 'players':
      return analytics.players.map((r) => ({ key: r.key, label: playerLabel(r.key), rate: r }));
  }
}

const selectClass =
  'rounded-lg border border-bf-border bg-bf-dark px-2 py-1.5 text-sm text-bf-text focus:border-bf-gold focus:outline-none';

export default function AdminGalaxyReportPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [filters, setFilters] = useState<Filters>({ days: 0, seats: null, mode: null, relations: null });
  const [report, setReport] = useState<GalaxyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown>('factions');
  const [reload, setReload] = useState(0);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    const params: Record<string, string | number> = {};
    if (filters.days) params.days = filters.days;
    if (filters.seats) params.seats = filters.seats;
    if (filters.mode) params.mode = filters.mode;
    if (filters.relations) params.relations = filters.relations;
    api
      .get<GalaxyReport>('/admin/metrics/galaxy', { params })
      .then((res) => {
        if (!stale) setReport(res.data);
      })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { error?: string } } };
        if (!stale) setError(err?.response?.data?.error ?? 'Failed to load the Galactic Age report');
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [filters, refreshKey, reload]);

  /** Record the unrecorded games that still have a saved board, then read the report again. */
  const recover = () => {
    setRecovering(true);
    api
      .post<GalaxyBackfillResult>('/admin/actions/galaxy-backfill')
      .then((res) => {
        const summary = backfillSummary(res.data);
        if (res.data.recorded > 0) toast.success(summary, { duration: 8000 });
        else toast(summary, { duration: 8000 });
        setReload((n) => n + 1);
      })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { error?: string } } };
        toast.error(err?.response?.data?.error ?? 'Failed to recover the unrecorded games');
      })
      .finally(() => setRecovering(false));
  };

  const { points: days, weekly } = useMemo(() => seriesByDay(report?.analytics.by_day ?? []), [report]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const filterRow = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-bf-muted">
        Window
        <select className={selectClass} value={filters.days} onChange={(e) => set('days', Number(e.target.value))}>
          {WINDOWS.map((w) => <option key={w.days} value={w.days}>{w.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-bf-muted">
        Seats
        <select
          className={selectClass}
          value={filters.seats ?? ''}
          onChange={(e) => set('seats', e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All</option>
          {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-bf-muted">
        Board
        <select
          className={selectClass}
          value={filters.mode ?? ''}
          onChange={(e) => set('mode', (e.target.value || null) as GalaxyGameMode | null)}
        >
          <option value="">All</option>
          {(Object.keys(MODE_NAMES) as GalaxyGameMode[]).map((m) => <option key={m} value={m}>{MODE_NAMES[m]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-bf-muted">
        House relations
        <select
          className={selectClass}
          value={filters.relations ?? ''}
          onChange={(e) => set('relations', (e.target.value || null) as GalaxyRelations | null)}
        >
          <option value="">All</option>
          {(Object.keys(RELATION_NAMES) as GalaxyRelations[]).map((r) => <option key={r} value={r}>{RELATION_NAMES[r]}</option>)}
        </select>
      </label>
    </div>
  );

  if (!report) {
    return (
      <div className="space-y-4">
        {filterRow}
        {error
          ? <p className="text-sm text-red-300">{error}</p>
          : <p className="text-sm text-bf-muted">Loading…</p>}
      </div>
    );
  }

  const a = report.analytics;
  const unrecorded = report.unrecorded_games;
  const recoverable = report.recoverable_games ?? 0;
  const human = a.players.find((p) => p.key === 'human');
  const rows = rateRows(a, breakdown);
  const endingMax = Math.max(1, ...a.endings.map((e) => e.games));
  const humanStat = rateStat(human);
  const firstStat = rateStat(a.first_seat);

  return (
    <div className="space-y-6">
      {filterRow}
      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        <p className="text-sm text-bf-muted">
          Every Galactic Age game is recorded as it ends: the board it dealt, each seat&apos;s faction, house, role and
          side, and who won. Win rates are per seat against the seat&apos;s fair share of its game (1 / sides), as the
          balance sim reads them.
        </p>

        {unrecorded > 0 && (
          <div className="space-y-2 rounded-xl border border-bf-border bg-cc-panel/50 p-4 text-sm">
            <p className="text-bf-text">
              {countOf(unrecorded, 'finished Galactic Age game', 'finished Galactic Age games')} in this window{' '}
              {unrecorded === 1
                ? 'is missing from the report: it ended before the report started recording, or its record failed to write.'
                : 'are missing from the report: they ended before the report started recording, or their records failed to write.'}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-bf-muted">{savedBoardsNote(unrecorded, recoverable)}</p>
              {recoverable > 0 && (
                <button
                  type="button"
                  onClick={recover}
                  disabled={recovering || loading}
                  className="rounded-lg border border-bf-gold/60 bg-bf-gold/10 px-3 py-1.5 text-sm font-medium text-bf-gold hover:bg-bf-gold/20 disabled:opacity-50"
                >
                  {recovering ? 'Recovering…' : `Recover ${countOf(recoverable, 'game', 'games')}`}
                </button>
              )}
            </div>
          </div>
        )}

        {a.games === 0 ? (
          <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-6 text-center">
            <p className="font-medium text-bf-text">No finished Galactic Age games recorded for these filters.</p>
            <p className="mt-1 text-sm text-bf-muted">Host a game from the lobby; it appears here when it ends.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat
                label="Games finished"
                value={a.games.toLocaleString()}
                sub={report.truncated ? `newest of ${report.total_games.toLocaleString()}` : undefined}
              />
              <Stat
                label="Won on the board"
                value={pct(a.decisive / a.games)}
                sub="not a turn limit, resignation or every human out"
              />
              <Stat
                label="Average length"
                value={a.avg_turns != null ? `${a.avg_turns.toFixed(1)} turns` : '—'}
                sub={a.median_minutes != null ? `median ${Math.round(a.median_minutes)} min` : undefined}
              />
              <Stat label="Human seats won" value={humanStat.value} sub={humanStat.sub} />
              <Stat label="First seat won" value={firstStat.value} sub={firstStat.sub} />
            </div>

            <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-bf-text">Win rate against the fair share</p>
                  <p className="text-xs text-bf-muted">
                    Per seat, with a 95% interval. Seats on one side win together, so team rows read a little narrow.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Breakdown">
                  {BREAKDOWNS.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      aria-pressed={breakdown === b.key}
                      onClick={() => setBreakdown(b.key)}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        breakdown === b.key
                          ? 'border-bf-gold bg-bf-gold/10 text-bf-gold'
                          : 'border-bf-border text-bf-muted hover:text-bf-text'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <RateKey />
              </div>
              <div className="mt-2 hidden grid-cols-[minmax(0,13rem)_1fr_12rem] gap-x-3 px-1 text-[11px] tabular-nums text-bf-muted sm:grid" aria-hidden="true">
                <span />
                <span className="relative h-4">
                  {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                    <span key={g} className="absolute -translate-x-1/2" style={{ left: `${g * 100}%` }}>{pct(g)}</span>
                  ))}
                </span>
                <span />
              </div>
              <div className="mt-1 space-y-0.5">
                {rows.length === 0
                  ? <p className="py-3 text-sm text-bf-muted">No seats of this kind in these games.</p>
                  : rows.map((r) => <RateRow key={r.key} label={r.label} rate={r.rate} />)}
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold text-bf-text">How games ended</p>
                <div className="mt-3 space-y-2">
                  {a.endings.map((e) => (
                    <div key={e.victory} className="grid grid-cols-[9rem_1fr_5rem] items-center gap-3 text-sm">
                      <span className="truncate text-bf-text">{ENDING_NAMES[e.victory] ?? e.victory}</span>
                      <div className="h-3">
                        <div
                          className="h-3 rounded-r"
                          style={{ width: `${(e.games / endingMax) * 100}%`, background: MARK }}
                        />
                      </div>
                      <span className="text-right text-xs tabular-nums text-bf-muted">
                        {e.games} · {pct(e.games / a.games)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold text-bf-text">Boards played</p>
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-bf-muted">
                      <th className="pb-1 text-left font-normal">Board</th>
                      <th className="pb-1 text-right font-normal">Games</th>
                      <th className="pb-1 text-right font-normal">Avg turns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.modes.map((m) => (
                      <tr key={`${m.mode}|${m.seats}|${m.relations ?? ''}`} className="border-t border-bf-border/50">
                        <td className="py-1.5 text-bf-text">{boardLabel({ ...m, board: null })}</td>
                        <td className="py-1.5 text-right tabular-nums text-bf-text">{m.games}</td>
                        <td className="py-1.5 text-right tabular-nums text-bf-muted">{m.avg_turns.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
              <p className="text-sm font-semibold text-bf-text">Games finished per {weekly ? 'week' : 'day'}</p>
              <p className="text-xs text-bf-muted">UTC {weekly ? 'weeks, from Monday' : 'days'}</p>
              <div className="mt-2 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fill: AXIS_INK, fontSize: 11 }}
                      tickFormatter={(d: string) => d.slice(5)}
                      axisLine={{ stroke: GRID }}
                      tickLine={false}
                    />
                    <YAxis allowDecimals={false} tick={{ fill: AXIS_INK, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{ background: '#1a1f2e', border: `1px solid ${GRID}`, borderRadius: 8 }}
                      labelStyle={{ color: '#e8e8e8' }}
                      itemStyle={{ color: '#e8e8e8' }}
                      formatter={(v) => [v, 'Games']}
                    />
                    {/* No grow-in: a refetch keeps the frame instead of replaying bars from zero. */}
                    <Bar dataKey="games" fill={MARK} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="mt-2 text-xs text-bf-muted">
                <summary className="cursor-pointer hover:text-bf-text">Show as a table</summary>
                <table className="mt-2 w-full max-w-xs">
                  <tbody>
                    {days.filter((d) => d.games > 0).map((d) => (
                      <tr key={d.day} className="border-t border-bf-border/50">
                        <td className="py-1 tabular-nums">{d.day}</td>
                        <td className="py-1 text-right tabular-nums text-bf-text">{d.games}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>

            <section className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-bf-text">Recent games</p>
                <p className="text-xs text-bf-muted">
                  newest {report.games.length.toLocaleString()} of {report.total_games.toLocaleString()}
                </p>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-bf-muted">
                      <th className="pb-1 pr-3 text-left font-normal">Finished</th>
                      <th className="pb-1 pr-3 text-left font-normal">Board</th>
                      <th className="pb-1 pr-3 text-left font-normal">Ending</th>
                      <th className="pb-1 pr-3 text-right font-normal">Turns</th>
                      <th className="pb-1 pr-3 text-right font-normal">Time</th>
                      <th className="pb-1 text-left font-normal">Seats, in turn order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.games.map((g) => (
                      <tr key={g.game_id} className="border-t border-bf-border/50 align-top">
                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-bf-muted">
                          {new Date(g.finished_at).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2 pr-3 text-bf-text">{boardLabel(g)}</td>
                        <td className="py-2 pr-3 text-bf-text">{ENDING_NAMES[g.victory ?? 'unknown'] ?? g.victory}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-bf-text">{g.turns}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-bf-muted">{duration(g)}</td>
                        <td className="py-2">
                          <ul className="flex flex-wrap gap-1.5">
                            {g.seat_results.map((s) => (
                              <li
                                key={s.seat}
                                className={`rounded-md border px-1.5 py-0.5 text-xs ${
                                  s.won ? 'border-bf-gold/60 text-bf-text' : 'border-bf-border text-bf-muted'
                                }`}
                              >
                                {s.won && <Trophy className="mr-1 inline h-3 w-3 text-bf-gold" aria-label="won" />}
                                {g.first_seat === s.seat && (
                                  <span className="mr-1 text-[10px] uppercase tracking-wide text-bf-muted" title="moved first">1st</span>
                                )}
                                <span className={s.won ? 'font-medium' : s.eliminated ? 'line-through decoration-bf-muted/60' : ''}>
                                  {seatName(s)}
                                </span>
                                {seatDetail(s) && <span className="text-bf-muted"> · {seatDetail(s)}</span>}
                                {s.resigned && <span className="text-bf-muted"> · resigned</span>}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
