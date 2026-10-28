/**
 * Admin → Feedback: what players send from inside the game, newest first, from
 * GET /api/admin/feedback (shapes mirror backend modules/feedback/feedback.service.ts).
 *
 * So far that is the Galactic Age beta: the BETA panel's form and the
 * game-over thumbs. Each entry carries the context the player did not type
 * (the game, the turn, the device and screen size), so a layout complaint can
 * be matched to a screen and a rules complaint opened in the replay. Comments
 * are player text and render as text. The panel owns its filters and fetching;
 * the page's Refresh bumps `refreshKey`.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '../../services/api';

export interface FeedbackItem {
  feedback_id: string;
  created_at: string;
  updated_at: string;
  source: 'beta_panel' | 'game_over';
  rating: 'up' | 'down' | null;
  comment: string | null;
  game_id: string | null;
  turn_number: number | null;
  device: string | null;
  viewport: string | null;
  user_id: string;
  username: string | null;
  is_guest: boolean;
}

export interface FeedbackReport {
  summary: { total: number; up: number; down: number; with_comment: number };
  items: FeedbackItem[];
}

const WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 0, label: 'All time' },
];

const SOURCE_LABEL: Record<FeedbackItem['source'], string> = {
  beta_panel: 'BETA panel',
  game_over: 'Game over',
};

const selectClass =
  'rounded-lg border border-bf-border bg-bf-dark px-2 py-1.5 text-sm text-bf-text focus:border-bf-gold focus:outline-none';

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-4">
      <p className="text-xs text-bf-muted">{label}</p>
      <p className="mt-1 font-display text-2xl text-bf-text">{value}</p>
    </div>
  );
}

/** Share of thumbs that are up, or a dash before there are any. */
export function upShare(summary: FeedbackReport['summary']): string {
  const rated = summary.up + summary.down;
  return rated ? `${Math.round((summary.up / rated) * 100)}%` : '—';
}

export default function AdminFeedbackPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [days, setDays] = useState(30);
  const [rating, setRating] = useState<'' | 'up' | 'down'>('');
  const [report, setReport] = useState<FeedbackReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    const params: Record<string, string | number> = { topic: 'galactic_age' };
    if (days) params.days = days;
    if (rating) params.rating = rating;
    api
      .get<FeedbackReport>('/admin/feedback', { params })
      .then((res) => {
        if (!stale) setReport(res.data);
      })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { error?: string } } };
        if (!stale) setError(err?.response?.data?.error ?? 'Failed to load feedback');
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [days, rating, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-bf-gold">Galactic Age beta feedback</h2>
          <p className="text-xs text-bf-muted">From the BETA panel’s form and the game-over question.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-bf-muted">
            Window
            <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {WINDOWS.map((w) => <option key={w.days} value={w.days}>{w.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-bf-muted">
            Rating
            <select className={selectClass} value={rating} onChange={(e) => setRating(e.target.value as '' | 'up' | 'down')}>
              <option value="">All</option>
              <option value="up">Thumbs up</option>
              <option value="down">Thumbs down</option>
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      {report && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Responses" value={report.summary.total} />
          <Tile label="Thumbs up" value={`${report.summary.up} (${upShare(report.summary)})`} />
          <Tile label="Thumbs down" value={report.summary.down} />
          <Tile label="With a comment" value={report.summary.with_comment} />
        </div>
      )}

      {loading && !report && <p className="text-sm text-bf-muted">Loading feedback…</p>}

      {report && report.items.length === 0 && (
        <div className="rounded-xl border border-bf-border bg-cc-panel/50 p-6 text-center text-sm text-bf-muted">
          No feedback in this window yet.
        </div>
      )}

      {report && report.items.length > 0 && (
        <ul className="space-y-2" data-testid="admin-feedback-list">
          {report.items.map((item) => (
            <li key={item.feedback_id} className="rounded-xl border border-bf-border bg-cc-panel/50 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bf-muted">
                {item.rating === 'up' && <ThumbsUp className="h-4 w-4 text-emerald-400" aria-label="Thumbs up" />}
                {item.rating === 'down' && <ThumbsDown className="h-4 w-4 text-red-400" aria-label="Thumbs down" />}
                <span className="text-bf-text">
                  {item.username ?? 'Deleted account'}
                  {item.is_guest && <span className="ml-1 text-bf-muted">(guest)</span>}
                </span>
                <span>{SOURCE_LABEL[item.source]}</span>
                <span>{new Date(item.updated_at).toLocaleString()}</span>
              </div>
              {item.comment && (
                <p className="mt-2 whitespace-pre-wrap break-words text-bf-text">{item.comment}</p>
              )}
              <p className="mt-2 text-xs text-bf-muted">
                {[
                  item.device,
                  item.viewport?.replace('x', '×'),
                  item.turn_number != null ? `turn ${item.turn_number}` : null,
                ].filter(Boolean).join(' · ') || 'No context'}
                {item.game_id && (
                  <>
                    {' · '}
                    <Link to={`/replay/${item.game_id}`} className="text-bf-gold hover:underline">
                      Replay
                    </Link>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
