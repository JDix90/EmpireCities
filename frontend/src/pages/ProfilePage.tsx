import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Trophy, Sword, Map, Flame, Target, Users, Bot, Zap } from 'lucide-react';

interface UserProfile {
  user_id: string;
  username: string;
  level: number;
  xp: number;
  mmr: number;
  avatar_url?: string;
  created_at: string;
}

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
};

const CATEGORY_TABS = [
  { key: 'solo', label: 'Solo', icon: Bot },
  { key: 'multi', label: 'Multiplayer', icon: Users },
  { key: 'hybrid', label: 'Hybrid', icon: Zap },
] as const;

export default function ProfilePage() {
  const { userId } = useParams<{ userId?: string }>();
  const { user: currentUser, logout } = useAuthStore();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<GameHistory[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'solo' | 'multi' | 'hybrid'>('solo');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const targetId = userId ?? currentUser?.user_id;
  const isOwnProfile = !userId || userId === currentUser?.user_id;

  useEffect(() => {
    if (!targetId) return;
    Promise.all([
      isOwnProfile ? api.get('/users/me') : api.get(`/users/${targetId}`),
      isOwnProfile ? api.get('/users/me/games') : Promise.resolve({ data: [] }),
      isOwnProfile ? api.get('/users/me/stats') : Promise.resolve({ data: null }),
    ]).then(([profileRes, gamesRes, statsRes]) => {
      setProfile(profileRes.data);
      setGames(gamesRes.data);
      if (statsRes.data) setStats(statsRes.data);
    }).finally(() => setLoading(false));
  }, [targetId, isOwnProfile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cc-dark flex items-center justify-center">
        <p className="text-cc-muted">Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-cc-dark flex items-center justify-center">
        <p className="text-cc-muted">User not found.</p>
      </div>
    );
  }

  const xpForNextLevel = profile.level * 500;
  const xpProgress = Math.min(100, (profile.xp / xpForNextLevel) * 100);
  const activeBucket: StatsBucket | null = stats
    ? (activeTab === 'solo' ? stats.solo : activeTab === 'multi' ? stats.multi : stats.hybrid)
    : null;

  return (
    <div className="min-h-screen bg-cc-dark">
      <nav className="border-b border-cc-border px-6 py-4 flex items-center gap-4 pt-safe px-safe">
        <Link to="/lobby" className="font-display text-xl text-cc-gold tracking-widest hover:text-white transition-colors">
          CHRONOCONQUEST
        </Link>
        <span className="text-cc-border">|</span>
        <h1 className="font-display text-lg text-cc-muted">Commander Profile</h1>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Profile Card */}
        <div className="card flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-cc-border flex items-center justify-center text-3xl shrink-0">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.username} className="w-full h-full rounded-full object-cover" />
            ) : (
              profile.username[0].toUpperCase()
            )}
          </div>
          <div className="flex-1">
            <h2 className="font-display text-2xl text-cc-gold">{profile.username}</h2>
            <p className="text-cc-muted text-sm mt-1">
              Level {profile.level} · MMR {profile.mmr} · Member since {new Date(profile.created_at).getFullYear()}
            </p>
            <div className="mt-3">
              <div className="flex justify-between text-xs text-cc-muted mb-1">
                <span>XP Progress</span>
                <span>{profile.xp} / {xpForNextLevel}</span>
              </div>
              <div className="h-2 bg-cc-dark rounded-full overflow-hidden">
                <div
                  className="h-full bg-cc-gold rounded-full transition-all duration-500"
                  style={{ width: `${xpProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

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
                <Icon className="w-5 h-5 text-cc-gold mx-auto mb-2" />
                <p className="font-display text-2xl text-cc-gold">{value}</p>
                <p className="text-cc-muted text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Category Tabs */}
        {stats && (
          <div className="card">
            <div className="flex gap-1 mb-6 p-1 bg-cc-dark rounded-lg w-fit">
              {CATEGORY_TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all
                    ${activeTab === key
                      ? 'bg-cc-gold/15 text-cc-gold border border-cc-gold/30'
                      : 'text-cc-muted hover:text-cc-text border border-transparent'
                    }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            {activeBucket && (
              <div className="grid grid-cols-3 gap-6">
                <div className="text-center">
                  <p className="text-3xl font-display text-cc-text">{activeBucket.played}</p>
                  <p className="text-xs text-cc-muted mt-1">Games Played</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-display text-cc-text">{activeBucket.won}</p>
                  <p className="text-xs text-cc-muted mt-1">Victories</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-display text-cc-text">
                    {activeBucket.played > 0 ? `${Math.round(activeBucket.win_rate * 100)}%` : '—'}
                  </p>
                  <p className="text-xs text-cc-muted mt-1">Win Rate</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Era Breakdown */}
        {stats && Object.keys(stats.by_era).length > 0 && (
          <div className="card">
            <h3 className="font-display text-lg text-cc-gold mb-4 flex items-center gap-2">
              <Map className="w-5 h-5" /> Era Breakdown
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(stats.by_era).map(([era, data]) => {
                const rate = data.played > 0 ? Math.round((data.won / data.played) * 100) : 0;
                return (
                  <div key={era} className="p-3 bg-cc-dark rounded-lg border border-cc-border">
                    <p className="text-sm text-cc-text font-medium">{ERA_LABELS[era] ?? era}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-cc-muted">{data.played} games</span>
                      <span className="text-xs font-medium text-cc-gold">{rate}% win</span>
                    </div>
                    <div className="h-1.5 bg-cc-border rounded-full mt-2 overflow-hidden">
                      <div
                        className="h-full bg-cc-gold rounded-full transition-all duration-700"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {stats.favorite_era && (
              <p className="text-xs text-cc-muted mt-4 text-center">
                Favorite era: <span className="text-cc-gold">{ERA_LABELS[stats.favorite_era] ?? stats.favorite_era}</span>
              </p>
            )}
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
                <Icon className="w-6 h-6 text-cc-gold mx-auto mb-2" />
                <p className="font-display text-2xl text-cc-gold">{value}</p>
                <p className="text-cc-muted text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Game History */}
        {isOwnProfile && (
          <div className="card border-red-500/20">
            <h3 className="font-display text-lg text-red-400/90 mb-2">Delete account</h3>
            <p className="text-cc-muted text-sm mb-4">
              Permanently remove your account and sign out. Run database migration <code className="text-xs bg-cc-dark px-1 rounded">003_user_delete_fk.sql</code> if deletion fails due to foreign keys.
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
            <h3 className="font-display text-xl text-cc-gold mb-4">Recent Games</h3>
            {games.length === 0 ? (
              <p className="text-cc-muted text-center py-6">No games played yet. Start your conquest!</p>
            ) : (
              <div className="space-y-2">
                {games.map((game) => {
                  const isWin = game.final_rank === 1;
                  return (
                    <div key={game.game_id} className="flex items-center justify-between p-3 bg-cc-dark rounded-lg border border-cc-border">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: game.player_color }} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-cc-text">{ERA_LABELS[game.era_id] ?? game.era_id}</p>
                            {game.final_rank != null && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                isWin ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                              }`}>
                                {isWin ? 'Victory' : `Rank #${game.final_rank}`}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-cc-muted">{new Date(game.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-4">
                        {game.xp_earned > 0 && (
                          <span className="text-xs text-cc-gold">+{game.xp_earned} XP</span>
                        )}
                        <p className={`text-xs font-medium ${game.mmr_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {game.mmr_change >= 0 ? '+' : ''}{game.mmr_change} MMR
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
