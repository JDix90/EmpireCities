import React, { useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import Modal from '../ui/Modal';
import { api } from '../../services/api';
import { deviceClass } from '../../utils/device';

/** The longest comment the server takes (backend modules/feedback). */
export const FEEDBACK_COMMENT_MAX = 1000;

type Rating = 'up' | 'down';

interface FeedbackContext {
  gameId?: string | null;
  turn?: number | null;
}

/** The screen the feedback was sent from, so a layout report can be matched to it. */
function screenSize(): string {
  return `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`;
}

/**
 * POST /api/feedback with the context the player does not type: the game, the
 * turn, and the device class and screen size. Throws on failure.
 */
export async function sendGalacticFeedback(
  source: 'beta_panel' | 'game_over',
  answer: { rating?: Rating | null; comment?: string | null },
  context: FeedbackContext,
): Promise<void> {
  const comment = answer.comment?.trim();
  await api.post('/feedback', {
    topic: 'galactic_age',
    source,
    ...(answer.rating ? { rating: answer.rating } : {}),
    ...(comment ? { comment } : {}),
    ...(context.gameId ? { game_id: context.gameId } : {}),
    ...(typeof context.turn === 'number' ? { turn: context.turn } : {}),
    device: deviceClass(),
    viewport: screenSize(),
  });
}

function errorMessage(e: unknown): string {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 429) return 'That’s a lot of feedback at once. Try again in a few minutes.';
  return 'Couldn’t send that. Please try again.';
}

function Thumbs({ value, onChange, disabled }: { value: Rating | null; onChange: (r: Rating) => void; disabled?: boolean }) {
  const thumb = (rating: Rating, label: string, Icon: typeof ThumbsUp) => (
    <button
      type="button"
      onClick={() => onChange(rating)}
      disabled={disabled}
      aria-pressed={value === rating}
      aria-label={label}
      className={clsx(
        'tap-target flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-60',
        value === rating
          ? 'border-bf-gold bg-bf-gold/15 text-bf-gold'
          : 'border-bf-border text-bf-muted hover:border-bf-muted hover:text-bf-text',
      )}
    >
      <Icon className="w-4 h-4" aria-hidden />
    </button>
  );
  return (
    <div className="flex gap-2">
      {thumb('up', 'I like it', ThumbsUp)}
      {thumb('down', 'Not for me yet', ThumbsDown)}
    </div>
  );
}

function CommentBox({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id: string; placeholder: string }) {
  return (
    <div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={FEEDBACK_COMMENT_MAX}
        rows={4}
        placeholder={placeholder}
        className="input resize-y text-sm"
      />
      <p className="mt-1 text-right text-[11px] text-bf-muted" aria-live="polite">
        {value.length}/{FEEDBACK_COMMENT_MAX}
      </p>
    </div>
  );
}

/**
 * "Send feedback" from the BETA panel: a thumb, a note, or both. Says what is
 * sent with it, since the player did not type that part.
 */
export function GalacticFeedbackModal({ open, onClose, gameId, turn }: FeedbackContext & { open: boolean; onClose: () => void }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = !sending && (rating !== null || comment.trim().length > 0);

  const close = () => {
    if (sending) return;
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    try {
      await sendGalacticFeedback('beta_panel', { rating, comment }, { gameId, turn });
      toast.success('Thanks — we read every note.');
      setRating(null);
      setComment('');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Galactic Age feedback">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className="text-sm text-bf-text mb-2">How’s the Galactic Age so far?</p>
          <Thumbs value={rating} onChange={(r) => setRating((cur) => (cur === r ? null : r))} disabled={sending} />
        </div>
        <div>
          <label htmlFor="galactic-feedback-comment" className="block text-sm text-bf-text mb-2">
            Anything to tell us? <span className="text-bf-muted">(optional)</span>
          </label>
          <CommentBox
            id="galactic-feedback-comment"
            value={comment}
            onChange={setComment}
            placeholder="What worked, what didn’t, anything that got in your way…"
          />
        </div>
        <p className="text-xs text-bf-muted">
          Sent with {gameId ? `this game${typeof turn === 'number' ? `, turn ${turn},` : ''} and ` : ''}your screen size
          ({screenSize().replace('x', '×')}), so we can see what you saw.
        </p>
        <button type="submit" disabled={!canSend} className="btn-primary w-full disabled:opacity-50">
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </form>
    </Modal>
  );
}

/**
 * The game-over question for a Galactic Age beta game. One tap answers it:
 * the thumb is sent as soon as it is chosen, and a note, if the player adds
 * one, goes to the same answer. The thumb is fail-silent like the other
 * game-over measurement; a note says when it did not go through, since the
 * player typed it.
 */
export function GalacticGameOverFeedback({ gameId, turn, className }: { gameId: string; turn: number; className?: string }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const choose = (r: Rating) => {
    setRating(r);
    sendGalacticFeedback('game_over', { rating: r }, { gameId, turn }).catch(() => {});
  };

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() || sending) return;
    setSending(true);
    try {
      await sendGalacticFeedback('game_over', { rating, comment }, { gameId, turn });
      setDone(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={clsx('p-4 rounded-xl bg-white/[0.03] border border-bf-gold/30 text-left space-y-3', className)}
      data-testid="galactic-gameover-feedback"
    >
      {done ? (
        <p className="text-sm text-bf-muted">Thanks — we read every note.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-bf-text">
              How was the Galactic Age? <span className="text-bf-gold text-xs font-semibold tracking-wider ml-1">BETA</span>
            </p>
            <Thumbs value={rating} onChange={choose} />
          </div>
          {rating && (
            <form onSubmit={sendComment} className="space-y-2">
              <label htmlFor="galactic-gameover-comment" className="block text-xs text-bf-muted">
                Thanks! Anything to add? (optional)
              </label>
              <CommentBox
                id="galactic-gameover-comment"
                value={comment}
                onChange={setComment}
                placeholder={rating === 'up' ? 'What did you enjoy?' : 'What got in the way?'}
              />
              <button
                type="submit"
                disabled={!comment.trim() || sending}
                className="w-full py-2 rounded-lg bg-bf-gold/20 border border-bf-gold/30 text-bf-gold text-sm font-medium hover:bg-bf-gold/30 transition-colors disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
