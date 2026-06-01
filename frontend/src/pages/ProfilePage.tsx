import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Trophy, Sword, Map, Flame, Target, Users, Bot, Zap, Shield, Award, GraduationCap, Coins, Play, Bell, Mail } from 'lucide-react';
import XpBar from '../components/ui/XpBar';
import TierBadge from '../components/ui/TierBadge';
import ReferralPanel from '../components/ui/ReferralPanel';

/** Format a date string with locale date + browser timezone abbreviation (e.g. "Apr 21, 2025 · PDT"). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return tz ? `${date} · ${tz}` : date;
}

interface RatingInfo { mu: number; phi: number; display: number; provisional: boolean }

interface UserProfile {
  user_id: string;
  username: string;
  level: number;
  xp: number;
  mmr: number;
  avatar_url?: string;
  created_at: string;
  ratings?: { solo?: RatingInfo; ranked?: RatingInfo };
  equipped_frame?: string | null;
  gold?: number;
}

interface Achievement {
  achievement_id: string;
  name: string;
  description: string;
  xp_reward: number;
  icon_url?: string;
  unlocked_at?: string;
}

const FRAME_GRADIENTS: Record<string, string> = {
  frame_bronze: 'from-amber-700 via-amber-500 to-amber-700',
  frame_silver: 'from-gray-400 via-white to-gray-400',
  frame_gold: 'from-yellow-500 via-yellow-300 to-yellow-500',
  frame_champion: 'from-purple-500 via-pink-400 to-purple-500',
};

interface GameHistory {
  game_id: string;
  era_id: string;
  player_color: string;
  final_rank: number | null;
  xp_earned: number;
  mmr_change: number;
  created_at: string;
  status: string;
  game_type?: string;
}

interface StatsBucket {
  played: number;
  won: number;
  win_rate: number;
}

interface UserStats {
  overall: StatsBucket;
  solo: StatsBucket;
  multi: StatsBucket;
  hybrid: StatsBucket;
  by_era: Record<string, { played: number; won: number }>;
  streaks: { current_win: number; best_win: number };
  favorite_era: string | null;
}

const ERA_LABELS: Record<string, string> = {
  ancient: 'Ancient World',
  medieval: 'Medieval Era',
  discovery: 'Age of Discovery',
  ww2: 'World War II',
  coldwar: 'Cold War',
  modern: 'Modern Day',
  acw: 'American Civil War',
  risorgimento: 'Italian Unification',
  space_age: 'Space Age',
  custom: 'Community map',
};

const CATEGORY_TABS = [
  { key: 'solo', label: 'Solo', icon: Bot },
  { key: 'multi', label: 'Multiplayer', icon: Users },
  { key: 'hybrid', label: 'Hybrid', icon: Zap },
] as const;

function NotificationPreferences() {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users/me/preferences')
      .then((res) => {
        setPushEnabled(res.data.push_enabled);
        setEmailEnabled(res.data.email_notifications);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (field: string, value: boolean) => {
    api.put('/users/me/preferences', { [field]: value }).catch(() => {
      toast.error('Failed to save preference');
    });
  };

  if (loading) return null;

  return (
    <div className="card">
      <h3 className="font-display text-lg text-bf-gold flex items-center gap-2 mb-3">
        <Bell className="w-5 h-5" /> Notification Settings
      </h3>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-bf-muted" />
            <div>
              <span className="text-sm text-bf-text">Push Notifications</span>
              <p className="text-xs text-bf-muted">Get notified when it's your turn in async games</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={pushEnabled}
            onChange={(e) => {
              setPushEnabled(e.target.checked);
              update('push_enabled', e.target.checked);
            }}
            className="w-5 h-5 accent-bf-gold"
          />
        </label>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-bf-muted" />
            <div>
              <span className="text-sm text-bf-text">Email Notifications</span>
              <p className="text-xs text-bf-muted">Receive an email when it's your turn in async games</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => {
              setEmailEnabled(e.target.checked);
              update('email_notifications', e.target.checked);
            }}
            className="w-5 h-5 accent-bf-gold"
          />
        </label>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { userId } = useParams<{ userId?: string }>();
  const { user: currentUser, logout } = useAuthStore();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<GameHistory[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'solo' | 'multi' | 'hybrid'>('solo');
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [allAchievements, setAllAchievements] = useState<Achievement[]>([]);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [tutorialLaunching, setTutorialLaunching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [achievementProgress, setAchievementProgress] = useState<Record<string, { current: number; target: number }>>({});

  const targetId = userId ?? currentUser?.user_id;
  const isOwnProfile = !userId || userId === currentUser?.user_id;

  useEffect(() => {
    if (!targetId) return;
    setLoadError(null);
    Promise.all([
      isOwnProfile ? api.get('/users/me') : api.get(`/users/${targetId}`),
      isOwnProfile ? api.get('/users/me/games') : Promise.resolve({ data: [] }),
      isOwnProfile ? api.get('/users/me/stats') : Promise.resolve({ data: null }),
      isOwnProfile ? api.get('/users/me/achievements') : Promise.resolve({ data: [] }),
      api.get('/users/achievements').catch(() => ({ data: [] })),
      isOwnProfile ? api.get('/users/me/achievements/progress').catch(() => ({ data: {} })) : Promise.resolve({ data: {} }),
    ]).then(([profileRes, gamesRes, statsRes, achRes, allAchRes, progressRes]) => {
      setProfile(profileRes.data);
      setGames(gamesRes.data);
      if (statsRes.data) setStats(statsRes.data);
      setAchievements(achRes.data);
      setAllAchievements(allAchRes.data);
      setAchievementProgress(progressRes.data ?? {});
    }).catch((err: unknown) => {
      const msg = axios.isAxiosError(err) ? (err.response?.data as { error?: string })?.error ?? err.message : 'Failed to load profile';
      setLoadError(msg);
      toast.error(typeof msg === 'string' ? msg : 'Failed to load profile');
    }).finally(() => setLoading(false));
  }, [targetId, isOwnProfile]);

  const handleStartTutorial = async () => {
    setTutorialLaunching(true);
    try {
      const res = await api.post<{ game_id: string }>('/games/tutorial/start', { era: 'ww2' });
      navigate(`/game/${res.data.game_id}`);
    } catch {
      toast.error('Failed to start tutorial');
      setTutorialLaunching(false);
    }
  };

  if (loading) {
    return (
      <SubpageShell
        title="PROFILE"
        maxWidth="4xl"
        headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
      >
        <p className="text-bf-muted text-center py-16">Loading profile…</p>
      </SubpageShell>
    );
  }

  if (!profile) {
    return (
      <SubpageShell
        title="PROFILE"
        maxWidth="4xl"
        headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
      >
        <div className="text-center py-16 space-y-4">
          <p className="text-bf-muted">{loadError ?? 'User not found.'}</p>
          {loadError && (
            <p className="text-bf-muted/70 text-sm max-w-md mx-auto">
              If the server was updated recently, apply pending database migrations so ratings and profile columns exist.
            </p>
          )}
          <Link to="/lobby" className="btn-secondary text-sm inline-block">Back to Lobby</Link>
        </div>
      </SubpageShell>
    );
  }

  const activeBucket: StatsBucket | null = stats
    ? (activeTab === 'solo' ? stats.solo : activeTab === 'multi' ? stats.multi : stats.hybrid)
    : null;

  return (
    <SubpageShell
      title="COMMANDER PROFILE"
      maxWidth="4xl"
      contentClassName="space-y-6"
      headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
    >
        {/* Profile Card */}
        <div className="card flex flex-col sm:flex-row items-center gap-6">
          <div className={`p-1 rounded-full shrink-0 ${
            profile.equipped_frame && FRAME_GRADIENTS[profile.equipped_frame]
              ? `bg-gradient-to-r ${FRAME_GRADIENTS[profile.equipped_frame]}`
              : ''
          }`}>
            <div className="w-20 h-20 rounded-full bg-bf-border flex items-center justify-center text-3xl">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.username} className="w-full h-full rounded-full object-cover" />
              ) : (
                profile.username[0].toUpperCase()
              )}
            </div>
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h2 className="font-display text-2xl text-bf-gold">{profile.username}</h2>
            <p className="text-bf-muted text-sm mt-1">
              Level {profile.level} · Member since {new Date(profile.created_at).getFullYear()}
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 mt-1">
              <span className="text-bf-muted text-xs flex items-center gap-1">
                <Bot className="w-3 h-3" /> Solo {profile.ratings?.solo?.display ?? '—'}
                {profile.ratings?.solo?.provisional && <span className="text-bf-gold/60">(P)</span>}
              </span>
              <span className="relative group text-bf-muted text-xs flex items-center gap-1 cursor-default">
                <Shield className="w-3 h-3" /> Ranked {profile.ratings?.ranked?.display ?? '—'}
                {profile.ratings?.ranked?.provisional && <span className="text-bf-gold/60">(P)</span>}
                {profile.ratings?.ranked && <TierBadge mu={profile.ratings.ranked.mu} className="ml-1" />}
                {profile.ratings?.ranked && (
                  <span className="pointer-events-none absolute bottom-full left-0 mb-2 hidden group-hover:flex
                                   flex-col gap-1 bg-bf-dark border border-bf-border rounded-lg p-3
                                   w-52 text-xs text-bf-muted shadow-xl z-20 whitespace-normal">
                    <span className="font-semibold text-bf-text">Rating Confidence (RD)</span>
                    <span>RD: {Math.round(profile.ratings.ranked.phi)}</span>
                    <span className="text-bf-muted/80 leading-relaxed">
                      {profile.ratings.ranked.phi > 150
                        ? 'Provisional — play more ranked games to settle your rating.'
                        : profile.ratings.ranked.phi > 80
                        ? 'Settling — a few more games will stabilise this.'
                        : 'Stable — high confidence in this rating.'}
                    </span>
                  </span>
                )}
              </span>
            </div>
            <div className="mt-3">
              <XpBar xp={profile.xp} />
              {isOwnProfile && !currentUser?.is_guest && profile.gold != null && (
                <p className="flex items-center gap-1 text-bf-gold text-xs mt-2">
                  <Coins className="w-3.5 h-3.5" />
                  {profile.gold.toLocaleString()} Gold
                </p>
              )}
            </div>
          </div>
        </div>

        {isOwnProfile && (
          <div className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-bf-gold/20">
            <div>
              <h3 className="font-display text-lg text-bf-gold flex items-center gap-2">
                <GraduationCap className="w-5 h-5" /> Learn to Play
              </h3>
              <p className="text-bf-muted text-sm mt-1 max-w-xl">
                Launch a guided tutorial match, or open <strong className="text-bf-text">Rules</strong> for the in-app guide (combat, cards, victory conditions, advanced features). Developers and power users can also read <code className="text-xs">docs/PLAYER_GUIDE.md</code> in the repository for the longest-form FAQ and tables.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to="/how-to-play" className="btn-secondary flex items-center justify-center gap-2 py-2.5 px-4">
                📖 Rules
              </Link>
              <button
                type="button"
                onClick={handleStartTutorial}
                disabled={tutorialLaunching}
                className="btn-primary flex items-center justify-center gap-2 py-2.5 px-5 disabled:opacity-60"
              >
                <GraduationCap className="w-4 h-4" />
                {tutorialLaunching ? 'Starting…' : 'Tutorial'}
              </button>
            </div>
          </div>
        )}

        {/* Overall Stats Row */}
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Games Played', value: stats.overall.played, icon: Target },
              { label: 'Win Rate', value: stats.overall.played > 0 ? `${Math.round(stats.overall.win_rate * 100)}%` : '—', icon: Trophy },
              { label: 'Win Streak', value: stats.streaks.current_win, icon: Flame },
              { label: 'Best Streak', value: stats.streaks.best_win, icon: Sword },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="card text-center">
                <Icon className="w-5 h-5 text-bf-gold mx-auto mb-2" />
                <p className="font-display text-2xl text-bf-gold">{value}</p>
                <p className="text-bf-muted text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Category Tabs */}
        {stats && (
          <div className="card">
            <div className="flex gap-1 mb-6 p-1 bg-bf-dark rounded-lg w-fit">
              {CATEGORY_TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all
                    ${activeTab === key
                      ? 'bg-bf-gold/15 text-bf-gold border border-bf-gold/30'
                      : 'text-bf-muted hover:text-bf-text border border-transparent'
                    }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            {activeBucket && (
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <p className="text-3xl font-display text-bf-text">{activeBucket.played}</p>
                  <p className="text-xs text-bf-muted mt-1">Games Played</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-display text-bf-text">{activeBucket.won}</p>
                  <p className="text-xs text-bf-muted mt-1">Victories</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-display text-bf-text">
                    {activeBucket.played > 0 ? `${Math.round(activeBucket.win_rate * 100)}%` : '—'}
                  </p>
                  <p className="text-xs text-bf-muted mt-1">Win Rate</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Era Breakdown */}
        {stats && Object.keys(stats.by_era).length > 0 && (
          <div className="card">
            <h3 className="font-display text-lg text-bf-gold mb-4 flex items-center gap-2">
              <Map className="w-5 h-5" /> Era Breakdown
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(stats.by_era).map(([era, data]) => {
                const rate = data.played > 0 ? Math.round((data.won / data.played) * 100) : 0;
                return (
                  <div key={era} className="p-3 bg-bf-dark rounded-lg border border-bf-border">
                    <p className="text-sm text-bf-text font-medium">{ERA_LABELS[era] ?? era}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-bf-muted">{data.played} games</span>
                      <span className="text-xs font-medium text-bf-gold">{rate}% win</span>
                    </div>
                    <div className="h-1.5 bg-bf-border rounded-full mt-2 overflow-hidden">
                      <div
                        className="h-full bg-bf-gold rounded-full transition-all duration-700"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {stats.favorite_era && (
              <p className="text-xs text-bf-muted mt-4 text-center">
                Favorite era: <span className="text-bf-gold">{ERA_LABELS[stats.favorite_era] ?? stats.favorite_era}</span>
              </p>
            )}
          </div>
        )}

        {/* Achievements */}
        {isOwnProfile && allAchievements.length > 0 && (
          <div className="card">
            <h3 className="font-display text-lg text-bf-gold mb-4 flex items-center gap-2">
              <Award className="w-5 h-5" /> Achievements
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {allAchievements.map((a) => {
                const unlocked = achievements.find((u) => u.achievement_id === a.achievement_id);
                const prog = !unlocked ? achievementProgress[a.achievement_id] : undefined;
                return (
                  <div
                    key={a.achievement_id}
                    className={`p-3 rounded-lg border ${
                      unlocked
                        ? 'bg-bf-gold/5 border-bf-gold/20'
                        : 'bg-bf-dark border-bf-border opacity-60'
                    }`}
                  >
                    <p className={`text-sm font-medium ${unlocked ? 'text-bf-gold' : 'text-bf-muted'}`}>
                      {unlocked ? a.name : '???'}
                    </p>
                    <p className="text-xs text-bf-muted mt-1 leading-relaxed">{a.description}</p>
                    {unlocked?.unlocked_at && (
                      <p className="text-[10px] text-bf-muted/60 mt-1">
                        {formatDate(unlocked.unlocked_at)}
                      </p>
                    )}
                    {prog && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] text-bf-muted mb-1">
                          <span>Progress</span>
                          <span>{Math.min(prog.current, prog.target)} / {prog.target}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-bf-dark/80 overflow-hidden border border-bf-border">
                          <div
                            className="h-full rounded-full bg-bf-gold transition-all"
                            style={{ width: `${Math.min(100, (prog.current / prog.target) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-bf-gold/50 mt-1">+{a.xp_reward} XP</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Fallback simple stats if no stats endpoint data */}
        {!stats && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'MMR Rating', value: profile.mmr, icon: Trophy },
              { label: 'Level', value: profile.level, icon: Sword },
              { label: 'Total XP', value: profile.xp.toLocaleString(), icon: Map },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="card text-center">
                <Icon className="w-6 h-6 text-bf-gold mx-auto mb-2" />
                <p className="font-display text-2xl text-bf-gold">{value}</p>
                <p className="text-bf-muted text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Campaign Card */}
        {isOwnProfile && (
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg text-bf-gold flex items-center gap-2 mb-1">
                  <Trophy className="w-5 h-5" /> Era Campaign
                </h3>
                <p className="text-bf-muted text-sm">Journey through history — conquer all 6 eras.</p>
              </div>
              <Link
                to="/campaign"
                className="px-4 py-2 bg-bf-gold/15 border border-bf-gold/30 text-bf-gold rounded-lg text-sm font-medium hover:bg-bf-gold/25 transition-colors"
              >
                View Campaign →
              </Link>
            </div>
          </div>
        )}

        {/* Notification Settings */}
        {isOwnProfile && !currentUser?.is_guest && (
          <NotificationPreferences />
        )}

        {/* Game History */}
        {isOwnProfile && (
          <div className="card border-red-500/20">
            <h3 className="font-display text-lg text-red-400/90 mb-2">Delete account</h3>
            <p className="text-bf-muted text-sm mb-4">
              Permanently remove your account and sign out. Run database migration <code className="text-xs bg-bf-dark px-1 rounded">003_user_delete_fk.sql</code> if deletion fails due to foreign keys.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
              <div className="flex-1">
                <label className="label">Confirm with password</label>
                <input
                  type="password"
                  className="input"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Your password"
                />
              </div>
              <button
                type="button"
                disabled={deleteBusy || !deletePassword}
                className="btn-danger shrink-0"
                onClick={async () => {
                  setDeleteBusy(true);
                  try {
                    await api.delete('/users/me', { data: { password: deletePassword } });
                    toast.success('Account deleted');
                    setDeletePassword('');
                    await logout();
                    navigate('/');
                  } catch (err: unknown) {
                    if (axios.isAxiosError(err)) {
                      toast.error(err.response?.data?.error || 'Could not delete account');
                    } else {
                      toast.error('Could not delete account');
                    }
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </div>
        )}

        {isOwnProfile && (
          <div className="card">
            <h3 className="font-display text-xl text-bf-gold mb-4">Recent Games</h3>
            {games.length === 0 ? (
              <p className="text-bf-muted text-center py-6">No games played yet. Start your conquest!</p>
            ) : (
              <div className="space-y-2">
                {games.map((game) => {
                  const isWin = game.final_rank === 1;
                  return (
                    <div key={game.game_id} className="flex items-center justify-between p-3 bg-bf-dark rounded-lg border border-bf-border">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: game.player_color }} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-bf-text">{ERA_LABELS[game.era_id] ?? game.era_id}</p>
                            {game.final_rank != null && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                isWin ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                              }`}>
                                {isWin ? 'Victory' : `Rank #${game.final_rank}`}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-bf-muted">{formatDate(game.created_at)}</p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-4">
                        {game.xp_earned > 0 && (
                          <span className="text-xs text-bf-gold">+{game.xp_earned} XP</span>
                        )}
                        <p className={`text-xs font-medium ${game.mmr_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {game.mmr_change >= 0 ? '+' : ''}{game.mmr_change} MMR
                        </p>
                        {game.status === 'completed' && (
                          <Link
                            to={`/replay/${game.game_id}`}
                            className="flex items-center gap-1 text-xs text-bf-muted hover:text-bf-gold transition-colors"
                            title="Watch replay"
                          >
                            <Play className="w-3 h-3" /> Replay
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Referral Panel (own profile only) */}
        {isOwnProfile && !currentUser?.is_guest && <ReferralPanel className="mt-6" />}
    </SubpageShell>
  );
}
