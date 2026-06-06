import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Copy, Share2, Swords, Check } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import axios from 'axios';
import Modal from '../ui/Modal';
import { api } from '../../services/api';

interface ChallengeFriendModalProps {
  open: boolean;
  onClose: () => void;
}

const TIMER_OPTIONS: Array<{ value: number; label: string; sub: string }> = [
  { value: 86400, label: '24h turns', sub: 'Async — play across the day' },
  { value: 43200, label: '12h turns', sub: 'Async — a couple of turns a day' },
  { value: 259200, label: '3 day turns', sub: 'Async — relaxed, long game' },
  { value: 300, label: 'Real-time', sub: '5 min turns — play together now' },
];

const ANCIENT_MAP_ID = 'era_ancient';

/**
 * One-tap "Challenge a friend": creates a private game with one open human seat
 * (optionally plus AI bots), defaults to an async timer so both players don't
 * need to be online at once, and surfaces a shareable join link immediately.
 */
export default function ChallengeFriendModal({ open, onClose }: ChallengeFriendModalProps) {
  const navigate = useNavigate();
  const [aiCount, setAiCount] = useState(0);
  const [turnTimer, setTurnTimer] = useState(86400);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ gameId: string; joinCode: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = result ? `${window.location.origin}/join/${result.joinCode}` : '';

  const reset = () => {
    setResult(null);
    setCopied(false);
    setAiCount(0);
    setTurnTimer(86400);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const isAsync = turnTimer >= 43200;
      const res = await api.post<{ game_id: string; join_code: string | null }>('/games', {
        era_id: 'ancient',
        map_id: ANCIENT_MAP_ID,
        // 1 host + 1 open friend seat + any AI bots.
        max_players: Math.min(8, 2 + aiCount),
        ai_count: aiCount,
        ai_difficulty: 'medium',
        settings: {
          turn_timer_seconds: turnTimer,
          allowed_victory_conditions: ['domination'],
          initial_unit_count: 3,
          card_set_escalating: true,
          diplomacy_enabled: true,
          async_mode: isAsync || undefined,
          async_turn_deadline_seconds: isAsync ? turnTimer : undefined,
        },
      });
      if (!res.data.join_code) {
        toast.error('Game created, but no share code was returned. Open it from the lobby.');
        navigate(`/game/${res.data.game_id}`);
        return;
      }
      setResult({ gameId: res.data.game_id, joinCode: res.data.join_code });
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Could not create challenge');
      } else {
        toast.error('Could not create challenge');
      }
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Invite link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  const shareLink = async () => {
    const shareData = {
      title: 'Borderfall',
      text: "I challenge you to a game of Borderfall. Tap to join my match:",
      url: shareUrl,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* user cancelled or share unavailable — fall back to copy */
      }
    }
    await copyLink();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Challenge a friend">
      {!result ? (
        <div className="space-y-5">
          <p className="text-bf-muted text-sm">
            Creates a private match with one open seat for your friend. Async turns mean you don&apos;t both
            need to be online — they&apos;ll be notified when it&apos;s their move.
          </p>

          <div>
            <label className="label">Turn pace</label>
            <div className="grid grid-cols-2 gap-2">
              {TIMER_OPTIONS.map((opt) => {
                const active = turnTimer === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTurnTimer(opt.value)}
                    aria-pressed={active}
                    className={clsx(
                      'rounded-lg border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-bf-gold bg-bf-gold/10' : 'border-bf-border bg-bf-dark hover:border-bf-gold/40',
                    )}
                  >
                    <span className={clsx('block text-sm font-medium', active ? 'text-bf-gold' : 'text-bf-text')}>
                      {opt.label}
                    </span>
                    <span className="block text-[11px] leading-snug text-bf-muted mt-0.5">{opt.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Bot className="w-4 h-4" /> Add AI bots (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((n) => {
                const active = aiCount === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAiCount(n)}
                    aria-pressed={active}
                    className={clsx(
                      'min-w-[2.5rem] rounded-lg border px-3 py-2 text-sm transition-colors',
                      active ? 'border-bf-gold bg-bf-gold/10 text-bf-gold' : 'border-bf-border bg-bf-dark text-bf-text hover:border-bf-gold/40',
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-bf-muted mt-1">
              {aiCount === 0 ? 'A 1v1 duel.' : `You + your friend vs ${aiCount} AI opponent${aiCount === 1 ? '' : 's'}.`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Swords className="w-4 h-4" aria-hidden />
            {creating ? 'Creating…' : 'Create challenge & get link'}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-bf-muted text-sm">
            Your match is ready. Send this link to your friend — they&apos;ll join straight into your game
            (creating a free account if they&apos;re new).
          </p>

          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="input flex-1 font-mono text-sm"
              aria-label="Invite link"
            />
            <button
              type="button"
              onClick={() => void copyLink()}
              className="btn-secondary flex items-center gap-1.5 shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => void shareLink()}
            className="w-full btn-primary flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" aria-hidden /> Share invite
          </button>

          <button
            type="button"
            onClick={() => navigate(`/game/${result.gameId}`)}
            className="w-full text-center text-sm text-bf-gold hover:underline"
          >
            Go to the waiting lobby →
          </button>
        </div>
      )}
    </Modal>
  );
}
