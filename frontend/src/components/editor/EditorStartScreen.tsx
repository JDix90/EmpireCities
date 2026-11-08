import React, { useEffect, useRef, useState } from 'react';
import { Compass, Copy, Globe2, LayoutTemplate, Pencil, Upload, X } from 'lucide-react';
import { api } from '../../services/api';
import type { ContinentOption } from './editorTemplates';

interface RemixRow {
  map_id: string;
  name: string;
  description: string;
  moderation_status?: string;
  creator_name?: string | null;
  play_count?: number;
}

interface EditorStartScreenProps {
  open: boolean;
  /** False until the country data is in; the continent cards wait for it. */
  countriesReady: boolean;
  continents: ContinentOption[];
  busy: boolean;
  /** Whether there is a map behind the screen worth keeping (shows Close). */
  canClose: boolean;
  onClose: () => void;
  onBlank: () => void;
  onContinent: (continent: string, includeSmall: boolean) => void;
  onRemix: (mapId: string, name: string) => void;
  onImportFile: (file: File) => void;
}

/**
 * Where a new map begins. A continent is one click to a playable draft —
 * every country a territory, the borders connected, islands bridged, regions
 * priced — and the other doors are the blank globe, a copy of a map you
 * already made, or a file. Everything here is undoable once applied.
 */
export default function EditorStartScreen({
  open,
  countriesReady,
  continents,
  busy,
  canClose,
  onClose,
  onBlank,
  onContinent,
  onRemix,
  onImportFile,
}: EditorStartScreenProps) {
  const [includeSmall, setIncludeSmall] = useState(false);
  const [showRemix, setShowRemix] = useState(false);
  const [mine, setMine] = useState<RemixRow[] | null>(null);
  const [community, setCommunity] = useState<RemixRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !showRemix || mine !== null) return;
    api.get<RemixRow[]>('/maps/me')
      .then((res) => setMine(res.data))
      .catch(() => setMine([]));
    api.get<{ maps: RemixRow[] }>('/maps/public?sort=rating')
      .then((res) => setCommunity(res.data.maps))
      .catch(() => setCommunity([]));
  }, [open, showRemix, mine]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-bf-dark/85 backdrop-blur-sm" data-testid="editor-start">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-2xl text-bf-gold">Start a map</h2>
            <p className="text-bf-muted text-sm mt-1">
              Pick a continent and get a playable board in one click, or begin from an empty globe.
            </p>
          </div>
          {canClose && (
            <button type="button" onClick={onClose} className="text-bf-muted hover:text-bf-text" aria-label="Close">
              <X className="w-5 h-5" aria-hidden />
            </button>
          )}
        </div>

        {/* Continents */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Compass className="w-4 h-4 text-bf-gold" aria-hidden />
            <h3 className="font-display text-base text-bf-text">From a continent</h3>
            <label className="ml-auto flex items-center gap-2 text-xs text-bf-muted cursor-pointer">
              <input
                type="checkbox"
                checked={includeSmall}
                onChange={(e) => setIncludeSmall(e.target.checked)}
                className="accent-bf-gold"
              />
              Include microstates and small islands
            </label>
          </div>
          {!countriesReady ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-20 rounded-lg bg-bf-surface/60 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {continents.map((c) => {
                const count = includeSmall ? c.large + c.small : c.large;
                return (
                  <button
                    key={c.name}
                    type="button"
                    disabled={busy || count < 2}
                    onClick={() => onContinent(c.name, includeSmall)}
                    className="card text-left hover:border-bf-gold transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <Globe2 className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
                      <span className="font-display text-base text-bf-text">{c.name}</span>
                    </div>
                    <p className="text-xs text-bf-muted mt-1">
                      {count} {count === 1 ? 'country' : 'countries'}
                      {!includeSmall && c.small > 0 ? ` · ${c.small} small hidden` : ''}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-bf-muted mt-2">
            Regions follow the UN subregions, borders become connections, islands get a sea lane to the nearest coast, and each region gets a suggested bonus. Change any of it afterwards.
          </p>
        </section>

        {/* Other doors */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <button type="button" disabled={busy} onClick={onBlank} className="card text-left hover:border-bf-gold transition-colors disabled:opacity-50">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
              <span className="font-display text-base text-bf-text">Blank globe</span>
            </div>
            <p className="text-xs text-bf-muted mt-1">Pick countries or draw territories one by one.</p>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowRemix((v) => !v)}
            className={`card text-left hover:border-bf-gold transition-colors disabled:opacity-50 ${showRemix ? 'border-bf-gold' : ''}`}
            aria-expanded={showRemix}
          >
            <div className="flex items-center gap-2">
              <Copy className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
              <span className="font-display text-base text-bf-text">Remix a map</span>
            </div>
            <p className="text-xs text-bf-muted mt-1">Start from one of your maps or a community map.</p>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="card text-left hover:border-bf-gold transition-colors disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
              <span className="font-display text-base text-bf-text">Import a file</span>
            </div>
            <p className="text-xs text-bf-muted mt-1">A map exported from this editor, as JSON.</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportFile(file);
                e.target.value = '';
              }}
            />
          </button>
        </section>

        {showRemix && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <LayoutTemplate className="w-4 h-4 text-bf-gold" aria-hidden />
              <h3 className="font-display text-base text-bf-text">Remix</h3>
              <span className="text-xs text-bf-muted">— a copy opens as a new draft of yours</span>
            </div>
            <RemixList title="Your maps" rows={mine} onRemix={onRemix} busy={busy} empty="You have no saved maps yet." />
            <RemixList title="Community maps" rows={community} onRemix={onRemix} busy={busy} empty="No published community maps yet." />
            <p className="text-[11px] text-bf-muted mt-2">
              Built-in era and regional boards use hand-tuned geometry the editor cannot edit yet, so they are not listed.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function RemixList({
  title,
  rows,
  onRemix,
  busy,
  empty,
}: {
  title: string;
  rows: RemixRow[] | null;
  onRemix: (mapId: string, name: string) => void;
  busy: boolean;
  empty: string;
}) {
  return (
    <div className="mb-4">
      <h4 className="text-xs uppercase tracking-wider text-bf-muted mb-2">{title}</h4>
      {rows === null ? (
        <p className="text-xs text-bf-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-bf-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 12).map((m) => (
            <li key={m.map_id} className="flex items-center gap-3 rounded-md border border-bf-border bg-bf-surface/70 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-bf-text truncate">{m.name}</p>
                <p className="text-[11px] text-bf-muted truncate">
                  {m.creator_name ? `by ${m.creator_name}` : m.moderation_status ? `${m.moderation_status}` : ''}
                  {m.description ? ` · ${m.description}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemix(m.map_id, m.name)}
                className="btn-secondary text-xs py-1 px-3 disabled:opacity-50"
              >
                Remix
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
