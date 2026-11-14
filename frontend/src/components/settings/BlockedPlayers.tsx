import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { listBlockedPlayers, unblockPlayer, type BlockedPlayer } from '../../services/chatSafety';

/**
 * Settings → Blocked players (`chat_safety_enabled`): everyone this player
 * has blocked from the chat's menu, and a way to undo it. Guests included.
 */
export default function BlockedPlayers() {
  const [blocked, setBlocked] = useState<BlockedPlayer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listBlockedPlayers()
      .then((list) => { if (live) setBlocked(list); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const unblock = async (p: BlockedPlayer) => {
    setBusy(p.user_id);
    try {
      await unblockPlayer(p.user_id);
      setBlocked((list) => (list ?? []).filter((b) => b.user_id !== p.user_id));
      toast.success(`Unblocked ${p.username}.`);
    } catch {
      toast.error('Could not unblock them. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  };

  if (failed) return <p className="text-bf-muted text-sm py-2">Your blocked players could not be loaded.</p>;
  if (!blocked) return <p className="text-bf-muted text-sm py-2">Loading…</p>;
  if (blocked.length === 0) {
    return (
      <p className="text-bf-muted text-sm py-2" data-testid="blocked-players-empty">
        You haven’t blocked anyone. To block a player, tap ⋯ beside one of their chat messages.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-bf-border/60" data-testid="blocked-players">
      {blocked.map((p) => (
        <li key={p.user_id} className="flex items-center justify-between gap-3 py-2">
          <span className="text-sm text-bf-text truncate">{p.username}</span>
          <button
            type="button"
            onClick={() => void unblock(p)}
            disabled={busy === p.user_id}
            className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
          >
            Unblock
          </button>
        </li>
      ))}
    </ul>
  );
}
