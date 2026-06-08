import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import { api } from '../services/api';
import Modal from '../components/ui/Modal';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const CLIENT_FEATURE_FLAGS = [
  {
    key: 'map_editor_enabled',
    label: 'Map Editor',
    description: 'Show Map Editor navigation and allow players to create or publish custom maps.',
  },
  {
    key: 'era_advancement_lobby_enabled',
    label: 'Era Advancement (lobby)',
    description:
      'Show the Era Advancement advanced game setting in the lobby. Does not affect games already created with the option on.',
  },
] as const;

type TabKey = 'overview' | 'balance' | 'ranked' | 'config' | 'users' | 'audit';

const tabs: Array<{ key: TabKey; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Volume, health, trends' },
  { key: 'balance', label: 'Balance', description: 'Factions, eras, maps, pace' },
  { key: 'ranked', label: 'Ranked', description: 'Rating distribution' },
  { key: 'config', label: 'Config', description: 'Live tuning & flags' },
  { key: 'users', label: 'Users', description: 'Search & moderation' },
  { key: 'audit', label: 'Audit', description: 'Admin actions log' },
];

const CHART_COLORS = ['#d5ad36', '#6ea8fe', '#52c49a', '#e67e22', '#9b59b6', '#1abc9c', '#ecf0f1', '#e74c3c'];

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function utcDayKeys(days: number): string[] {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ms = utcMidnight - i * 86400000;
    keys.push(new Date(ms).toISOString().slice(0, 10));
  }
  return keys;
}

function buildActivitySeries(
  days: number,
  completed: Array<{ day: string; n: number }>,
  created: Array<{ day: string; n: number }>,
): Array<{ day: string; dayLabel: string; games_completed: number; games_created: number }> {
  const cMap = new Map(completed.map((r) => [r.day, r.n]));
  const aMap = new Map(created.map((r) => [r.day, r.n]));
  const keys = utcDayKeys(days);
  return keys.map((day) => {
    const d = new Date(`${day}T12:00:00Z`);
    return {
      day,
      dayLabel: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      games_completed: cMap.get(day) ?? 0,
      games_created: aMap.get(day) ?? 0,
    };
  });
}

function rankedBucketLabel(bucket: number): string {
  const low = 800;
  const high = 2400;
  const buckets = 8;
  const w = (high - low) / buckets;
  if (bucket < 1 || bucket > buckets) return `Out of range (${bucket})`;
  const a = Math.round(low + (bucket - 1) * w);
  const b = Math.round(low + bucket * w);
  return `${a}–${b}`;
}

interface OverviewPayload {
  total_users: number;
  games_created: number;
  games_completed: number;
  games_in_progress: number;
  games_waiting: number;
  games_by_status: Record<string, number>;
  avg_completed_duration_seconds: number | null;
  ranked_queue_depth: number;
  matchmaking_paused: boolean;
}

interface TimeseriesPayload {
  days: number;
  completed_by_day: Array<{ day: string; n: number }>;
  created_by_day: Array<{ day: string; n: number }>;
  completed_by_type: Array<{ game_type: string; n: number }>;
}

interface SettingsToggleUsagePayload {
  total_games: number;
  rows: Array<{
    setting_key: string;
    setting_label: string;
    enabled_count: number;
    enabled_percent: number;
  }>;
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-bf-border bg-cc-panel/90 p-4 shadow-md backdrop-blur-sm">
      <p className="text-[11px] font-medium uppercase tracking-wider text-bf-muted">{label}</p>
      <p className="mt-2 font-display text-2xl tabular-nums text-bf-gold">{value}</p>
      {hint ? <p className="mt-1.5 text-xs leading-snug text-bf-muted">{hint}</p> : null}
    </div>
  );
}

export default function AdminPage() {
  type ResetScope = 'all' | 'era' | 'map' | 'era_map';
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPayload | null>(null);
  const [trendDays, setTrendDays] = useState(30);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [factions, setFactions] = useState<
    Array<{ faction_id: string; games_played: number; wins: number; win_rate: number }>
  >([]);
  const [eras, setEras] = useState<
    Array<{ era_id: string; games_completed: number; avg_duration_seconds: number }>
  >([]);
  const [maps, setMaps] = useState<
    Array<{ map_id: string; games_completed: number; avg_duration_seconds: number }>
  >([]);
  const [durations, setDurations] = useState<
    Array<{ game_id: string; era_id: string; map_id: string; duration_seconds: number }>
  >([]);
  const [rankedDist, setRankedDist] = useState<Array<{ bucket: number; count: number }>>([]);
  const [settingsToggleUsage, setSettingsToggleUsage] = useState<SettingsToggleUsagePayload | null>(null);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [users, setUsers] = useState<
    Array<{
      user_id: string;
      username: string;
      email: string;
      level: number;
      xp: number;
      mmr: number;
      is_banned: boolean;
      is_admin: boolean;
      created_at: string;
    }>
  >([]);
  const [audit, setAudit] = useState<
    Array<{
      id: string;
      action: string;
      payload: unknown;
      created_at: string;
      admin_username: string;
    }>
  >([]);
  const [search, setSearch] = useState('');
  const [patchKey, setPatchKey] = useState('xp');
  const [patchValue, setPatchValue] = useState('{}');
  const [flagSaving, setFlagSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statOptions, setStatOptions] = useState<{ era_ids: string[]; map_ids: string[] }>({ era_ids: [], map_ids: [] });
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetTargetUser, setResetTargetUser] = useState<{ user_id: string; username: string } | null>(null);
  const [resetScope, setResetScope] = useState<ResetScope>('all');
  const [resetEraId, setResetEraId] = useState('');
  const [resetMapId, setResetMapId] = useState('');
  const [resetConfirmText, setResetConfirmText] = useState('');

  const overviewParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (from) p.from = `${from}T00:00:00.000Z`;
    if (to) p.to = `${to}T23:59:59.999Z`;
    return p;
  }, [from, to]);

  const reloadOverviewAllTime = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovRes, tsRes] = await Promise.all([
        api.get<OverviewPayload>('/admin/metrics/overview'),
        api.get<TimeseriesPayload>('/admin/metrics/timeseries', { params: { days: trendDays } }),
      ]);
      setOverview(ovRes.data);
      setTimeseries(tsRes.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error ?? 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [trendDays]);

  const loadTab = useCallback(
    async (tab: TabKey) => {
      setLoading(true);
      setError(null);
      try {
        if (tab === 'overview') {
          const [ovRes, tsRes] = await Promise.all([
            api.get<OverviewPayload>('/admin/metrics/overview', { params: overviewParams }),
            api.get<TimeseriesPayload>('/admin/metrics/timeseries', { params: { days: trendDays } }),
          ]);
          setOverview(ovRes.data);
          setTimeseries(tsRes.data);
        } else if (tab === 'balance') {
          const [factionRes, eraRes, mapRes, durationRes, settingsTogglesRes] = await Promise.all([
            api.get('/admin/metrics/factions'),
            api.get('/admin/metrics/eras'),
            api.get('/admin/metrics/maps'),
            api.get('/admin/metrics/duration'),
            api.get<SettingsToggleUsagePayload>('/admin/metrics/settings-toggles'),
          ]);
          setFactions(factionRes.data ?? []);
          setEras(eraRes.data ?? []);
          setMaps(mapRes.data ?? []);
          setDurations(durationRes.data ?? []);
          setSettingsToggleUsage(settingsTogglesRes.data ?? null);
        } else if (tab === 'ranked') {
          const res = await api.get('/admin/metrics/ranked-distribution');
          setRankedDist(res.data ?? []);
        } else if (tab === 'config') {
          const res = await api.get('/admin/config');
          setConfig(res.data ?? null);
        } else if (tab === 'users') {
          const [usersRes, optionsRes] = await Promise.all([
            api.get('/admin/users', { params: { search } }),
            api.get<{ era_ids: string[]; map_ids: string[] }>('/admin/metrics/stat-options'),
          ]);
          setUsers(usersRes.data ?? []);
          setStatOptions({
            era_ids: optionsRes.data?.era_ids ?? [],
            map_ids: optionsRes.data?.map_ids ?? [],
          });
        } else if (tab === 'audit') {
          const res = await api.get('/admin/audit-log', { params: { limit: 100 } });
          setAudit(res.data ?? []);
        }
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } } };
        setError(err?.response?.data?.error ?? 'Failed to load admin data');
      } finally {
        setLoading(false);
      }
    },
    [overviewParams, search, trendDays],
  );

  useEffect(() => {
    void loadTab(activeTab);
  }, [activeTab, loadTab]);

  useEffect(() => {
    if (!config || typeof config !== 'object') return;
    const cfg = (config as { config?: Record<string, unknown> }).config;
    if (!cfg || typeof cfg[patchKey] !== 'object') return;
    setPatchValue(JSON.stringify(cfg[patchKey as keyof typeof cfg] ?? {}, null, 2));
  }, [config, patchKey]);

  const activitySeries = useMemo(() => {
    if (!timeseries) return [];
    return buildActivitySeries(timeseries.days, timeseries.completed_by_day, timeseries.created_by_day);
  }, [timeseries]);

  const rankedChartData = useMemo(
    () =>
      rankedDist.map((r) => ({
        ...r,
        label: rankedBucketLabel(r.bucket),
      })),
    [rankedDist],
  );

  const durationSeries = useMemo(
    () =>
      durations.slice(0, 40).map((d, i) => ({
        i: i + 1,
        minutes: Math.round((Number(d.duration_seconds ?? 0) / 60) * 10) / 10,
        era: d.era_id,
      })),
    [durations],
  );

  const statusPie = useMemo(() => {
    if (!overview?.games_by_status) return [];
    return Object.entries(overview.games_by_status).map(([name, value]) => ({ name, value }));
  }, [overview]);

  const typePie = useMemo(() => {
    if (!timeseries?.completed_by_type) return [];
    return timeseries.completed_by_type.map((r) => ({ name: r.game_type, value: r.n }));
  }, [timeseries]);

  const settingsToggleChartData = useMemo(() => {
    if (!settingsToggleUsage?.rows) return [];
    return settingsToggleUsage.rows.map((row) => ({
      ...row,
      display_count: row.enabled_count.toLocaleString(),
      display_percent: `${row.enabled_percent.toFixed(1)}%`,
    }));
  }, [settingsToggleUsage]);

  async function submitConfigPatch() {
    try {
      const parsed = JSON.parse(patchValue);
      await api.patch(`/admin/config/${patchKey}`, { value: parsed });
      toast.success('Config saved');
      await loadTab('config');
      if (patchKey === 'feature_flags') {
        await useFeatureFlagsStore.getState().load();
      }
      setError(null);
    } catch {
      setError('Config patch failed. Ensure JSON is valid.');
    }
  }

  async function toggleFeatureFlag(key: string, enabled: boolean) {
    const cfg = (config as { config?: { feature_flags?: Record<string, boolean> } } | null)?.config;
    const current = cfg?.feature_flags ?? {};
    setFlagSaving(key);
    try {
      await api.patch('/admin/config/feature_flags', {
        value: { ...current, [key]: enabled },
      });
      toast.success(`${key.replace(/_/g, ' ')} ${enabled ? 'enabled' : 'disabled'}`);
      await loadTab('config');
      await useFeatureFlagsStore.getState().load();
      setError(null);
    } catch {
      setError('Feature flag update failed.');
      toast.error('Feature flag update failed');
    } finally {
      setFlagSaving(null);
    }
  }

  async function postAction(path: string, body?: object) {
    try {
      await api.post(path, body ?? {});
      toast.success('Done');
      if (activeTab === 'overview' || activeTab === 'config') await loadTab(activeTab);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err?.response?.data?.error ?? 'Action failed');
    }
  }

  async function setUserBanned(userId: string, banned: boolean) {
    const ok = window.confirm(banned ? 'Ban this user? They will not be able to log in.' : 'Unban this user?');
    if (!ok) return;
    await postAction(banned ? '/admin/actions/ban' : '/admin/actions/unban', { user_id: userId });
    await loadTab('users');
  }

  function openResetModal(userId: string, username: string): void {
    setResetTargetUser({ user_id: userId, username });
    setResetScope('all');
    setResetEraId('');
    setResetMapId('');
    setResetConfirmText('');
    setResetModalOpen(true);
  }

  function closeResetModal(): void {
    if (resetSubmitting) return;
    setResetModalOpen(false);
    setResetTargetUser(null);
  }

  async function submitResetStats(): Promise<void> {
    if (!resetTargetUser) return;
    const eraRequired = resetScope === 'era' || resetScope === 'era_map';
    const mapRequired = resetScope === 'map' || resetScope === 'era_map';
    if (eraRequired && !resetEraId.trim()) {
      toast.error('Please provide era_id for this scope');
      return;
    }
    if (mapRequired && !resetMapId.trim()) {
      toast.error('Please provide map_id for this scope');
      return;
    }
    if (resetConfirmText.trim() !== resetTargetUser.username) {
      toast.error(`Type "${resetTargetUser.username}" to confirm`);
      return;
    }

    setResetSubmitting(true);
    try {
      const res = await api.post<{
        games_affected: number;
        xp_removed: number;
        mmr_delta_removed: number;
        wins_removed: number;
      }>('/admin/actions/reset-user-stats', {
        user_id: resetTargetUser.user_id,
        scope: resetScope,
        era_id: eraRequired ? resetEraId.trim() : undefined,
        map_id: mapRequired ? resetMapId.trim() : undefined,
      });
      toast.success(
        `Stats reset: ${res.data.games_affected} games, XP -${res.data.xp_removed}, MMR delta -${res.data.mmr_delta_removed}, wins -${res.data.wins_removed}`,
      );
      closeResetModal();
      await loadTab('users');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err?.response?.data?.error ?? 'Failed to reset stats');
    } finally {
      setResetSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bf-dark text-bf-text">
      <div className="border-b border-bf-border bg-bf-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-bf-muted">Operations</p>
            <h1 className="font-display text-2xl tracking-wide text-bf-gold md:text-3xl">Admin Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-bf-muted">
              Live product health, balance signals, and runtime knobs. Charts use UTC day buckets for trends.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/lobby"
              className="rounded-lg border border-bf-border px-3 py-2 text-sm text-bf-text hover:border-bf-gold hover:text-bf-gold"
            >
              ← Lobby
            </Link>
            <button
              type="button"
              disabled={loading}
              onClick={() => loadTab(activeTab)}
              className="rounded-lg border border-bf-gold/60 bg-bf-gold/10 px-3 py-2 text-sm font-medium text-bf-gold hover:bg-bf-gold/20 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <div className="flex flex-wrap gap-2 border-b border-bf-border/80 pb-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                activeTab === tab.key
                  ? 'border-bf-gold bg-bf-gold/10 text-bf-gold'
                  : 'border-bf-border text-bf-text hover:border-bf-muted'
              }`}
            >
              <span className="font-semibold">{tab.label}</span>
              <span className="mt-0.5 block text-[11px] font-normal text-bf-muted">{tab.description}</span>
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-10 flex flex-col items-center gap-2 text-bf-muted">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-bf-border border-t-bf-gold" />
            <p className="text-sm">Loading…</p>
          </div>
        ) : null}

        {!loading && activeTab === 'overview' && overview && (
          <div className="mt-6 space-y-8">
            <div className="flex flex-col gap-3 rounded-xl border border-bf-border bg-cc-panel/40 p-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-medium text-bf-text">Game counts date filter</p>
                <p className="text-xs text-bf-muted">Filters games by <code className="text-bf-gold/90">created_at</code> (UTC).</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-bf-muted">
                  From
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="mt-1 block w-full rounded border border-bf-border bg-bf-surface px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-bf-muted">
                  To
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="mt-1 block w-full rounded border border-bf-border bg-bf-surface px-2 py-1.5 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => loadTab('overview')}
                  className="rounded-lg bg-bf-gold px-3 py-2 text-sm font-semibold text-black"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFrom('');
                    setTo('');
                    void reloadOverviewAllTime();
                  }}
                  className="rounded-lg border border-bf-border px-3 py-2 text-sm"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Registered users" value={overview.total_users.toLocaleString()} hint="All-time accounts" />
              <Kpi
                label="Games created (range)"
                value={overview.games_created.toLocaleString()}
                hint={from || to ? 'Filtered by created date' : 'All time'}
              />
              <Kpi
                label="Completed (range)"
                value={overview.games_completed.toLocaleString()}
                hint={`Avg length: ${formatDuration(overview.avg_completed_duration_seconds)}`}
              />
              <Kpi
                label="Matchmaking"
                value={overview.matchmaking_paused ? 'Paused' : 'Live'}
                hint={`Queue depth: ${overview.ranked_queue_depth}`}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Kpi label="In progress (range)" value={overview.games_in_progress} hint="Sessions currently running" />
              <Kpi label="Waiting lobbies (range)" value={overview.games_waiting} hint="Pre-start lobbies" />
              <Kpi
                label="Completion vs created"
                value={
                  overview.games_created > 0
                    ? `${Math.round((100 * overview.games_completed) / overview.games_created)}%`
                    : '—'
                }
                hint="Completed ÷ created in the same filter"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4 lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-bf-text">Activity trend</p>
                    <p className="text-xs text-bf-muted">Daily games completed vs created (UTC days)</p>
                  </div>
                  <select
                    value={trendDays}
                    onChange={(e) => setTrendDays(Number(e.target.value))}
                    className="rounded border border-bf-border bg-bf-surface px-2 py-1 text-sm"
                  >
                    <option value={14}>Last 14 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={60}>Last 60 days</option>
                    <option value={90}>Last 90 days</option>
                  </select>
                </div>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={activitySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fillCompleted" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#52c49a" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#52c49a" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fillCreated" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6ea8fe" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#6ea8fe" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" />
                      <XAxis dataKey="dayLabel" tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }}
                        labelFormatter={(_, p) => (p?.[0]?.payload as { day?: string })?.day ?? ''}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="games_completed" name="Completed" stroke="#52c49a" fill="url(#fillCompleted)" strokeWidth={2} />
                      <Area type="monotone" dataKey="games_created" name="Created" stroke="#6ea8fe" fill="url(#fillCreated)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold text-bf-text">Games by status</p>
                <p className="text-xs text-bf-muted">Same created_at filter as KPIs</p>
                <div className="mt-2 h-64">
                  {statusPie.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-bf-muted">No games in this filter.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                          {statusPie.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-bf-text">Completed games by type</p>
                  <p className="text-xs text-bf-muted">Last {timeseries?.days ?? trendDays} days (by end time)</p>
                </div>
              </div>
              <div className="h-56">
                {typePie.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-bf-muted">No completed games in this window.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={typePie} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }} />
                      <Bar dataKey="value" name="Completed" radius={[0, 6, 6, 0]}>
                        {typePie.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-bf-border bg-cc-panel/40 p-4">
              <p className="text-sm font-semibold text-bf-text">Quick actions</p>
              <p className="text-xs text-bf-muted">These write to the audit log.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                  onClick={() => {
                    if (window.confirm('Pause ranked matchmaking sweeps?')) void postAction('/admin/actions/matchmaking-pause');
                  }}
                >
                  Pause matchmaking
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
                  onClick={() => {
                    if (window.confirm('Resume matchmaking sweeps?')) void postAction('/admin/actions/matchmaking-resume');
                  }}
                >
                  Resume matchmaking
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-bf-border px-3 py-2 text-sm"
                  onClick={() => {
                    if (window.confirm('Regenerate today’s daily challenge row?')) void postAction('/admin/actions/regen-daily');
                  }}
                >
                  Regenerate daily (today)
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === 'balance' && (
          <div className="mt-6 space-y-6">
            <p className="text-sm text-bf-muted">
              Faction stats are from completed games with a recorded <code className="text-bf-gold/90">faction_id</code>.
              Era and map charts use completed games with known duration.
            </p>
            <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Toggle setting usage</p>
                  <p className="text-xs text-bf-muted">
                    Share of all created games where each toggle-able setting is enabled.
                  </p>
                </div>
                <span className="rounded-full border border-bf-border px-2.5 py-1 text-xs text-bf-muted">
                  Total games: {(settingsToggleUsage?.total_games ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="h-80">
                {settingsToggleChartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-bf-muted">
                    No game settings data yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={settingsToggleChartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: '#9aa3b5', fontSize: 11 }}
                        allowDecimals={false}
                        domain={[0, settingsToggleUsage ? Math.max(settingsToggleUsage.total_games, 1) : 1]}
                      />
                      <YAxis type="category" dataKey="setting_label" width={170} tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }}
                        formatter={(value, name, payload) => {
                          if (name === 'enabled_count') {
                            const p = payload?.payload as { enabled_percent?: number };
                            return [`${Number(value).toLocaleString()} games (${Number(p?.enabled_percent ?? 0).toFixed(1)}%)`, 'Enabled'];
                          }
                          return [String(value ?? ''), String(name ?? '')];
                        }}
                      />
                      <Bar dataKey="enabled_count" name="Enabled count" fill="#d5ad36" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              {settingsToggleChartData.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {settingsToggleChartData.slice(0, 6).map((row) => (
                    <div key={row.setting_key} className="rounded-lg border border-bf-border/70 bg-bf-dark/30 px-3 py-2">
                      <p className="text-xs text-bf-muted">{row.setting_label}</p>
                      <p className="mt-1 text-sm font-semibold text-bf-text">
                        {row.display_count} <span className="text-xs font-normal text-bf-muted">({row.display_percent})</span>
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold">Faction win rate</p>
                <p className="text-xs text-bf-muted">% wins among games where that faction was picked</p>
                <div className="mt-2 h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={factions} margin={{ bottom: 48 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" />
                      <XAxis dataKey="faction_id" angle={-30} textAnchor="end" interval={0} height={60} tick={{ fill: '#9aa3b5', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#9aa3b5', fontSize: 11 }} domain={[0, 'auto']} />
                      <Tooltip
                        contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }}
                        formatter={(value, name) => {
                          if (name === 'win_rate') return [`${value}%`, 'Win rate'];
                          return [String(value ?? ''), String(name ?? '')];
                        }}
                        labelFormatter={(l) => `Faction: ${l}`}
                      />
                      <Bar dataKey="win_rate" name="Win rate %" fill="#d5ad36" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold">Recent game lengths</p>
                <p className="text-xs text-bf-muted">Last 40 completed games — duration in minutes</p>
                <div className="mt-2 h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={durationSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" />
                      <XAxis dataKey="i" tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }}
                        formatter={(value) => [`${value} min`, 'Duration']}
                        labelFormatter={(i) => `Recent #${i}`}
                      />
                      <Line type="monotone" dataKey="minutes" stroke="#6ea8fe" strokeWidth={2} dot={false} name="Minutes" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold">Completed games by era</p>
                <div className="mt-2 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={eras}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" />
                      <XAxis dataKey="era_id" tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#9aa3b5', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }}
                        formatter={(value, name) =>
                          name === 'avg_duration_seconds'
                            ? [formatDuration(Number(value)), 'Avg duration']
                            : [String(value ?? ''), String(name ?? '')]
                        }
                      />
                      <Legend />
                      <Bar dataKey="games_completed" name="Completed" fill="#52c49a" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold">Top maps by completions</p>
                <div className="mt-2 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={maps.slice(0, 12)} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                      <YAxis type="category" dataKey="map_id" width={120} tick={{ fill: '#9aa3b5', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }} />
                      <Bar dataKey="games_completed" fill="#9b59b6" radius={[0, 6, 6, 0]} name="Completed" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === 'ranked' && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-bf-muted">
              Buckets are <code className="text-bf-gold/90">WIDTH_BUCKET(mu, 800, 2400, 8)</code> on ranked Glicko μ.
            </p>
            <div className="h-[420px] rounded-xl border border-bf-border bg-cc-panel/50 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankedChartData} margin={{ bottom: 56 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d3448" />
                  <XAxis dataKey="label" angle={-25} textAnchor="end" height={70} interval={0} tick={{ fill: '#9aa3b5', fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fill: '#9aa3b5', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3448', borderRadius: 8 }} />
                  <Bar dataKey="count" name="Players" fill="#52c49a" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!loading && activeTab === 'config' && (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bf-border bg-cc-panel/40 p-4">
              <div>
                <p className="text-sm font-semibold">Runtime state</p>
                <p className="text-xs text-bf-muted">
                  Matchmaking paused flag is process memory (clears on server restart).
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  (config as { matchmaking_paused?: boolean } | null)?.matchmaking_paused
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-emerald-500/20 text-emerald-200'
                }`}
              >
                {(config as { matchmaking_paused?: boolean } | null)?.matchmaking_paused ? 'Matchmaking paused' : 'Matchmaking running'}
              </span>
            </div>

            <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold">Feature flags</p>
                <p className="text-xs text-bf-muted mt-1">
                  Player-facing toggles — take effect immediately without a redeploy.
                </p>
              </div>
              {CLIENT_FEATURE_FLAGS.map(({ key, label, description }) => {
                const flags = (config as { config?: { feature_flags?: Record<string, boolean> } } | null)
                  ?.config?.feature_flags ?? {};
                return (
                  <label
                    key={key}
                    className="flex items-start justify-between gap-4 rounded-lg border border-bf-border/80 bg-bf-dark/40 px-3 py-3 cursor-pointer"
                  >
                    <span>
                      <span className="text-sm font-medium text-bf-text">{label}</span>
                      <span className="block text-xs text-bf-muted mt-0.5">{description}</span>
                      <span className="block text-[10px] text-bf-muted/80 mt-1 font-mono">{key}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={!!flags[key]}
                      disabled={flagSaving === key}
                      onChange={(e) => void toggleFeatureFlag(key, e.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 accent-bf-gold cursor-pointer"
                    />
                  </label>
                );
              })}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold">Full snapshot</p>
                <pre className="mt-2 max-h-[28rem] overflow-auto rounded-lg bg-bf-dark/60 p-3 text-[11px] leading-relaxed text-bf-muted">
                  {JSON.stringify(config, null, 2)}
                </pre>
              </div>

              <div className="space-y-3 rounded-xl border border-bf-border bg-cc-panel/50 p-4">
                <p className="text-sm font-semibold">Patch config block</p>
                <p className="text-xs text-bf-muted">
                  Economy &amp; XP are snapshotted into new games. Glicko, matchmaking buckets, and feature flags apply live where noted in code.
                </p>
                <select
                  value={patchKey}
                  onChange={(e) => setPatchKey(e.target.value)}
                  className="w-full rounded-lg border border-bf-border bg-bf-surface px-2 py-2 text-sm"
                >
                  <option value="economy">economy</option>
                  <option value="xp">xp</option>
                  <option value="glicko">glicko</option>
                  <option value="matchmaking">matchmaking</option>
                  <option value="default_game_settings">default_game_settings</option>
                  <option value="feature_flags">feature_flags</option>
                </select>
                <textarea
                  value={patchValue}
                  onChange={(e) => setPatchValue(e.target.value)}
                  className="h-72 w-full resize-y rounded-lg border border-bf-border bg-bf-dark/60 p-3 font-mono text-xs text-bf-text"
                />
                <button
                  type="button"
                  onClick={submitConfigPatch}
                  className="w-full rounded-lg bg-bf-gold py-2.5 text-sm font-semibold text-black hover:brightness-110"
                >
                  Save JSON block
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === 'users' && (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search username or email"
                className="min-w-[200px] flex-1 rounded-lg border border-bf-border bg-cc-panel px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => loadTab('users')} className="rounded-lg bg-bf-gold px-4 py-2 text-sm font-semibold text-black">
                Search
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-bf-border">
              <table className="min-w-full divide-y divide-bf-border text-sm">
                <thead className="bg-bf-surface/80 text-left text-xs uppercase tracking-wide text-bf-muted">
                  <tr>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Level</th>
                    <th className="px-3 py-2">XP / MMR</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2">Joined</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bf-border bg-cc-panel/40">
                  {users.map((u) => (
                    <tr key={u.user_id} className="hover:bg-bf-surface/40">
                      <td className="px-3 py-2 font-medium text-bf-text">{u.username}</td>
                      <td className="px-3 py-2 text-bf-muted">{u.email}</td>
                      <td className="px-3 py-2 tabular-nums">{u.level}</td>
                      <td className="px-3 py-2 text-xs tabular-nums text-bf-muted">
                        {u.xp.toLocaleString()} / {u.mmr.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {u.is_admin ? <span className="mr-1 text-bf-gold">admin</span> : null}
                        {u.is_banned ? <span className="text-red-300">banned</span> : <span className="text-bf-muted">ok</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-bf-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-2 text-xs">
                          {u.is_banned ? (
                            <button
                              type="button"
                              className="text-emerald-300 hover:underline"
                              onClick={() => void setUserBanned(u.user_id, false)}
                            >
                              Unban
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-red-300 hover:underline"
                              onClick={() => void setUserBanned(u.user_id, true)}
                            >
                              Ban
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-amber-200 hover:underline"
                            onClick={() => openResetModal(u.user_id, u.username)}
                          >
                            Reset stats…
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 ? <p className="p-4 text-center text-sm text-bf-muted">No users match.</p> : null}
            </div>
          </div>
        )}

        {!loading && activeTab === 'audit' && (
          <div className="mt-6 overflow-x-auto rounded-xl border border-bf-border">
            <table className="min-w-full divide-y divide-bf-border text-sm">
              <thead className="bg-bf-surface/80 text-left text-xs uppercase tracking-wide text-bf-muted">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Admin</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bf-border bg-cc-panel/40">
                {audit.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-bf-surface/40">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-bf-muted">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.admin_username}</td>
                    <td className="px-3 py-2 font-mono text-xs text-bf-gold">{row.action}</td>
                    <td className="max-w-md px-3 py-2 font-mono text-[11px] text-bf-muted">
                      <pre className="whitespace-pre-wrap break-all">{JSON.stringify(row.payload, null, 2)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {audit.length === 0 ? <p className="p-4 text-center text-sm text-bf-muted">No audit entries yet.</p> : null}
          </div>
        )}
      </div>

      <Modal open={resetModalOpen} onClose={closeResetModal} title="Reset User Stats" className="max-w-xl">
        {resetTargetUser ? (
          <div className="space-y-4">
            <p className="text-sm text-bf-muted">
              Target user: <span className="font-semibold text-bf-text">{resetTargetUser.username}</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-bf-muted">
                Scope
                <select
                  value={resetScope}
                  onChange={(e) => setResetScope(e.target.value as ResetScope)}
                  className="mt-1 w-full rounded border border-bf-border bg-bf-surface px-2 py-2 text-sm text-bf-text"
                  disabled={resetSubmitting}
                >
                  <option value="all">All stats</option>
                  <option value="era">Specific era</option>
                  <option value="map">Specific map</option>
                  <option value="era_map">Specific era + map</option>
                </select>
              </label>
              {(resetScope === 'era' || resetScope === 'era_map') ? (
                <label className="text-xs text-bf-muted">
                  era_id
                  <input
                    value={resetEraId}
                    onChange={(e) => setResetEraId(e.target.value)}
                    list="admin-reset-era-options"
                    placeholder="ancient / medieval / modern …"
                    className="mt-1 w-full rounded border border-bf-border bg-bf-surface px-2 py-2 text-sm text-bf-text"
                    disabled={resetSubmitting}
                  />
                </label>
              ) : <div />}
              {(resetScope === 'map' || resetScope === 'era_map') ? (
                <label className="text-xs text-bf-muted sm:col-span-2">
                  map_id
                  <input
                    value={resetMapId}
                    onChange={(e) => setResetMapId(e.target.value)}
                    list="admin-reset-map-options"
                    placeholder="era_modern / community_<id> …"
                    className="mt-1 w-full rounded border border-bf-border bg-bf-surface px-2 py-2 text-sm text-bf-text"
                    disabled={resetSubmitting}
                  />
                </label>
              ) : null}
            </div>

            <datalist id="admin-reset-era-options">
              {statOptions.era_ids.map((era) => (
                <option key={era} value={era} />
              ))}
            </datalist>
            <datalist id="admin-reset-map-options">
              {statOptions.map_ids.map((mapId) => (
                <option key={mapId} value={mapId} />
              ))}
            </datalist>

            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
              This action updates persistent player progression fields and cannot be undone.
            </div>
            <label className="block text-xs text-bf-muted">
              Type <span className="font-semibold text-bf-text">{resetTargetUser.username}</span> to confirm
              <input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                className="mt-1 w-full rounded border border-bf-border bg-bf-surface px-2 py-2 text-sm text-bf-text"
                disabled={resetSubmitting}
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeResetModal}
                className="rounded border border-bf-border px-3 py-2 text-sm"
                disabled={resetSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitResetStats()}
                className="rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
                disabled={resetSubmitting}
              >
                {resetSubmitting ? 'Resetting…' : 'Reset stats'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
