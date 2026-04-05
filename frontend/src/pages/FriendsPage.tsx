import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { UserPlus, Users, ArrowLeft, UserMinus, Check, X } from 'lucide-react';

interface Friend {
  user_id: string;
  username: string;
  level: number;
  mmr: number;
  avatar_url?: string | null;
  created_at?: string;
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

  if (user?.is_guest) {
    return (
      <div className="min-h-screen bg-cc-dark flex flex-col items-center justify-center px-4">
        <p className="text-cc-muted text-center mb-6">Register an account to use friends.</p>
        <Link to="/lobby" className="btn-primary">Back to Lobby</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cc-dark">
      <nav className="border-b border-cc-border px-4 py-4 flex items-center gap-4">
        <Link to="/lobby" className="text-cc-muted hover:text-cc-gold flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> Lobby
        </Link>
        <h1 className="font-display text-xl text-cc-gold flex items-center gap-2">
          <Users className="w-6 h-6" /> Friends
        </h1>
      </nav>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
        <form onSubmit={sendRequest} className="card space-y-3">
          <h2 className="font-display text-cc-gold flex items-center gap-2">
            <UserPlus className="w-5 h-5" /> Add friend
          </h2>
          <p className="text-cc-muted text-sm">Send a request by exact username.</p>
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
          <p className="text-cc-muted text-center">Loading…</p>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="card space-y-3">
                <h2 className="font-display text-cc-gold text-lg">Pending</h2>
                <ul className="space-y-2">
                  {pending.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 p-3 bg-cc-dark rounded-lg border border-cc-border"
                    >
                      <span className="text-cc-text">{p.other_username}</span>
                      {p.direction === 'incoming' ? (
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
                      ) : (
                        <span className="text-cc-muted text-xs">Waiting…</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card space-y-3">
              <h2 className="font-display text-cc-gold text-lg">Your friends ({friends.length})</h2>
              {friends.length === 0 ? (
                <p className="text-cc-muted text-sm">No friends yet. Add someone above.</p>
              ) : (
                <ul className="space-y-2">
                  {friends.map((f) => (
                    <li
                      key={f.user_id}
                      className="flex items-center justify-between gap-2 p-3 bg-cc-dark rounded-lg border border-cc-border"
                    >
                      <Link to={`/profile/${f.user_id}`} className="text-cc-text hover:text-cc-gold">
                        {f.username}
                      </Link>
                      <button
                        type="button"
                        className="text-cc-muted hover:text-red-400 p-1"
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
      </div>
    </div>
  );
}
