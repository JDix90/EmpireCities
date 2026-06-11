import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { UserPlus, Users, UserMinus, Check, X } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';

interface Friend {
  user_id: string;
  username: string;
  level: number;
  mmr: number;
  avatar_url?: string | null;
  created_at?: string;
  friend_streak?: number;
  last_game_together?: string | null;
}

function getStreakRiskLabel(lastPlayedAt?: string | null): string | null {
  if (!lastPlayedAt) return null;
  const diffHours = (Date.now() - new Date(lastPlayedAt).getTime()) / (1000 * 60 * 60);
  if (diffHours >= 72) return 'Expired';
  if (diffHours >= 48) return 'At risk';
  return null;
}

interface PendingRow {
  id: string;
  initiated_by: string | null;
  created_at: string;
  other_user_id: string;
  other_username: string;
  direction: 'incoming' | 'outgoing';
}

export default function FriendsPage() {
  const { user } = useAuthStore();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (user?.is_guest) {
      setLoading(false);
      return;
    }
    try {
      const [fr, pe] = await Promise.all([
        api.get<Friend[]>('/users/me/friends'),
        api.get<PendingRow[]>('/users/me/friends/pending'),
      ]);
      setFriends(fr.data);
      setPending(pe.data);
    } catch {
      toast.error('Could not load friends');
    } finally {
      setLoading(false);
    }
  }, [user?.is_guest]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u) return;
    try {
      await api.post('/users/me/friends/request', { username: u });
      toast.success('Friend request sent');
      setUsername('');
      void load();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error ?? 'Request failed');
      }
    }
  };

  const accept = async (otherUserId: string) => {
    try {
      await api.post('/users/me/friends/accept', { other_user_id: otherUserId });
      toast.success('Friend added');
      void load();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error ?? 'Failed');
      }
    }
  };

  const decline = async (otherUserId: string) => {
    try {
      await api.post('/users/me/friends/decline', { other_user_id: otherUserId });
      void load();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error ?? 'Failed');
      }
    }
  };

  const unfriend = async (otherUserId: string) => {
    try {
      await api.delete(`/users/me/friends/${otherUserId}`);
      toast.success('Removed from friends');
      void load();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error ?? 'Failed');
      }
    }
  };

  const incomingRequests = pending.filter((p) => p.direction === 'incoming');
  const outgoingRequests = pending.filter((p) => p.direction === 'outgoing');

  if (user?.is_guest) {
    return (
      <SubpageShell title="FRIENDS" icon={Users} maxWidth="lg">
        <div className="text-center py-12 space-y-4">
          <p className="text-bf-muted">Create a free account to use friends — your progress carries over.</p>
          <Link to="/upgrade" className="btn-primary">Create Account</Link>
        </div>
      </SubpageShell>
    );
  }

  return (
    <SubpageShell title="FRIENDS" icon={Users} maxWidth="lg" contentClassName="space-y-8">
        <form onSubmit={sendRequest} className="card space-y-3">
          <h2 className="font-display text-bf-gold flex items-center gap-2">
            <UserPlus className="w-5 h-5" /> Add friend
          </h2>
          <p className="text-bf-muted text-sm">Send a request by exact username.</p>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
            />
            <button type="submit" className="btn-primary">Send</button>
          </div>
        </form>

        {loading ? (
          <p className="text-bf-muted text-center">Loading…</p>
        ) : (
          <>
            {incomingRequests.length > 0 && (
              <div className="card space-y-3">
                <h2 className="font-display text-bf-gold text-lg">Incoming requests ({incomingRequests.length})</h2>
                <ul className="space-y-2">
                  {incomingRequests.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 p-3 bg-bf-dark rounded-lg border border-bf-border"
                    >
                      <span className="text-bf-text">{p.other_username}</span>
                      <span className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          className="btn-primary text-xs py-1 px-2 flex items-center gap-1"
                          onClick={() => void accept(p.other_user_id)}
                        >
                          <Check className="w-3 h-3" /> Accept
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                          onClick={() => void decline(p.other_user_id)}
                        >
                          <X className="w-3 h-3" /> Decline
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {outgoingRequests.length > 0 && (
              <div className="card space-y-3">
                <h2 className="font-display text-bf-gold text-lg">Sent requests ({outgoingRequests.length})</h2>
                <ul className="space-y-2">
                  {outgoingRequests.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 p-3 bg-bf-dark rounded-lg border border-bf-border"
                    >
                      <span className="text-bf-text">{p.other_username}</span>
                      <span className="text-bf-muted text-xs shrink-0">Waiting…</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card space-y-3">
              <h2 className="font-display text-bf-gold text-lg">Your friends ({friends.length})</h2>
              {friends.length === 0 ? (
                <p className="text-bf-muted text-sm">No friends yet. Add someone above.</p>
              ) : (
                <ul className="space-y-2">
                  {friends.map((f) => (
                    <li
                      key={f.user_id}
                      className="flex items-center justify-between gap-2 p-3 bg-bf-dark rounded-lg border border-bf-border"
                    >
                      <div className="min-w-0 flex-1">
                        <Link to={`/profile/${f.user_id}`} className="text-bf-text hover:text-bf-gold block truncate font-medium">
                          {f.username}
                        </Link>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-bf-muted">
                          {(f.friend_streak ?? 0) > 0 && <span className="text-orange-400">🔥 {f.friend_streak}</span>}
                          {getStreakRiskLabel(f.last_game_together) && (
                            <span className="text-amber-300">{getStreakRiskLabel(f.last_game_together)}</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-bf-muted hover:text-red-400 p-1"
                        title="Remove friend"
                        onClick={() => void unfriend(f.user_id)}
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
    </SubpageShell>
  );
}
