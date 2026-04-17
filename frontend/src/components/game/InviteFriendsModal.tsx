import React, { useEffect, useState } from 'react';
import { X, Copy, UserPlus } from 'lucide-react';
import { api } from '../../services/api';
import toast from 'react-hot-toast';

interface Friend {
  user_id: string;
  username: string;
}

interface InviteFriendsModalProps {
  gameId: string;
  joinCode: string | null;
  onClose: () => void;
}

export default function InviteFriendsModal({ gameId, joinCode, onClose }: InviteFriendsModalProps) {
  const [friends, setFriends] = useState<Friend[]>([]);

  useEffect(() => {
    api
      .get<Friend[]>('/users/me/friends')
      .then((res) => setFriends(res.data))
      .catch(() => toast.error('Could not load friends'));
  }, []);

  const inviteUrl = `${window.location.origin}/game/${gameId}`;

  const copyLink = () => {
    void navigator.clipboard.writeText(inviteUrl);
    toast.success('Game link copied');
  };

  const copyCode = () => {
    if (!joinCode) return;
    void navigator.clipboard.writeText(joinCode);
    toast.success('Join code copied');
  };

  const copyLobbyLink = () => {
    const u = new URL('/lobby', window.location.origin);
    u.searchParams.set('join', joinCode ?? gameId);
    void navigator.clipboard.writeText(u.toString());
    toast.success('Lobby join link copied');
  };

  const notifyFriend = async (friendId: string) => {
    try {
      await api.post(`/games/${gameId}/invite`, { friend_user_id: friendId });
      toast.success('Invite sent');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      toast.error(msg ?? 'Invite failed');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/60 px-3 py-4 pt-safe pb-safe sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-friends-title"
    >
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div className="card max-w-md w-full max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] overflow-y-auto overscroll-contain border border-cc-gold/20 relative p-4 sm:p-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 text-cc-muted hover:text-cc-text p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <h3 id="invite-friends-title" className="font-display text-xl text-cc-gold mb-2 pr-8 flex items-center gap-2">
            <UserPlus className="w-6 h-6" /> Invite friends
          </h3>
          <p className="text-cc-muted text-sm mb-4">
            Copy a link or code, or notify an online friend (they will see a prompt if connected).
          </p>

          <div className="flex flex-wrap gap-2 mb-6">
            <button type="button" onClick={copyLink} className="btn-primary text-sm flex items-center gap-1 w-full sm:w-auto justify-center">
              <Copy className="w-4 h-4" /> Copy game link
            </button>
            {joinCode && (
              <button type="button" onClick={copyCode} className="btn-secondary text-sm flex items-center gap-1 w-full sm:w-auto justify-center">
                <Copy className="w-4 h-4" /> Code {joinCode}
              </button>
            )}
            <button type="button" onClick={copyLobbyLink} className="btn-secondary text-sm flex items-center gap-1 w-full sm:w-auto justify-center">
              <Copy className="w-4 h-4" /> Copy lobby join link
            </button>
          </div>

          <h4 className="text-sm font-medium text-cc-text mb-2">Notify a friend</h4>
          {friends.length === 0 ? (
            <p className="text-cc-muted text-sm mb-2">Add friends from the Friends page first.</p>
          ) : (
            <ul className="space-y-2">
              {friends.map((f) => (
                <li
                  key={f.user_id}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-cc-dark border border-cc-border"
                >
                  <span className="text-cc-text text-sm">{f.username}</span>
                  <button
                    type="button"
                    className="btn-secondary text-xs py-1 px-2"
                    onClick={() => void notifyFriend(f.user_id)}
                  >
                    Send invite
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
