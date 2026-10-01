/**
 * Keyboard-reachable territory selection.
 *
 * The map is a canvas (PixiJS in 2D, three.js on the globe): nothing on it can
 * take focus, so a keyboard-only player could not select a territory to
 * reinforce, attack from or fortify — the first selection in every phase
 * needed a pointer. This dialog lists every territory on the board as a
 * button, grouped by region, behind a name filter, and hands the chosen id to
 * the same handler a map click uses. The map toolbar opens it; so does L.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { GameState } from '../../store/gameStore';

export interface TerritoryListTerritory {
  territory_id: string;
  name: string;
  region_id: string;
}

export interface TerritoryListRegion {
  region_id: string;
  name: string;
}

interface TerritoryListDialogProps {
  territories: TerritoryListTerritory[];
  regions?: TerritoryListRegion[];
  gameState: GameState;
  /** The viewer's seat — labels their tiles "Yours" and powers the "Only my territories" filter. */
  viewerPlayerId: string | null;
  selectedTerritoryId: string | null;
  /** Receives the chosen id: the same handler a tap on the map uses. */
  onSelect: (territoryId: string) => void;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function TerritoryListDialog({
  territories,
  regions,
  gameState,
  viewerPlayerId,
  selectedTerritoryId,
  onSelect,
  onClose,
}: TerritoryListDialogProps) {
  const [filter, setFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the filter on open; hand focus back to whatever opened us on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      opener?.focus?.();
    };
  }, []);

  const playersById = useMemo(
    () => new Map(gameState.players.map((p) => [p.player_id, p])),
    [gameState.players],
  );

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const regionName = new Map((regions ?? []).map((r) => [r.region_id, r.name]));
    const regionOrder = new Map((regions ?? []).map((r, i) => [r.region_id, i]));
    const byRegion = new Map<string, TerritoryListTerritory[]>();
    for (const t of territories) {
      const tile = gameState.territories[t.territory_id];
      // Authored but not on the board yet (an era-locked frontier).
      if (!tile) continue;
      if (onlyMine && tile.owner_id !== viewerPlayerId) continue;
      if (q && !t.name.toLowerCase().includes(q)) continue;
      const list = byRegion.get(t.region_id) ?? [];
      list.push(t);
      byRegion.set(t.region_id, list);
    }
    return [...byRegion.entries()]
      .sort((a, b) => (regionOrder.get(a[0]) ?? 999) - (regionOrder.get(b[0]) ?? 999) || a[0].localeCompare(b[0]))
      .map(([regionId, list]) => ({
        regionId,
        name: regionName.get(regionId) ?? regionId,
        territories: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [territories, regions, gameState.territories, filter, onlyMine, viewerPlayerId]);

  const ownerLabel = (ownerId: string | null | undefined): string => {
    if (!ownerId || ownerId === 'neutral') return 'Neutral';
    if (ownerId === viewerPlayerId) return 'Yours';
    return playersById.get(ownerId)?.username ?? 'Enemy';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    // Keep Tab inside the dialog while it is open.
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const total = groups.reduce((n, g) => n + g.territories.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 pt-safe pb-safe"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="territory-list-title"
        data-testid="territory-list-dialog"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="bg-bf-surface border border-bf-border rounded-xl w-full max-w-md max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <p id="territory-list-title" className="font-display text-lg text-bf-gold tracking-wide">Territories</p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-bf-muted hover:text-bf-text transition-colors -mr-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-3 flex flex-col gap-2">
          <label className="relative block">
            <span className="sr-only">Filter territories by name</span>
            <Search
              className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-bf-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              id="territory-list-filter"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Type a territory name"
              autoComplete="off"
              className="w-full bg-bf-dark border border-bf-border rounded-lg pl-8 pr-3 py-2 text-sm text-bf-text placeholder:text-bf-muted"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-bf-muted select-none">
            <input
              id="territory-list-only-mine"
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
              disabled={!viewerPlayerId}
            />
            Only my territories
          </label>
          <p className="text-[11px] text-bf-muted" aria-live="polite">
            {total} {total === 1 ? 'territory' : 'territories'} · choosing one selects it on the map, as a tap would.
          </p>
        </div>

        <div className="overflow-y-auto overscroll-contain px-3 pb-4 flex-1 min-h-0">
          {groups.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-bf-muted">No territory matches.</p>
          )}
          {groups.map((g) => (
            <section key={g.regionId} aria-labelledby={`territory-list-region-${g.regionId}`} className="mb-3">
              <h3
                id={`territory-list-region-${g.regionId}`}
                className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-bf-muted"
              >
                {g.name}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {g.territories.map((t) => {
                  const tile = gameState.territories[t.territory_id];
                  const owner = tile?.owner_id ?? null;
                  const color = owner ? playersById.get(owner)?.color : undefined;
                  // Fog of war sends hidden counts as -1.
                  const units = tile && tile.unit_count >= 0
                    ? `${tile.unit_count} ${tile.unit_count === 1 ? 'unit' : 'units'}`
                    : 'units hidden';
                  const selected = t.territory_id === selectedTerritoryId;
                  return (
                    <li key={t.territory_id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(t.territory_id);
                          onClose();
                        }}
                        aria-current={selected ? 'true' : undefined}
                        className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                          selected ? 'bg-bf-gold/20 text-bf-gold' : 'text-bf-text hover:bg-bf-dark/70'
                        }`}
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                          style={{ backgroundColor: color ?? 'transparent' }}
                          aria-hidden="true"
                        />
                        <span className="flex-1 min-w-0 truncate">{t.name}</span>
                        <span className="text-xs text-bf-muted whitespace-nowrap">
                          {ownerLabel(owner)} · {units}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
