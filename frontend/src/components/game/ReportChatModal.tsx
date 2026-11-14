import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import {
  CHAT_REPORT_REASONS,
  blockPlayer,
  reportChatMessage,
  type ChatMessageToReport,
  type ChatReportReason,
} from '../../services/chatSafety';

const GIF_REGEX = /^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/;

/**
 * Report a chat message (`chat_safety_enabled`): why, optionally more, and
 * whether to block the sender too (on by default: someone reporting a message
 * rarely wants more of them). The report goes to Admin → Reports with the
 * server's own copy of the message.
 */
export default function ReportChatModal({
  target,
  onClose,
  onBlocked,
}: {
  target: ChatMessageToReport | null;
  onClose: () => void;
  /** The sender was blocked as well: the chat drops their messages. */
  onBlocked: (playerId: string) => void;
}) {
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setReason(null);
    setDetails('');
    setAlsoBlock(true);
  }, [target?.messageId, target?.playerId]);

  if (!target) return null;
  const gif = target.message.match(GIF_REGEX);

  const close = () => {
    if (!sending) onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || sending) return;
    setSending(true);
    try {
      await reportChatMessage(target, reason, details);
      if (alsoBlock) {
        await blockPlayer(target.playerId);
        onBlocked(target.playerId);
      }
      toast.success(alsoBlock
        ? `Reported and blocked ${target.username}. Thanks — we review every report.`
        : 'Reported. Thanks — we review every report.');
      onClose();
    } catch {
      toast.error('That report did not go through. Try again in a moment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open onClose={close} title={`Report ${target.username}`}>
      <form onSubmit={submit} className="space-y-4" data-testid="report-chat-form">
        <div className="rounded-lg border border-bf-border bg-bf-dark/60 px-3 py-2 text-sm">
          <span className="text-bf-muted">{target.username}: </span>
          {gif ? <span className="text-bf-muted italic">a GIF</span> : <span className="text-bf-text break-words">{target.message}</span>}
        </div>
        <fieldset>
          <legend className="text-sm text-bf-text mb-2">What’s wrong with it?</legend>
          <div className="flex flex-wrap gap-2">
            {CHAT_REPORT_REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReason(r.id)}
                disabled={sending}
                aria-pressed={reason === r.id}
                className={clsx(
                  'tap-target rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-60',
                  reason === r.id
                    ? 'border-bf-gold bg-bf-gold/15 text-bf-gold'
                    : 'border-bf-border text-bf-muted hover:border-bf-muted hover:text-bf-text',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="report-chat-details" className="block text-sm text-bf-text mb-2">
            Anything else? <span className="text-bf-muted">(optional)</span>
          </label>
          <textarea
            id="report-chat-details"
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 500))}
            rows={3}
            maxLength={500}
            disabled={sending}
            className="w-full rounded-lg border border-bf-border bg-bf-dark px-3 py-2 text-sm text-bf-text focus:border-bf-gold focus:outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-bf-text">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(e) => setAlsoBlock(e.target.checked)}
            disabled={sending}
            className="h-4 w-4 accent-bf-gold"
          />
          Also block {target.username}, so you don’t see their chat
        </label>
        <button type="submit" disabled={!reason || sending} className="btn-primary w-full disabled:opacity-50">
          {sending ? 'Sending…' : 'Send report'}
        </button>
      </form>
    </Modal>
  );
}
