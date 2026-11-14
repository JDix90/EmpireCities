/**
 * Admin → Reports: chat messages players reported (`chat_safety_enabled`),
 * from GET /api/admin/chat-reports (backend modules/safety/chatSafety.service.ts).
 *
 * Each report shows the message (the server's own copy when it still had it,
 * marked "as sent"; otherwise the reporter's), why it was reported, who sent
 * and who reported it, and how many open reports the sender has. An admin
 * closes it as actioned or dismissed, with a note, and can ban the sender
 * through the Users tab's own ban action. Player text renders as text.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../services/api';

export type ChatReportStatus = 'open' | 'actioned' | 'dismissed';

export interface ChatReportItem {
  report_id: string;
  created_at: string;
  status: ChatReportStatus;
  reason: 'harassment' | 'hate' | 'sexual' | 'spam' | 'name' | 'other';
  details: string | null;
  channel: 'game' | 'lobby' | 'spectator';
  game_id: string | null;
  message: string | null;
  message_verified: boolean;
  reported_id: string | null;
  reported_username: string;
  reported_is_banned: boolean | null;
  reported_open_reports: number;
  reporter_id: string | null;
  reporter_username: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by_username: string | null;
}

const REASON_LABEL: Record<ChatReportItem['reason'], string> = {
  harassment: 'Harassment',
  hate: 'Hate speech',
  sexual: 'Sexual content',
  spam: 'Spam',
  name: 'Offensive name',
  other: 'Other',
};

const CHANNEL_LABEL: Record<ChatReportItem['channel'], string> = {
  game: 'Game chat',
  lobby: 'Lobby chat',
  spectator: 'Spectator chat',
};

const GIF_REGEX = /^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/;

function Message({ text }: { text: string | null }) {
  if (!text) return <span className="italic text-bf-muted">(no message)</span>;
  const gif = text.match(GIF_REGEX);
  if (gif) {
    return <a href={gif[1]} target="_blank" rel="noreferrer noopener" className="text-bf-gold underline">a GIF (opens Tenor)</a>;
  }
  return <span className="text-bf-text break-words whitespace-pre-wrap">{text}</span>;
}

export default function AdminChatReportsPanel({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<ChatReportStatus | 'all'>('open');
  const [data, setData] = useState<{ open: number; items: ChatReportItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    api.get<{ open: number; items: ChatReportItem[] }>('/admin/chat-reports', { params: { status } })
      .then((res) => { if (live) setData(res.data); })
      .catch(() => { if (live) setError('Could not load reports.'); });
    return () => { live = false; };
  }, [status, refreshKey, reload]);

  const close = async (item: ChatReportItem, next: ChatReportStatus) => {
    setBusy(item.report_id);
    try {
      const note = notes[item.report_id]?.trim();
      await api.post(`/admin/chat-reports/${item.report_id}`, { status: next, ...(note ? { note } : {}) });
      setReload((n) => n + 1);
    } catch {
      toast.error('Could not update the report.');
    } finally {
      setBusy(null);
    }
  };

  const ban = async (item: ChatReportItem) => {
    if (!item.reported_id) return;
    if (!window.confirm(`Ban ${item.reported_username}? They are signed out everywhere and cannot sign back in.`)) return;
    setBusy(item.report_id);
    try {
      await api.post('/admin/actions/ban', { user_id: item.reported_id });
      toast.success(`Banned ${item.reported_username}.`);
      setReload((n) => n + 1);
    } catch {
      toast.error('Could not ban them.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4" data-testid="admin-chat-reports">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-bf-muted">
          <span className="font-display text-2xl text-bf-text mr-2" data-testid="admin-chat-reports-open">{data?.open ?? '…'}</span>
          open {data?.open === 1 ? 'report' : 'reports'}. The App Store expects reports to be dealt with promptly.
        </p>
        <select
          aria-label="Show reports"
          value={status}
          onChange={(e) => setStatus(e.target.value as ChatReportStatus | 'all')}
          className="rounded-lg border border-bf-border bg-bf-dark px-2 py-1.5 text-sm text-bf-text focus:border-bf-gold focus:outline-none"
        >
          <option value="open">Open</option>
          <option value="actioned">Actioned</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {data && data.items.length === 0 && <p className="text-sm text-bf-muted">Nothing here.</p>}

      <ul className="space-y-3">
        {data?.items.map((item) => (
          <li key={item.report_id} className="rounded-xl border border-bf-border bg-cc-panel/50 p-4 space-y-2" data-testid="admin-chat-report">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bf-muted">
              <span className="rounded bg-red-900/40 px-2 py-0.5 text-red-200">{REASON_LABEL[item.reason]}</span>
              <span>{CHANNEL_LABEL[item.channel]}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              {item.game_id && <Link to={`/spectate/${item.game_id}`} className="underline hover:text-bf-text">game</Link>}
              {item.status !== 'open' && <span className="uppercase tracking-wide">{item.status}</span>}
            </div>
            <div className="text-sm">
              <span className="font-semibold text-bf-gold">{item.reported_username}</span>
              {item.reported_is_banned && <span className="ml-1 text-xs text-red-300">(banned)</span>}
              {!item.reported_id && <span className="ml-1 text-xs text-bf-muted">(account deleted)</span>}
              <span className="text-bf-muted">: </span>
              <Message text={item.message} />
            </div>
            <p className="text-xs text-bf-muted">
              {item.message_verified ? 'As sent (the server’s copy).' : 'As the reporter quoted it: the server no longer had the message.'}
              {' '}Reported by {item.reporter_username ?? 'a deleted account'}.
              {item.reported_open_reports > 1 && ` ${item.reported_open_reports} open reports against ${item.reported_username}.`}
            </p>
            {item.details && <p className="text-sm text-bf-text/90 whitespace-pre-wrap break-words">“{item.details}”</p>}
            {item.status === 'open' ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  value={notes[item.report_id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [item.report_id]: e.target.value.slice(0, 500) }))}
                  placeholder="Note (optional)"
                  aria-label="Note"
                  className="min-w-[12rem] flex-1 rounded border border-bf-border bg-bf-dark px-2 py-1 text-sm text-bf-text"
                />
                <button type="button" disabled={busy === item.report_id} onClick={() => void close(item, 'actioned')} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
                  Actioned
                </button>
                <button type="button" disabled={busy === item.report_id} onClick={() => void close(item, 'dismissed')} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">
                  Dismiss
                </button>
                {item.reported_id && !item.reported_is_banned && (
                  <button type="button" disabled={busy === item.report_id} onClick={() => void ban(item)} className="rounded border border-red-700/70 px-3 py-1.5 text-xs text-red-200 hover:border-red-500 disabled:opacity-50">
                    Ban {item.reported_username}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-bf-muted">
                {item.status === 'actioned' ? 'Actioned' : 'Dismissed'}
                {item.resolved_by_username ? ` by ${item.resolved_by_username}` : ''}
                {item.resolved_at ? ` on ${new Date(item.resolved_at).toLocaleDateString()}` : ''}
                {item.resolution_note ? `: ${item.resolution_note}` : '.'}
                {' '}
                <button type="button" onClick={() => void close(item, 'open')} className="underline hover:text-bf-text">Reopen</button>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
