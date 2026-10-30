import React, { useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useLocation } from 'react-router-dom';
import Modal from '../ui/Modal';
import { api } from '../../services/api';
import { deviceClass } from '../../utils/device';
import { CommentBox, feedbackErrorMessage, screenSize } from './feedbackParts';

export type FeedbackCategory = 'bug' | 'idea' | 'other';

const CATEGORIES: Array<{ id: FeedbackCategory; label: string; placeholder: string }> = [
  { id: 'bug', label: 'Something’s broken', placeholder: 'What happened, and what did you expect to happen?' },
  { id: 'idea', label: 'An idea', placeholder: 'What would make the game better for you?' },
  { id: 'other', label: 'Something else', placeholder: 'Tell us anything: what you like, what’s confusing, what’s missing.' },
];

const DEFAULT_PLACEHOLDER = 'Tell us anything: what you like, what’s confusing, what’s broken, what’s missing.';

/**
 * Feedback about anything, from the lobby's menu (`feedback_menu_enabled`):
 * the desktop top bar's Feedback entry and the phone's More sheet. A note,
 * and optionally what it is about; it goes to Admin → Feedback with the page
 * it came from and the device class and screen size, which the form says.
 */
export default function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = !sending && comment.trim().length > 0;

  const close = () => {
    if (sending) return;
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    try {
      await api.post('/feedback', {
        topic: 'general',
        source: 'menu',
        ...(category ? { category } : {}),
        comment: comment.trim(),
        page: pathname.slice(0, 64),
        device: deviceClass(),
        viewport: screenSize(),
      });
      toast.success('Thanks — we read every note.');
      setCategory(null);
      setComment('');
      onClose();
    } catch (err) {
      toast.error(feedbackErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const placeholder = CATEGORIES.find((c) => c.id === category)?.placeholder ?? DEFAULT_PLACEHOLDER;

  return (
    <Modal open={open} onClose={close} title="Send feedback">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className="text-sm text-bf-text mb-2">
            What’s it about? <span className="text-bf-muted">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory((cur) => (cur === c.id ? null : c.id))}
                disabled={sending}
                aria-pressed={category === c.id}
                className={clsx(
                  'tap-target rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-60',
                  category === c.id
                    ? 'border-bf-gold bg-bf-gold/15 text-bf-gold'
                    : 'border-bf-border text-bf-muted hover:border-bf-muted hover:text-bf-text',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="menu-feedback-comment" className="block text-sm text-bf-text mb-2">
            Your note
          </label>
          <CommentBox id="menu-feedback-comment" value={comment} onChange={setComment} placeholder={placeholder} />
        </div>
        <p className="text-xs text-bf-muted">
          Sent with the page you’re on and your screen size ({screenSize().replace('x', '×')}), so we can see what you saw.
        </p>
        <button type="submit" disabled={!canSend} className="btn-primary w-full disabled:opacity-50">
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </form>
    </Modal>
  );
}
