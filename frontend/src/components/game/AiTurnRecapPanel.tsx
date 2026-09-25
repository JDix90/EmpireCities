import { useEffect, useState } from 'react';
import { X, Sword, Flag, Skull, ChevronDown, ChevronUp, History, Shield } from 'lucide-react';
import clsx from 'clsx';
import type { CombatResult } from '../../store/gameStore';

export interface TurnRecapEntry {
  playerName: string;
  playerColor: string;
  turnNumber: number;
  combats: CombatResult[];
}

/** Oldest entries roll off so the panel can't grow unbounded for players whose turn never comes back (eliminated, spectating). */
const MAX_RECAP_ENTRIES = 12;

/**
 * Coalesce another player's finished turn into the recap list.
 * Quiet turns (no battles) are skipped — the panel only reports action.
 */
export function appendRecap(list: TurnRecapEntry[], entry: TurnRecapEntry): TurnRecapEntry[] {
  if (entry.combats.length === 0) return list;
  const next = [...list, entry];
  return next.length > MAX_RECAP_ENTRIES ? next.slice(next.length - MAX_RECAP_ENTRIES) : next;
}

/** Stable identity for per-entry UI state — array indexes shift as batches change. */
export function recapKey(recap: TurnRecapEntry): string {
  return `${recap.turnNumber}:${recap.playerName}`;
}

export function summarizeRecap(combats: CombatResult[]): {
  battles: number;
  captures: number;
  destroyed: number;
} {
  return {
    battles: combats.length,
    captures: combats.filter((c) => c.territory_captured).length,
    destroyed: combats.reduce((s, c) => s + c.defender_losses, 0),
  };
}

/**
 * One row per opponent turn, each opening to its battles. Shared by the
 * desktop panel and the phone strip's sheet, so both read the same rows;
 * which rows are open is the caller's state.
 */
export function RecapEntryList({
  recaps,
  viewerPlayerId,
  openEntries,
  onToggle,
}: {
  recaps: TurnRecapEntry[];
  viewerPlayerId: string | null;
  openEntries: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <>
      {recaps.map((recap) => {
        const stats = summarizeRecap(recap.combats);
        const key = recapKey(recap);
        const open = !!openEntries[key];
        const attackedViewer = !!viewerPlayerId && recap.combats.some((c) => c.defenderId === viewerPlayerId);
        return (
          <div key={key} className={clsx('px-3 py-2', attackedViewer && 'border-l-2 border-l-red-500/60 bg-red-500/[0.04]')}>
            <button
              type="button"
              className="w-full flex items-center gap-2 text-left"
              onClick={() => onToggle(key)}
              aria-expanded={open}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: recap.playerColor }}
                aria-hidden
              />
              <span className="text-bf-text truncate flex-1">{recap.playerName}</span>
              <span className="flex items-center gap-2 text-xs text-bf-muted tabular-nums shrink-0">
                <span className="flex items-center gap-0.5"><Sword className="w-3 h-3" aria-hidden />{stats.battles}</span>
                <span className={clsx('flex items-center gap-0.5', stats.captures > 0 && 'text-yellow-400')}>
                  <Flag className="w-3 h-3" aria-hidden />{stats.captures}
                </span>
                <span className="flex items-center gap-0.5"><Skull className="w-3 h-3" aria-hidden />{stats.destroyed}</span>
              </span>
            </button>
            {open && (
              <div className="mt-1.5 space-y-1 pl-4">
                {recap.combats.map((c, j) => {
                  const vsViewer = !!viewerPlayerId && c.defenderId === viewerPlayerId;
                  return (
                    <div key={j} className={clsx('flex items-center gap-2 text-xs', vsViewer ? 'text-red-300' : 'text-bf-muted')}>
                      <span className="truncate flex-1">
                        {c.fromName ?? '?'} → {c.toName ?? '?'}
                        {vsViewer && <span className="text-red-400/80"> (you)</span>}
                      </span>
                      {c.territory_captured ? (
                        <span className={clsx('shrink-0', vsViewer ? 'text-red-400 font-medium' : 'text-yellow-400')}>
                          {vsViewer ? 'Lost!' : 'Captured'}
                        </span>
                      ) : c.defender_losses > 0 ? (
                        <span className="shrink-0">−{c.defender_losses} def</span>
                      ) : c.attacker_losses > 0 ? (
                        <span className="shrink-0">−{c.attacker_losses} atk</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Non-blocking replacement for the queued per-AI "TURN COMPLETE" modals:
 * a collapsible overlay summarizing what other players did since the local
 * player's last turn. Never intercepts input outside its own box and never
 * consumes the turn clock.
 *
 * Desktop only. A phone shows the same recaps on `MobileTurnStrip`, which
 * never expands over the map (docs/MOBILE_UX_PLAN.md M-12).
 */
export default function AiTurnRecapPanel({
  recaps,
  onDismiss,
  viewerPlayerId = null,
}: {
  recaps: TurnRecapEntry[];
  onDismiss: () => void;
  /** Highlights entries where this player was attacked; auto-expands on territory loss. */
  viewerPlayerId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openEntries, setOpenEntries] = useState<Record<string, boolean>>({});

  // Dismissal/turn-end empties the list while the component stays mounted —
  // drop the previous batch's expansion state so it can't leak into the next.
  useEffect(() => {
    if (recaps.length === 0) {
      setExpanded(false);
      setOpenEntries({});
    }
  }, [recaps.length]);

  // Losing a territory is the one recap event worth surfacing unprompted:
  // pop the panel open with that entry expanded. Routine chip damage stays
  // collapsed — the header badge already shows you were attacked.
  useEffect(() => {
    if (!viewerPlayerId || recaps.length === 0) return;
    const latest = recaps[recaps.length - 1];
    const lostTerritory = latest.combats.some(
      (c) => c.defenderId === viewerPlayerId && c.territory_captured,
    );
    if (lostTerritory) {
      setExpanded(true);
      setOpenEntries((m) => ({ ...m, [recapKey(latest)]: true }));
    }
  }, [recaps, viewerPlayerId]);

  if (recaps.length === 0) return null;

  const totalCaptures = recaps.reduce((s, r) => s + summarizeRecap(r.combats).captures, 0);
  const attacksOnViewer = viewerPlayerId
    ? recaps.reduce((s, r) => s + r.combats.filter((c) => c.defenderId === viewerPlayerId).length, 0)
    : 0;

  return (
    <div className="absolute top-16 right-3 z-20 w-[290px] max-w-[85vw] rounded-xl border border-bf-border bg-bf-surface/95 backdrop-blur-sm shadow-xl text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <History className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
        <button
          type="button"
          className="flex-1 flex items-center gap-1.5 text-left text-bf-text hover:text-bf-gold min-w-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="truncate">
            While you were away ({recaps.length} {recaps.length === 1 ? 'turn' : 'turns'}
            {totalCaptures > 0 ? `, ${totalCaptures} ${totalCaptures === 1 ? 'capture' : 'captures'}` : ''})
          </span>
          {attacksOnViewer > 0 && (
            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[10px] font-medium">
              <Shield className="w-2.5 h-2.5" aria-hidden />
              {attacksOnViewer}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-bf-muted hover:text-bf-text shrink-0"
          aria-label="Dismiss recap"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t border-bf-border/70 divide-y divide-bf-border/50">
          <RecapEntryList
            recaps={recaps}
            viewerPlayerId={viewerPlayerId}
            openEntries={openEntries}
            onToggle={(key) => setOpenEntries((m) => ({ ...m, [key]: !m[key] }))}
          />
        </div>
      )}
    </div>
  );
}
