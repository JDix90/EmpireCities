import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import { ArrowLeft, Trophy, Sword, Map } from 'lucide-react';

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
}

export default function ProfilePage() {
  const { userId } = useParams<{ userId?: string }>();
  const { user: currentUser } = useAuthStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<GameHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const targetId = userId ?? currentUser?.user_id;
  const isOwnProfile = !userId || userId === currentUser?.user_id;

  useEffect(() => {
    if (!targetId) return;
    Promise.all([
      isOwnProfile ? api.get('/users/me') : api.get(`/users/${targetId}`),
      isOwnProfile ? api.get('/users/me/games') : Promise.resolve({ data: [] }),
    ]).then(([profileRes, gamesRes]) => {
      setProfile(profileRes.data);
      setGames(gamesRes.data);
    }).finally(() => setLoading(false));
  }, [targetId]);

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

  return (
    <div className="min-h-screen bg-cc-dark">
      <nav className="border-b border-cc-border px-6 py-4 flex items-center gap-4">
        <Link to="/lobby" className="text-cc-muted hover:text-cc-text transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-xl text-cc-gold">Commander Profile</h1>
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

        {/* Stats */}
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

        {/* Game History */}
        {isOwnProfile && (
          <div className="card">
            <h3 className="font-display text-xl text-cc-gold mb-4">Recent Games</h3>
            {games.length === 0 ? (
              <p className="text-cc-muted text-center py-6">No games played yet. Start your conquest!</p>
            ) : (
              <div className="space-y-2">
                {games.map((game) => (
                  <div key={game.game_id} className="flex items-center justify-between p-3 bg-cc-dark rounded-lg border border-cc-border">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: game.player_color }} />
                      <div>
                        <p className="text-sm text-cc-text capitalize">{game.era_id.replace('ww2', 'WWII').replace('coldwar', 'Cold War').replace('modern', 'Modern Day')}</p>
                        <p className="text-xs text-cc-muted">{new Date(game.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-cc-text">Rank #{game.final_rank ?? '?'}</p>
                      <p className={`text-xs ${game.mmr_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {game.mmr_change >= 0 ? '+' : ''}{game.mmr_change} MMR
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
