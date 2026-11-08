import React, { useState } from 'react';
import { Check, Circle, Link2, Send } from 'lucide-react';
import Modal from '../ui/Modal';
import MapPreview from '../lobby/MapPreview';
import type { GameMap } from '../../services/mapService';
import type { MapHealthReport } from '@borderfall/shared';

export type PublishStatus = 'unsaved' | 'draft' | 'pending' | 'approved' | 'rejected';

interface PublishPanelProps {
  status: PublishStatus;
  /** The moderator's note on a rejected map. */
  reason?: string | null;
  report: MapHealthReport;
  isDirty: boolean;
  submitting: boolean;
  /** The map as it stands, for the preflight preview. */
  previewMap: GameMap | null;
  mapName: string;
  mapDescription: string;
  eraLabel: string;
  onSubmit: () => Promise<void> | void;
  /** Copies the map's link; null when the map has none yet. */
  onShare: (() => void) | null;
}

const STEPS: Array<{ key: 'draft' | 'pending' | 'approved'; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'pending', label: 'In review' },
  { key: 'approved', label: 'Published' },
];

function stepIndex(status: PublishStatus): number {
  switch (status) {
    case 'pending':
      return 1;
    case 'approved':
      return 2;
    default:
      return 0;
  }
}

/**
 * Where the map is on its way to the hub, and the button that moves it.
 * Submit opens a preflight: what review will see, and whether Map health
 * would let it through.
 */
export default function PublishPanel({
  status,
  reason,
  report,
  isDirty,
  submitting,
  previewMap,
  mapName,
  mapDescription,
  eraLabel,
  onSubmit,
  onShare,
}: PublishPanelProps) {
  const [preflightOpen, setPreflightOpen] = useState(false);
  const current = stepIndex(status);
  const canSubmit = (status === 'draft' || status === 'rejected') && !isDirty && report.ready;

  const copy: Record<PublishStatus, string> = {
    unsaved: 'Save the map to keep a draft on your account. Nothing is public until a moderator approves it.',
    draft: 'When Map health is green, submit it. A moderator reviews every community map before it is listed.',
    pending: 'A moderator is reviewing this version. Saving a change sends the new version back to review.',
    approved: 'Listed in the Map Hub. Saving a change unlists it until a moderator has seen the new version.',
    rejected: 'Sent back by review. Fix what the note asks, save, and submit again.',
  };

  const submitBlocked = status === 'pending'
    ? 'Already in review'
    : status === 'approved'
      ? 'Already published'
      : isDirty
        ? 'Save your changes first'
        : !report.ready
          ? `Map health lists ${report.blockers.length} thing${report.blockers.length === 1 ? '' : 's'} review will block on`
          : null;

  return (
    <div className="p-4 border-b border-bf-border" data-testid="publish-panel">
      <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-3">Publishing</h3>

      <ol className="flex items-center gap-1 mb-3" aria-label="Publishing progress">
        {STEPS.map((step, i) => {
          const done = i < current || (i === current && status === 'approved');
          const active = i === current && status !== 'unsaved';
          const failed = step.key === 'pending' && status === 'rejected';
          return (
            <li key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
              <span
                className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                  failed
                    ? 'border-red-400/60 text-red-300'
                    : done
                      ? 'border-green-400/60 bg-green-500/20 text-green-300'
                      : active
                        ? 'border-bf-gold text-bf-gold'
                        : 'border-bf-border text-bf-border'
                }`}
                aria-hidden
              >
                {done ? <Check className="w-3 h-3" /> : <Circle className="w-2 h-2" />}
              </span>
              <span className={`text-[11px] truncate ${active || done ? 'text-bf-text' : 'text-bf-muted'}`}>
                {failed ? 'Sent back' : step.label}
              </span>
              {i < STEPS.length - 1 && <span className="flex-1 h-px bg-bf-border mx-1" aria-hidden />}
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-bf-muted leading-snug">{copy[status]}</p>
      {status === 'rejected' && reason && (
        <p className="text-xs text-red-300/90 mt-2 rounded-md border border-red-500/30 bg-red-950/30 px-2 py-1.5">
          Reviewer: {reason}
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        {(status === 'draft' || status === 'rejected' || status === 'unsaved') && (
          <button
            type="button"
            onClick={() => setPreflightOpen(true)}
            disabled={!canSubmit || submitting}
            title={status === 'unsaved' ? 'Save the map first' : submitBlocked ?? 'Review what a moderator will see, then submit'}
            className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" aria-hidden />
            <span>{status === 'rejected' ? 'Submit again' : 'Submit for review'}</span>
          </button>
        )}
        {onShare && (
          <button
            type="button"
            onClick={onShare}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
            title={status === 'approved' ? 'Copy the map\'s link' : 'Copy the map\'s link — only you can open it until it is published'}
          >
            <Link2 className="w-3.5 h-3.5" aria-hidden />
            <span>Share link</span>
          </button>
        )}
      </div>

      <Modal open={preflightOpen} onClose={() => setPreflightOpen(false)} title="Submit for review">
        <div className="space-y-3">
          <div className="rounded-lg overflow-hidden border border-bf-border bg-bf-dark mx-auto" style={{ width: 400, height: 220, maxWidth: '100%' }}>
            {previewMap ? (
              <MapPreview mapId={previewMap.map_id} mapData={previewMap} width={400} height={220} showChrome={false} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-bf-muted">No preview</div>
            )}
          </div>
          <div>
            <p className="font-display text-lg text-bf-gold">{mapName}</p>
            <p className="text-xs text-bf-muted">{eraLabel}</p>
            <p className="text-sm text-bf-text mt-1">{mapDescription.trim() || 'No description yet — it is the first thing players read on the card.'}</p>
          </div>
          <ul className="text-xs space-y-1">
            <li className="flex items-center gap-2 text-green-300">
              <Check className="w-3.5 h-3.5" aria-hidden />
              <span>Passes every publish check</span>
            </li>
            {report.warnings.map((w) => (
              <li key={w.message} className="flex items-start gap-2 text-amber-300">
                <Circle className="w-2 h-2 mt-1.5 shrink-0" aria-hidden />
                <span>{w.message}</span>
              </li>
            ))}
            {report.tips.map((t) => (
              <li key={t.message} className="flex items-start gap-2 text-bf-muted">
                <Circle className="w-2 h-2 mt-1.5 shrink-0" aria-hidden />
                <span>{t.message}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-bf-muted">
            A moderator checks that the map plays and that its names and description are fine. Until then it stays private; you can keep test playing it.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setPreflightOpen(false)} className="btn-secondary text-sm py-1.5 px-4">
              Not yet
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setPreflightOpen(false);
                void onSubmit();
              }}
              className="btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
